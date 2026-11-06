import type { Outcome } from '../types.ts'
import { bearer, callApi, parseTranscript, ProviderError } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// Written from Synthflow's API docs on 2026-11-02. Not yet run on a live call.
// https://docs.synthflow.ai/api-reference/platform-api/calls/voice-call
// https://docs.synthflow.ai/api-reference/platform-api/calls/get-phone-call

const ENDED = new Set([
  'completed', 'no-answer', 'busy', 'failed', 'canceled', 'user-canceled',
  'hangup_on_voicemail', 'left_voicemail', 'spam',
])

function outcomeOf(call: any): Outcome {
  switch (call.status) {
    case 'no-answer':
      return 'no_answer'
    case 'busy':
      return 'busy'
    case 'hangup_on_voicemail':
    case 'left_voicemail':
      return 'voicemail'
    case 'failed':
    case 'canceled':
    case 'user-canceled':
    case 'spam':
      return 'failed'
  }
  if (/voicemail/.test(call.end_call_reason ?? '')) return 'voicemail'
  return 'connected'
}

// TODO: confirm the response nesting on a live call. The docs describe a call
// object, and other Synthflow responses wrap results in `response`.
const unwrap = (data: any) => data?.response?.calls?.[0] ?? data?.response ?? data

const synthflow: VoiceProvider = {
  name: 'synthflow',
  label: 'Synthflow',
  rank: 5,
  blurb: 'Build agents visually in their dashboard. You create the agent once there, then dialdesk calls with it.',
  keys: [
    {
      env: 'SYNTHFLOW_API_KEY',
      label: 'API key',
      help: 'In the Synthflow dashboard, open Integrations and copy your API key.',
      url: 'https://app.synthflow.ai',
    },
  ],
  config: [
    {
      name: 'modelId',
      label: 'Agent ID',
      required: true,
      hint: "The agent's ID, shown on its page in the dashboard or listed with GET /v2/assistants. See recipes/synthflow.md.",
    },
    {
      name: 'fromNumber',
      label: 'Caller ID number',
      required: false,
      hint: 'Optional. Must be a number attached to the agent.',
    },
  ],
  baseUrl: 'https://api.synthflow.ai',
  pollEveryMs: 15_000,
  dialPaths: [/^\/v\d+\/calls\b/],
  authHeaders: (ctx) => bearer(ctx, 'SYNTHFLOW_API_KEY'),
  keyCheck: () => ({ method: 'GET', path: '/v2/assistants?limit=1' }),

  async placeCall(ctx, request) {
    const data = await callApi(synthflow, ctx, {
      method: 'POST',
      path: '/v2/calls',
      json: {
        model_id: ctx.config.modelId,
        phone: request.to,
        name: request.leadName,
        prompt: request.prompt,
        greeting: request.firstLine,
        ...(ctx.config.fromNumber ? { from_phone_number: ctx.config.fromNumber } : {}),
      },
    })
    const callId = data?.response?.call_id
    if (!callId) throw new ProviderError("Synthflow didn't return a call ID.")
    return { providerCallId: callId }
  },

  async getCall(ctx, providerCallId) {
    const call = unwrap(await callApi(synthflow, ctx, { method: 'GET', path: `/v2/calls/${providerCallId}` }))

    if (!ENDED.has(call.status)) {
      return {
        status: call.status === 'in-progress' ? 'in_progress' : call.status === 'ringing' ? 'ringing' : 'queued',
        outcome: null,
        durationSec: null,
        turns: [],
        summary: null,
        captured: {},
        optedOut: false,
      }
    }

    return {
      status: 'ended',
      outcome: outcomeOf(call),
      durationSec: call.duration ?? null,
      turns: parseTranscript(call.transcript),
      summary: null, // Synthflow's docs don't list a summary field
      captured: call.collected_variables ?? {},
      optedOut: false,
    }
  },
}

export default synthflow
