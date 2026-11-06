import { hasDisclosure } from './script.ts'
import { checkCallingWindow, zonesFor } from './timezones.ts'
import type { Call, Campaign, Lead, Outcome } from './types.ts'

export type GateCode =
  | 'dnc'
  | 'no_disclosure'
  | 'call_open'
  | 'already_reached'
  | 'max_attempts'
  | 'retry_gap'
  | 'no_timezone'
  | 'outside_hours'
  | 'hourly_cap'

export type GateResult =
  | { ok: true }
  | {
      ok: false
      code: GateCode
      reason: string // shown to the user as-is
      final: boolean // true means waiting won't help, this lead is done
      retryAt?: string
    }

export interface GateInput {
  lead: Pick<Lead, 'timezone' | 'state'>
  campaign: Pick<
    Campaign,
    'id' | 'days' | 'windowStart' | 'windowEnd' | 'maxPerHour' | 'maxAttempts' | 'retryDelayMinutes'
  >
  firstLine: string
  onDnc: boolean
  history: Pick<Call, 'campaignId' | 'status' | 'outcome' | 'startedAt'>[] // campaign calls to this number, oldest first
  callsThisHour: number
  now: Date
}

const REACHED: (Outcome | null)[] = ['connected', 'opted_out']

const blocked = (code: GateCode, reason: string, final = false, retryAt?: string): GateResult => ({
  ok: false,
  code,
  reason,
  final,
  retryAt,
})

// The one place that decides whether a call may go out. It's a pure function,
// so it needs no database or clock, and every rule can be tested directly.
export function checkGate(input: GateInput): GateResult {
  const { lead, campaign, history, now } = input

  if (input.onDnc) return blocked('dnc', 'On the do-not-call list.', true)

  if (!hasDisclosure(input.firstLine)) {
    return blocked('no_disclosure', "The agent's first line doesn't say it's an AI.")
  }

  // Checked across all campaigns. An opt-out from a call we haven't finished
  // reading yet must be seen before this number can be dialed again.
  if (history.some((call) => call.status !== 'ended')) {
    return blocked('call_open', 'A call to this number is still open.')
  }

  const thisCampaign = history.filter((call) => call.campaignId === campaign.id)

  if (thisCampaign.some((call) => REACHED.includes(call.outcome))) {
    return blocked('already_reached', 'Already reached on this campaign.', true)
  }

  if (thisCampaign.length >= campaign.maxAttempts) {
    return blocked('max_attempts', `Used all ${campaign.maxAttempts} attempts.`, true)
  }

  const last = history.at(-1)
  if (last) {
    const nextTry = new Date(new Date(last.startedAt).getTime() + campaign.retryDelayMinutes * 60_000)
    if (now < nextTry) {
      return blocked('retry_gap', 'Waiting before the next attempt.', false, nextTry.toISOString())
    }
  }

  const zones = zonesFor(lead)
  if (zones.length === 0) {
    return blocked('no_timezone', 'No timezone or US state on this lead, so we can\'t tell their local time.', true)
  }

  const window = checkCallingWindow(zones, now, campaign.days, campaign.windowStart, campaign.windowEnd)
  if (!window.ok) return blocked('outside_hours', window.reason)

  if (input.callsThisHour >= campaign.maxPerHour) {
    return blocked('hourly_cap', `Hit this campaign's limit of ${campaign.maxPerHour} calls an hour.`)
  }

  return { ok: true }
}
