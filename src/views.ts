import { contextFor, currentMode, readinessOf, selectedProvider, type Deps } from './context.ts'
import { evaluateLead } from './dial.ts'
import { isVoiceProvider } from './providers/types.ts'
import { targets } from './providers/index.ts'
import type { Call, Campaign, Lead, Outcome, SetupState } from './types.ts'

// Read models: the exact shapes the screens (and Claude) ask for.

export const EMPTY_SETUP: SetupState = {
  complete: false,
  answers: { businessName: '', callerName: '', whoYouCall: '', callReason: '', captureFields: [] },
}

const OUTCOMES: Outcome[] = ['connected', 'no_answer', 'voicemail', 'busy', 'opted_out', 'failed']

function startOfToday(deps: Deps): string {
  const start = new Date(deps.now())
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

export async function dashboardView(deps: Deps) {
  const todays = (await deps.store.listCalls({ since: startOfToday(deps), limit: 5000 })).filter(
    (call) => call.kind === 'campaign',
  )
  const finished = todays.filter((call) => call.status === 'ended')
  const outcomes = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<Outcome, number>
  for (const call of finished) {
    if (call.outcome) outcomes[call.outcome]++
  }

  const reached = outcomes.connected + outcomes.opted_out
  const talked = finished.filter((call) => (call.durationSec ?? 0) > 0)
  const talkSeconds = talked.reduce((total, call) => total + (call.durationSec ?? 0), 0)

  const campaigns = await Promise.all((await deps.store.listCampaigns()).map((campaign) => campaignSummary(deps, campaign)))

  return {
    today: {
      calls: todays.length,
      finished: finished.length,
      reached,
      connectRate: finished.length > 0 ? reached / finished.length : null,
      averageSeconds: talked.length > 0 ? Math.round(talkSeconds / talked.length) : null,
      outcomes,
    },
    active: campaigns.filter((campaign) => campaign.status === 'running'),
    campaigns,
    live: (await deps.store.openCalls()).map(trimCall),
    recent: (await deps.store.listCalls({ limit: 12 })).map(trimCall),
  }
}

// Lists don't need the full transcript.
function trimCall(call: Call) {
  const { turns, captured, ...rest } = call
  return rest
}

export async function campaignSummary(deps: Deps, campaign: Campaign) {
  const leads = await deps.store.campaignLeads(campaign.id)
  const calls = await deps.store.listCalls({ campaignId: campaign.id, limit: 5000 })
  const reached = new Set(
    calls.filter((call) => call.outcome === 'connected' || call.outcome === 'opted_out').map((call) => call.phone),
  )
  return {
    ...campaign,
    leadCount: leads.length,
    callCount: calls.length,
    reachedCount: reached.size,
    notice: await noticeFor(deps, campaign.id),
  }
}

async function noticeFor(deps: Deps, campaignId: number): Promise<string | null> {
  const notices = await deps.store.getSetting<Record<string, string>>('campaign_notices', {})
  return notices[campaignId] ?? null
}

export type LeadState = 'calling' | 'ready' | 'waiting' | 'done' | 'reached'

export async function leadStates(deps: Deps, campaign: Campaign) {
  const agent = await deps.store.getAgent(campaign.agentId)
  if (!agent) return []
  const leads = await deps.store.campaignLeads(campaign.id)
  return Promise.all(
    leads.map(async (lead: Lead) => {
      const gate = await evaluateLead(deps, lead, campaign, agent)
      const history = (await deps.store.callsForPhone(lead.phone)).filter((call) => call.campaignId === campaign.id)
      let state: LeadState = 'ready'
      if (!gate.ok) {
        if (gate.code === 'call_open') state = 'calling'
        else if (gate.code === 'already_reached') state = 'reached'
        else state = gate.final ? 'done' : 'waiting'
      }
      return {
        lead,
        state,
        code: gate.ok ? null : gate.code,
        reason: gate.ok ? null : gate.reason,
        retryAt: gate.ok ? null : gate.retryAt ?? null,
        attempts: history.length,
        lastCallId: history.at(-1)?.id ?? null,
        lastOutcome: history.at(-1)?.outcome ?? null,
      }
    }),
  )
}

export async function campaignView(deps: Deps, campaign: Campaign) {
  const leads = await leadStates(deps, campaign)
  const counts: Record<LeadState, number> = { calling: 0, ready: 0, waiting: 0, done: 0, reached: 0 }
  for (const entry of leads) counts[entry.state]++
  return {
    campaign: await campaignSummary(deps, campaign),
    agent: await deps.store.getAgent(campaign.agentId),
    counts,
    leads,
    calls: (await deps.store.listCalls({ campaignId: campaign.id, limit: 50 })).map(trimCall),
  }
}

export async function providersView(deps: Deps) {
  const selected = await selectedProvider(deps)
  const keyState = (target: (typeof targets)[number]) =>
    target.keys.map((key) => ({ ...key, set: deps.secrets.has(key.env) }))

  const voice = await Promise.all(
    deps.providers
      .filter((provider) => provider.name !== 'mock')
      .map(async (provider) => {
        const ctx = await contextFor(deps, provider)
        return {
          name: provider.name,
          label: provider.label,
          blurb: provider.blurb,
          selected: selected?.name === provider.name,
          keys: keyState(provider),
          config: provider.config.map((field) => ({ ...field, value: ctx.config[field.name] ?? null })),
          ...(await readinessOf(deps, provider)),
        }
      }),
  )

  const services = targets
    .filter((target) => !isVoiceProvider(target))
    .map((target) => ({ name: target.name, label: target.label, keys: keyState(target) }))

  return { voice, services }
}

export async function statusView(deps: Deps) {
  const setup = await deps.store.getSetting('setup', EMPTY_SETUP)
  const provider = await selectedProvider(deps)
  const readiness = provider ? await readinessOf(deps, provider) : null
  const agents = await deps.store.listAgents()
  const myPhone = deps.secrets.get('MY_PHONE')

  // What's left to do, in order. Claude reads this to decide what to do next.
  const nextSteps: string[] = []
  if (!setup.complete) nextSteps.push('Finish the setup wizard.')
  if (!provider) nextSteps.push('Choose a voice platform to make real calls. Until then everything is simulated.')
  for (const env of readiness?.missingKeys ?? []) nextSteps.push(`Add ${env} in the setup wizard.`)
  for (const name of readiness?.missingConfig ?? []) nextSteps.push(`Set ${name} for ${provider!.label}. See src/providers/recipes/${provider!.name}.md.`)
  if (!myPhone) nextSteps.push('Add your own phone number in the setup wizard, for test calls.')

  return {
    mode: currentMode(deps),
    setupComplete: setup.complete,
    provider: provider ? { name: provider.name, label: provider.label, ...readiness } : null,
    myPhone: myPhone ? { set: true, lastFour: myPhone.slice(-4) } : { set: false, lastFour: null },
    agentCount: agents.length,
    nextSteps,
  }
}
