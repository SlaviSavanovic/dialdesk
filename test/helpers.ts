import type { Deps } from '../src/context.ts'
import { createEvents } from '../src/events.ts'
import mock from '../src/providers/mock.ts'
import type { CallResult, DialRequest, VoiceProvider } from '../src/providers/types.ts'
import type { Secrets } from '../src/secrets.ts'
import { createSqliteStore } from '../src/store/sqlite.ts'
import type { Agent, Campaign, Lead } from '../src/types.ts'

export function memorySecrets(initial: Record<string, string> = {}): Secrets {
  const values = { ...initial }
  return {
    get: (name) => values[name] || undefined,
    has: (name) => Boolean(values[name]),
    set: (next) => Object.assign(values, next),
    allValues: () => Object.values(values).filter(Boolean),
  }
}

// A provider that records what it was asked and returns whatever the test says.
export function fakeProvider(result: Partial<CallResult> = {}) {
  const placed: DialRequest[] = []
  const provider: VoiceProvider = {
    name: 'fake',
    label: 'Fake',
    rank: 1,
    blurb: '',
    keys: [{ env: 'FAKE_KEY', label: 'Key', help: '', url: '' }],
    config: [],
    baseUrl: 'https://fake.test',
    pollEveryMs: 0,
    dialPaths: [],
    authHeaders: () => ({}),
    keyCheck: () => ({ method: 'GET', path: '/' }),
    async placeCall(_ctx, request) {
      placed.push(request)
      return { providerCallId: `fake_${placed.length}` }
    },
    async getCall() {
      return {
        status: 'ended',
        outcome: 'no_answer',
        durationSec: 0,
        turns: [],
        summary: null,
        captured: {},
        optedOut: false,
        ...result,
      }
    },
  }
  return { provider, placed, setResult: (next: Partial<CallResult>) => Object.assign(result, next) }
}

// 3pm on a Wednesday in New York.
export const WEDNESDAY_3PM_NY = new Date('2026-06-03T19:00:00Z')

export function makeDeps(overrides: Partial<Deps> = {}) {
  let current = WEDNESDAY_3PM_NY
  const deps: Deps = {
    store: createSqliteStore(':memory:'),
    secrets: memorySecrets(),
    events: createEvents(),
    providers: [mock],
    now: () => current,
    fetch: (() => {
      throw new Error('A test tried to reach the network.')
    }) as unknown as typeof fetch,
    ...overrides,
  }
  return {
    deps,
    setNow: (time: Date) => {
      current = time
    },
    advanceMinutes: (minutes: number) => {
      current = new Date(current.getTime() + minutes * 60_000)
    },
  }
}

export const NOW = WEDNESDAY_3PM_NY.toISOString()

export async function addLead(deps: Deps, name: string, phone: string, state: string | null = 'NY'): Promise<Lead> {
  const { lead } = await deps.store.upsertLead(
    { name, phone, state, timezone: null, email: null, consentSource: null, consentDate: null, notes: null },
    NOW,
  )
  return lead
}

export async function addAgent(deps: Deps, firstLine = 'Hi, this is Ava, an AI assistant.'): Promise<Agent> {
  return deps.store.createAgent(
    { name: 'Agent', businessName: 'Biz', callerName: 'Ava', goal: 'Goal', firstLine, script: 'Script', captureFields: [] },
    NOW,
  )
}

export async function addCampaign(deps: Deps, agentId: number, leadIds: number[], patch: Partial<Campaign> = {}) {
  const campaign = await deps.store.createCampaign(
    {
      name: 'Campaign',
      agentId,
      days: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '09:00',
      windowEnd: '20:00',
      maxPerHour: 100,
      maxAttempts: 3,
      retryDelayMinutes: 60,
      ...patch,
    },
    NOW,
  )
  await deps.store.addCampaignLeads(campaign.id, leadIds)
  await deps.store.setCampaignStatus(campaign.id, 'running')
  return (await deps.store.getCampaign(campaign.id))!
}
