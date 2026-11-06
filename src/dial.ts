import { contextFor, dialerFor, mockProvider, readinessOf, selectedProvider, type Deps, type Dialer } from './context.ts'
import { checkGate, type GateResult } from './gate.ts'
import type { DialRequest } from './providers/types.ts'
import { redact } from './secrets.ts'
import { buildFirstLine, buildPrompt, hasDisclosure } from './script.ts'
import type { Agent, Call, CallInput, Campaign, Lead } from './types.ts'

// THE ONLY FILE THAT CALLS placeCall. Every call goes through here, so every
// call goes through the gate. Don't add another path to a provider.

export const TEST_CALLS_PER_DAY = 5

export type DialResult = { placed: true; call: Call } | { placed: false; reason: string }

export async function evaluateLead(deps: Deps, lead: Lead, campaign: Campaign, agent: Agent): Promise<GateResult> {
  const now = deps.now()
  const anHourAgo = new Date(now.getTime() - 3_600_000).toISOString()
  return checkGate({
    lead,
    campaign,
    now,
    firstLine: agent.firstLine,
    onDnc: await deps.store.isOnDnc(lead.phone),
    history: await deps.store.callsForPhone(lead.phone),
    callsThisHour: await deps.store.countCampaignCallsSince(campaign.id, anHourAgo),
  })
}

export async function dialLead(deps: Deps, lead: Lead, campaign: Campaign, agent: Agent): Promise<DialResult> {
  const gate = await evaluateLead(deps, lead, campaign, agent)
  if (!gate.ok) return { placed: false, reason: gate.reason }

  const dialer = await dialerFor(deps)
  if (!dialer.ok) return { placed: false, reason: dialer.reason }

  return startCall(
    deps,
    dialer,
    { campaignId: campaign.id, leadId: lead.id, leadName: lead.name, phone: lead.phone, kind: 'campaign' },
    {
      to: lead.phone,
      leadName: lead.name,
      firstLine: buildFirstLine(agent, lead),
      prompt: buildPrompt(agent, lead),
      captureFields: agent.captureFields,
    },
  )
}

// Rings the user's own phone. It's the one call that can be real during dry run,
// and it can only ever reach MY_PHONE, which only the person can set.
export async function placeTestCall(deps: Deps, agent: Agent): Promise<DialResult> {
  const phone = deps.secrets.get('MY_PHONE')
  if (!phone) return { placed: false, reason: 'Add your phone number in setup first.' }
  if (await deps.store.isOnDnc(phone)) return { placed: false, reason: 'Your number is on the do-not-call list.' }
  if (!hasDisclosure(agent.firstLine)) return { placed: false, reason: "The agent's first line doesn't say it's an AI." }

  const startOfDay = new Date(deps.now())
  startOfDay.setHours(0, 0, 0, 0)
  if ((await deps.store.countTestCallsSince(startOfDay.toISOString())) >= TEST_CALLS_PER_DAY) {
    return { placed: false, reason: `You've used today's ${TEST_CALLS_PER_DAY} test calls.` }
  }

  // Uses the real platform if it's fully set up, otherwise the simulator.
  const selected = await selectedProvider(deps)
  const isReady = selected !== null && (await readinessOf(deps, selected)).ready
  const provider = isReady ? selected : mockProvider(deps)
  const dialer: Dialer = {
    ok: true,
    provider,
    ctx: await contextFor(deps, provider),
    mode: isReady ? 'live' : 'dry_run',
  }

  const you = { name: 'you' }
  return startCall(
    deps,
    dialer,
    { campaignId: null, leadId: null, leadName: 'Test call to you', phone, kind: 'test' },
    {
      to: phone,
      leadName: 'there',
      firstLine: buildFirstLine(agent, you),
      prompt: buildPrompt(agent, you),
      captureFields: agent.captureFields,
    },
  )
}

async function startCall(
  deps: Deps,
  dialer: Extract<Dialer, { ok: true }>,
  who: Omit<CallInput, 'mode' | 'provider' | 'startedAt'>,
  request: DialRequest,
): Promise<DialResult> {
  const now = deps.now().toISOString()

  // Written BEFORE the API call on purpose. If the app dies mid-dial, this row
  // still counts as an attempt after restart, so nobody gets dialed twice.
  const call = await deps.store.createCall({
    ...who,
    mode: dialer.mode,
    provider: dialer.provider.name,
    startedAt: now,
  })
  deps.events.emit('calls')

  try {
    const { providerCallId } = await dialer.provider.placeCall(dialer.ctx, request)
    const updated = await deps.store.updateCall(call.id, { providerCallId, status: 'ringing', lastPolledAt: now })
    deps.events.emit('calls')
    return { placed: true, call: updated }
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), deps.secrets.allValues())
    const failed = await deps.store.updateCall(call.id, {
      status: 'ended',
      outcome: 'failed',
      error: message,
      endedAt: deps.now().toISOString(),
    })
    deps.events.emit('calls')
    return { placed: true, call: failed }
  }
}
