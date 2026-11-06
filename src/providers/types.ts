import type { Outcome, Turn } from '../types.ts'

export interface ProviderContext {
  key(env: string): string | undefined
  config: Record<string, string> // non-secret IDs, saved in the database
  fetch: typeof fetch
}

export interface KeyField {
  env: string // the name in .env
  label: string
  help: string // where to find it, shown in the wizard
  url: string
}

export interface ConfigField {
  name: string
  label: string
  required: boolean
  hint: string // tells Claude how to find or create this during setup
}

// Anything `npm run api` can reach. Twilio and Deepgram are only this: Claude
// uses them during setup, but the scheduler never dials through them.
export interface ApiTarget {
  name: string
  label: string
  keys: KeyField[]
  baseUrl: string
  authHeaders(ctx: ProviderContext): Record<string, string>
  // Endpoints that place calls. `npm run api` refuses these so that every call
  // has to go through the app's gate. Add new ones here if a platform grows them.
  dialPaths: RegExp[]
  // A harmless request that proves the key works.
  keyCheck(ctx: ProviderContext): { method: 'GET' | 'POST'; path: string; body?: unknown }
}

export interface DialRequest {
  to: string // E.164
  leadName: string
  firstLine: string // the opening line, with the AI disclosure
  prompt: string // the agent's full instructions for this call
  captureFields: string[]
}

export interface CallResult {
  status: 'queued' | 'ringing' | 'in_progress' | 'ended'
  outcome: Outcome | null // only set once ended
  durationSec: number | null
  turns: Turn[]
  summary: string | null
  captured: Record<string, unknown>
  optedOut: boolean // the platform itself flagged an opt-out
}

// A platform the scheduler can dial through. Add one by dropping a file in this
// folder that default-exports this shape. `_template.ts` is a starting point.
export interface VoiceProvider extends ApiTarget {
  rank: number // order in the setup wizard
  blurb: string
  config: ConfigField[]
  pollEveryMs: number
  placeCall(ctx: ProviderContext, request: DialRequest): Promise<{ providerCallId: string }>
  getCall(ctx: ProviderContext, providerCallId: string): Promise<CallResult>
}

export const isVoiceProvider = (target: ApiTarget): target is VoiceProvider => 'placeCall' in target
