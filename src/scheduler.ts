import { contextFor, type Deps } from './context.ts'
import { dialLead, evaluateLead } from './dial.ts'
import { detectOptOut } from './optout.ts'
import { redact } from './secrets.ts'
import type { CallResult } from './providers/types.ts'
import type { Call, Campaign } from './types.ts'

const TICK_MS = 2_000
// A call with no provider ID this long after dialing means the app died mid-dial.
const STUCK_DIALING_MS = 2 * 60_000
// Stop waiting on a call the platform will no longer tell us about.
const GIVE_UP_MS = 6 * 60 * 60_000

export function createScheduler(deps: Deps) {
  let timer: NodeJS.Timeout | null = null
  let busy = false

  // One pass: read the results of open calls first, because an opt-out in one of
  // them has to count before anything new gets dialed.
  async function tick() {
    if (busy) return
    busy = true
    try {
      await pollOpenCalls(deps)
      await dialNextLeads(deps)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Scheduler problem:', redact(message, deps.secrets.allValues()))
    } finally {
      busy = false
    }
  }

  return {
    tick,
    start() {
      // All state is in the database, so starting up after a crash needs no
      // special handling. The first tick picks up wherever things were.
      timer = setInterval(tick, TICK_MS)
      void tick()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

const ageOf = (deps: Deps, time: string) => deps.now().getTime() - new Date(time).getTime()

async function pollOpenCalls(deps: Deps) {
  for (const call of await deps.store.openCalls()) {
    const provider = deps.providers.find((candidate) => candidate.name === call.provider)

    if (!call.providerCallId) {
      if (ageOf(deps, call.startedAt) > STUCK_DIALING_MS) {
        await closeAsFailed(deps, call, "The app stopped before this call was confirmed, so it isn't known whether it rang.")
      }
      continue
    }

    if (!provider) {
      await closeAsFailed(deps, call, `The ${call.provider} adapter is no longer installed.`)
      continue
    }

    if (call.lastPolledAt && ageOf(deps, call.lastPolledAt) < provider.pollEveryMs) continue

    try {
      const result = await provider.getCall(await contextFor(deps, provider), call.providerCallId)
      await applyResult(deps, call, result)
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), deps.secrets.allValues())
      if (ageOf(deps, call.startedAt) > GIVE_UP_MS) {
        await closeAsFailed(deps, call, `Gave up waiting for a result. Last error: ${message}`)
      } else {
        await deps.store.updateCall(call.id, { error: message, lastPolledAt: deps.now().toISOString() })
      }
    }
  }
}

async function applyResult(deps: Deps, call: Call, result: CallResult) {
  const now = deps.now().toISOString()

  if (result.status !== 'ended') {
    const status = result.status === 'in_progress' ? 'in_progress' : 'ringing'
    await deps.store.updateCall(call.id, { status, lastPolledAt: now, error: null })
    if (status !== call.status) deps.events.emit('calls')
    return
  }

  // Added to the list before the call is marked ended, so there's never a moment
  // when the number looks free to dial again.
  const optedOut = result.optedOut || detectOptOut(result.turns)
  if (optedOut) {
    await deps.store.addDnc({
      phone: call.phone,
      source: 'opt_out',
      reason: `Asked to stop on call #${call.id}`,
      addedAt: now,
    })
    deps.events.emit('dnc')
  }

  await deps.store.updateCall(call.id, {
    status: 'ended',
    outcome: optedOut ? 'opted_out' : result.outcome ?? 'failed',
    durationSec: result.durationSec,
    turns: result.turns,
    summary: result.summary,
    captured: result.captured,
    endedAt: now,
    lastPolledAt: now,
    error: null,
  })
  deps.events.emit('calls')
}

async function closeAsFailed(deps: Deps, call: Call, error: string) {
  await deps.store.updateCall(call.id, {
    status: 'ended',
    outcome: 'failed',
    error,
    endedAt: deps.now().toISOString(),
  })
  deps.events.emit('calls')
}

async function dialNextLeads(deps: Deps) {
  const open = await deps.store.openCalls()
  for (const campaign of await deps.store.listCampaigns()) {
    if (campaign.status !== 'running') continue
    // One call at a time per campaign. Platforms have concurrency limits, and it
    // keeps the hourly cap simple.
    if (open.some((call) => call.campaignId === campaign.id)) continue
    await dialNextLead(deps, campaign)
  }
}

async function dialNextLead(deps: Deps, campaign: Campaign) {
  const agent = await deps.store.getAgent(campaign.agentId)
  if (!agent) return

  let allFinal = true
  for (const lead of await deps.store.campaignLeads(campaign.id)) {
    const gate = await evaluateLead(deps, lead, campaign, agent)
    if (gate.ok) {
      const result = await dialLead(deps, lead, campaign, agent)
      // If the platform refused the call (a bad key, no credit), it would refuse
      // the next one too. Pausing stops a bad key using up every lead's attempts.
      const problem = !result.placed ? result.reason : result.call.error
      if (problem) await pauseWithNotice(deps, campaign, problem)
      return
    }
    if (!gate.final) allFinal = false
  }

  if (allFinal) {
    await deps.store.setCampaignStatus(campaign.id, 'finished')
    deps.events.emit('campaigns')
  }
}

async function pauseWithNotice(deps: Deps, campaign: Campaign, message: string) {
  await deps.store.setCampaignStatus(campaign.id, 'paused')
  const notices = await deps.store.getSetting<Record<string, string>>('campaign_notices', {})
  await deps.store.setSetting('campaign_notices', { ...notices, [campaign.id]: message })
  deps.events.emit('campaigns')
}
