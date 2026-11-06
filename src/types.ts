// The shapes everything else in the app passes around.

export type CallMode = 'dry_run' | 'live'
export type CallKind = 'campaign' | 'test'
export type CallStatus = 'dialing' | 'ringing' | 'in_progress' | 'ended'
export type Outcome = 'connected' | 'no_answer' | 'busy' | 'voicemail' | 'failed' | 'opted_out'
export type CampaignStatus = 'ready' | 'running' | 'paused' | 'stopped' | 'finished'

export interface Lead {
  id: number
  name: string
  phone: string // always E.164, e.g. +14155550142
  email: string | null
  timezone: string | null // IANA name, e.g. America/Chicago
  state: string | null // two-letter US state
  // Kept for the user's own records. dialdesk does not check these before dialing.
  consentSource: string | null
  consentDate: string | null
  notes: string | null
  createdAt: string
}

export type LeadInput = Omit<Lead, 'id' | 'createdAt'>

export interface Agent {
  id: number
  name: string
  businessName: string
  callerName: string
  goal: string
  firstLine: string // spoken first, must contain the AI disclosure
  script: string
  captureFields: string[] // what we want to learn from each call
  createdAt: string
  updatedAt: string
}

export type AgentInput = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>

export interface Campaign {
  id: number
  name: string
  agentId: number
  status: CampaignStatus
  days: number[] // 0 = Sunday ... 6 = Saturday
  windowStart: string // "09:00", in the lead's local time
  windowEnd: string // "20:00", in the lead's local time
  maxPerHour: number
  maxAttempts: number
  retryDelayMinutes: number
  createdAt: string
}

export type CampaignInput = Omit<Campaign, 'id' | 'status' | 'createdAt'>

export interface Turn {
  role: 'agent' | 'lead'
  text: string
}

export interface Call {
  id: number
  campaignId: number | null
  leadId: number | null
  leadName: string
  phone: string
  kind: CallKind
  mode: CallMode
  provider: string
  providerCallId: string | null
  status: CallStatus
  outcome: Outcome | null
  durationSec: number | null
  turns: Turn[]
  summary: string | null
  captured: Record<string, unknown>
  error: string | null
  startedAt: string
  endedAt: string | null
  lastPolledAt: string | null
}

export type CallInput = Pick<
  Call,
  'campaignId' | 'leadId' | 'leadName' | 'phone' | 'kind' | 'mode' | 'provider' | 'startedAt'
>

export interface DncEntry {
  phone: string
  source: 'opt_out' | 'manual' | 'import' | 'seed'
  reason: string | null
  addedAt: string
}

export interface SetupAnswers {
  businessName: string
  callerName: string
  whoYouCall: string
  callReason: string
  captureFields: string[]
}

export interface SetupState {
  complete: boolean
  answers: SetupAnswers
}
