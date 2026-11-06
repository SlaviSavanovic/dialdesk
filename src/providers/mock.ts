import type { Outcome, Turn } from '../types.ts'
import type { CallResult, DialRequest, VoiceProvider } from './types.ts'

// Simulates phone calls so the whole app works with no accounts. Used for
// everything while dry run is on. A call's fate comes from a hash of its ID, so
// it survives an app restart without storing anything.

const RING_MS = 3000

function randomFrom(seed: string) {
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296
  }
}

function pickOutcome(roll: number): Outcome {
  if (roll < 0.55) return 'connected'
  if (roll < 0.78) return 'no_answer'
  if (roll < 0.88) return 'voicemail'
  if (roll < 0.93) return 'busy'
  if (roll < 0.97) return 'opted_out'
  return 'failed'
}

function fakeAnswer(field: string, random: () => number): string {
  const choose = (options: string[]) => options[Math.floor(random() * options.length)]
  if (/interest|still|confirm/i.test(field)) return 'Yes'
  if (/day|time|when|date/i.test(field)) return choose(['Tuesday morning', 'Thursday after 3', 'Saturday at 10'])
  if (/type|kind|job/i.test(field)) return choose(['Repair', 'Full replacement', 'Inspection'])
  if (/leak|urgent|asap/i.test(field)) return choose(['Yes', 'No'])
  return choose(['Yes', 'No', 'Not sure yet'])
}

// The numbered questions in the agent's script, so a simulated call asks what the
// real one would, in the same order.
export function questionsIn(prompt: string): string[] {
  return [...prompt.matchAll(/^\s*\d+[.)]\s+(.+\?)\s*$/gm)].map((match) => match[1].trim())
}

function spoken(field: string, value: unknown): string {
  const text = String(value)
  if (/day|time|when|date/i.test(field)) return `${text} works for me.`
  if (text === 'Yes') return /interest|still|confirm/i.test(field) ? 'Yeah, I am.' : 'Yes.'
  if (text === 'No') return 'No.'
  if (/type|kind|job/i.test(field)) return `${text}, I think.`
  return `${text}.`
}

const ACKNOWLEDGE = ['Got it.', 'Okay.', 'Thanks.']

// The lead's answers are the captured values, so the transcript and "what we found
// out" always agree.
export function transcriptFor(outcome: Outcome, request: Pick<DialRequest, 'firstLine' | 'prompt' | 'captureFields'>, captured: Record<string, unknown>): Turn[] {
  const { firstLine } = request
  if (outcome === 'voicemail') {
    return [{ role: 'agent', text: `${firstLine} Sorry I missed you. We'll try you again another time.` }]
  }
  if (outcome === 'opted_out') {
    return [
      { role: 'agent', text: firstLine },
      { role: 'lead', text: 'Please stop calling me.' },
      { role: 'agent', text: "Understood, I'll take you off our list. Sorry to bother you." },
    ]
  }
  if (outcome !== 'connected') return []

  const dayField = request.captureFields.find((field) => /day|time|when|date/i.test(field))
  const day = dayField && captured[dayField] ? String(captured[dayField]) : 'Tuesday morning'
  const questions = questionsIn(request.prompt)
  if (questions.length === 0) {
    return [
      { role: 'agent', text: firstLine },
      { role: 'lead', text: "Okay, what's this about?" },
      { role: 'agent', text: 'You reached out to us recently. Are you still looking for help with this?' },
      { role: 'lead', text: 'Yeah, I am.' },
      { role: 'agent', text: 'Great. What day works best for someone to follow up?' },
      { role: 'lead', text: `${day} is good.` },
      { role: 'agent', text: `Perfect, I've got ${day}. Thanks for your time.` },
    ]
  }

  const turns: Turn[] = [
    { role: 'agent', text: firstLine },
    { role: 'lead', text: "Okay, what's this about?" },
  ]
  questions.forEach((question, i) => {
    const lead = i === 0 ? 'You reached out to us recently.' : ACKNOWLEDGE[(i - 1) % ACKNOWLEDGE.length]
    const field = request.captureFields[i]
    turns.push({ role: 'agent', text: `${lead} ${question}` })
    turns.push({ role: 'lead', text: field && captured[field] !== undefined ? spoken(field, captured[field]) : 'Yes.' })
  })
  turns.push({ role: 'agent', text: dayField ? `Perfect, I've got you down for ${day}. Thanks for your time.` : 'Perfect. Thanks for your time.' })
  return turns
}

const SUMMARIES: Partial<Record<Outcome, string>> = {
  connected: 'Simulated call. The lead is still interested and picked a time for a follow-up.',
  voicemail: 'Simulated call. Reached voicemail and left a short message.',
  opted_out: 'Simulated call. The lead asked not to be called again.',
}

// Only used to fill in the transcript. After a restart it falls back to a generic call.
const requests = new Map<string, DialRequest>()

function resultFor(id: string, now: number): CallResult {
  const startedAt = Number(id.split('_')[1])
  const random = randomFrom(id)
  const outcome = pickOutcome(random())
  const talkMs = outcome === 'connected' ? 8000 + random() * 8000 : 2500
  const elapsed = now - startedAt
  const empty = { outcome: null, durationSec: null, turns: [], summary: null, captured: {}, optedOut: false }

  if (elapsed < RING_MS) return { status: 'ringing', ...empty }
  if (elapsed < RING_MS + talkMs && outcome !== 'no_answer' && outcome !== 'busy' && outcome !== 'failed') {
    return { status: 'in_progress', ...empty }
  }

  const request = requests.get(id)
  const captured: Record<string, unknown> = {}
  if (outcome === 'connected') {
    for (const field of request?.captureFields ?? []) captured[field] = fakeAnswer(field, random)
  }

  return {
    status: 'ended',
    outcome: outcome === 'opted_out' ? 'connected' : outcome, // the opt-out is found by reading the transcript, as it is for real calls
    durationSec: outcome === 'connected' ? Math.round(45 + random() * 150) : outcome === 'no_answer' || outcome === 'busy' || outcome === 'failed' ? 0 : Math.round(12 + random() * 20),
    turns: transcriptFor(outcome, request ?? { firstLine: 'Hi, this is an AI assistant calling.', prompt: '', captureFields: [] }, captured),
    summary: SUMMARIES[outcome] ?? null,
    captured,
    optedOut: false,
  }
}

const mock: VoiceProvider = {
  name: 'mock',
  label: 'Simulator',
  rank: 0,
  blurb: 'Simulated calls with no account and no phone number.',
  keys: [],
  config: [],
  baseUrl: '',
  pollEveryMs: 1000,
  dialPaths: [],
  authHeaders: () => ({}),
  keyCheck: () => ({ method: 'GET', path: '/' }),

  async placeCall(_ctx, request) {
    const providerCallId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    requests.set(providerCallId, request)
    return { providerCallId }
  },

  async getCall(_ctx, providerCallId) {
    return resultFor(providerCallId, Date.now())
  },
}

export default mock
