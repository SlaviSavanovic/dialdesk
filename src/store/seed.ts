import { ALL_DAYS, DEFAULT_END, DEFAULT_START } from '../timezones.ts'
import { defaultFirstLine } from '../script.ts'
import type { Store } from './types.ts'

const EXAMPLE_SCRIPT = `You're following up with someone who filled out a form asking for a roof quote.

Ask these in order, one at a time. Stop as soon as an answer makes the rest pointless.

1. Are you still looking to get your roof looked at?
   If no: thank them and end the call.
2. Is anything leaking right now?
   If yes: tell them we'll treat this as urgent.
3. Is this a repair, or are you thinking about a full replacement?
4. What day works best for someone to come out?

Then confirm the day, thank them, and end the call.`

// All fictional. The 555-01xx range is reserved for fiction and can't reach anyone.
const LEADS = [
  { name: 'Maya Chen', phone: '+14155550142', state: 'CA', email: 'maya@example.com', notes: 'Asked about a repair.' },
  { name: 'Priya Nair', phone: '+16465550188', state: 'NY', email: 'priya@example.com', notes: 'Roof is about 20 years old.' },
  { name: 'Kai Akana', phone: '+18085550123', state: 'HI', email: 'kai@example.com', notes: 'Prefers mornings.' },
  // Shows the gate on first run: no location, so its local time can't be known.
  { name: 'Sam Rivera', phone: '+12025550199', state: null, email: 'sam@example.com', notes: 'Form had no address.' },
  // Shows the gate on first run: already asked not to be called.
  { name: 'Alex Novak', phone: '+13125550165', state: 'IL', email: 'alex@example.com', notes: 'Asked not to be called.' },
]

export async function seedIfEmpty(store: Store, now: string) {
  if (await store.getSetting('seeded', false)) return

  const agent = await store.createAgent(
    {
      name: 'Roof quote follow-up',
      businessName: 'Summit Roofing',
      callerName: 'Ava',
      goal: 'Find out if they still want a quote, how urgent it is, and when someone can come out.',
      firstLine: defaultFirstLine('Ava', 'Summit Roofing'),
      script: EXAMPLE_SCRIPT,
      captureFields: ['still_interested', 'leak_now', 'job_type', 'best_day'],
    },
    now,
  )

  const leadIds: number[] = []
  for (const lead of LEADS) {
    const { lead: saved } = await store.upsertLead(
      { ...lead, timezone: null, consentSource: 'Example data', consentDate: now.slice(0, 10) },
      now,
    )
    leadIds.push(saved.id)
  }

  await store.addDnc({ phone: '+13125550165', source: 'seed', reason: 'Example entry', addedAt: now })

  const campaign = await store.createCampaign(
    {
      name: 'Roof quote follow-ups (example)',
      agentId: agent.id,
      days: ALL_DAYS,
      windowStart: DEFAULT_START,
      windowEnd: DEFAULT_END,
      maxPerHour: 60,
      maxAttempts: 3,
      retryDelayMinutes: 240,
    },
    now,
  )
  await store.addCampaignLeads(campaign.id, leadIds)

  await store.setSetting('seeded', true)
}
