import type { Outcome } from '../types.ts'
import { callApi, parseTranscript, secondsBetween } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// Written from Vapi's API docs on 2026-11-02. Not yet run on a live call.
// https://docs.vapi.ai/api-reference/calls/create
// https://docs.vapi.ai/api-reference/calls/get

function outcomeOf(endedReason: string): Outcome {
  if (endedReason === 'customer-did-not-answer') return 'no_answer'
  if (endedReason === 'customer-busy') return 'busy'
  if (endedReason === 'voicemail') return 'voicemail'
  if (/error|failed|fault/.test(endedReason)) return 'failed'
  return 'connected'
}

function captureSchema(fields: string[]) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
  }
}

const vapi: VoiceProvider = {
  name: 'vapi',
  label: 'Vapi',
  rank: 2,
  blurb: 'Lots of control over voices and models. Needs a Twilio number, because free Vapi numbers can only take calls.',
  keys: [
    {
      env: 'VAPI_API_KEY',
      label: 'Private API key',
      help: 'In the Vapi dashboard, open API Keys and copy the private key, not the public one.',
      url: 'https://dashboard.vapi.ai',
    },
  ],
  config: [
    {
      name: 'phoneNumberId',
      label: 'Phone number ID',
      required: true,
      hint: 'The ID of a number imported into Vapi. List them with GET /phone-number. See recipes/vapi.md.',
    },
    {
      name: 'model',
      label: 'OpenAI model',
      required: false,
      hint: 'Optional. Defaults to gpt-4o-mini.',
    },
  ],
  baseUrl: 'https://api.vapi.ai',
  pollEveryMs: 15_000,
  dialPaths: [/^\/call\b/, /^\/campaign\b/],
  authHeaders: (ctx) => ({ Authorization: `Bearer ${ctx.key('VAPI_API_KEY') ?? ''}` }),
  keyCheck: () => ({ method: 'GET', path: '/assistant?limit=1' }),

  async placeCall(ctx, request) {
    const call = await callApi(vapi, ctx, {
      method: 'POST',
      path: '/call',
      json: {
        phoneNumberId: ctx.config.phoneNumberId,
        customer: { number: request.to, name: request.leadName },
        // A transient assistant, so the script always comes from this app.
        assistant: {
          firstMessage: request.firstLine,
          firstMessageMode: 'assistant-speaks-first',
          model: {
            provider: 'openai',
            model: ctx.config.model || 'gpt-4o-mini',
            messages: [{ role: 'system', content: request.prompt }],
          },
          ...(request.captureFields.length > 0
            ? { analysisPlan: { structuredDataSchema: captureSchema(request.captureFields) } }
            : {}),
        },
      },
    })
    return { providerCallId: call.id }
  },

  async getCall(ctx, providerCallId) {
    const call = await callApi(vapi, ctx, { method: 'GET', path: `/call/${providerCallId}` })

    if (call.status !== 'ended') {
      return {
        status: call.status === 'in-progress' || call.status === 'forwarding' ? 'in_progress' : call.status === 'ringing' ? 'ringing' : 'queued',
        outcome: null,
        durationSec: null,
        turns: [],
        summary: null,
        captured: {},
        optedOut: false,
      }
    }

    const messages: any[] = call.artifact?.messages ?? []
    const spoken = messages.filter((message) => message.role === 'user' || message.role === 'bot' || message.role === 'assistant')
    return {
      status: 'ended',
      outcome: outcomeOf(call.endedReason ?? ''),
      durationSec: secondsBetween(call.startedAt, call.endedAt),
      turns: spoken.length > 0
        ? spoken.map((message) => ({ role: message.role === 'user' ? 'lead' : 'agent', text: message.message ?? '' }))
        : parseTranscript(call.artifact?.transcript),
      summary: call.analysis?.summary ?? null,
      captured: call.analysis?.structuredData ?? {},
      optedOut: false,
    }
  },
}

export default vapi
