import type { Outcome } from '../types.ts'
import { callApi, ProviderError } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// Written from Bland's API docs on 2026-11-02. Not yet run on a live call.
// https://docs.bland.ai/api-v1/post/calls
// https://docs.bland.ai/api-v1/get/calls-id

function outcomeOf(call: any): Outcome {
  if (call.answered_by === 'voicemail') return 'voicemail'
  if (call.status === 'busy') return 'busy'
  if (call.status === 'no-answer' || call.answered_by === 'no-answer') return 'no_answer'
  if (call.status === 'failed' || call.status === 'canceled') return 'failed'
  if (/error/.test(call.queue_status ?? '')) return 'failed'
  return 'connected'
}

const bland: VoiceProvider = {
  name: 'bland',
  label: 'Bland AI',
  rank: 1,
  blurb: "Calls go out from Bland's own US numbers, so you don't need to buy one.",
  keys: [
    {
      env: 'BLAND_API_KEY',
      label: 'API key',
      help: 'In your Bland dashboard, open Settings and copy your API key.',
      url: 'https://app.bland.ai',
    },
  ],
  config: [
    {
      name: 'fromNumber',
      label: 'Caller ID number',
      required: false,
      hint: "Optional. A number you own on Bland. Leave it out to use Bland's pool of US numbers.",
    },
  ],
  baseUrl: 'https://api.bland.ai',
  pollEveryMs: 15_000,
  dialPaths: [/^\/v\d+\/calls\b/, /^\/v\d+\/batches\b/],
  authHeaders: (ctx) => ({ Authorization: ctx.key('BLAND_API_KEY') ?? '' }),
  keyCheck: () => ({ method: 'GET', path: '/v1/me' }),

  async placeCall(ctx, request) {
    const data = await callApi(bland, ctx, {
      method: 'POST',
      path: '/v1/calls',
      json: {
        phone_number: request.to,
        task: request.prompt,
        first_sentence: request.firstLine,
        wait_for_greeting: true,
        record: true,
        ...(ctx.config.fromNumber ? { from: ctx.config.fromNumber } : {}),
      },
    })
    if (!data?.call_id) throw new ProviderError(`Bland didn't return a call ID: ${data?.message ?? 'no reason given'}`)
    return { providerCallId: data.call_id }
  },

  async getCall(ctx, providerCallId) {
    const call = await callApi(bland, ctx, { method: 'GET', path: `/v1/calls/${providerCallId}` })
    const ended = call.completed === true || call.queue_status === 'complete' || /error/.test(call.queue_status ?? '')

    if (!ended) {
      return {
        status: call.queue_status === 'started' ? 'in_progress' : 'queued',
        outcome: null,
        durationSec: null,
        turns: [],
        summary: null,
        captured: {},
        optedOut: false,
      }
    }

    const seconds = Number(call.corrected_duration)
    return {
      status: 'ended',
      outcome: outcomeOf(call),
      durationSec: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : Math.round((call.call_length ?? 0) * 60),
      turns: (call.transcripts ?? [])
        .filter((turn: any) => turn.user !== 'agent-action' && turn.text)
        .map((turn: any) => ({ role: turn.user === 'user' ? 'lead' : 'agent', text: turn.text })),
      summary: call.summary ?? null,
      captured: call.analysis ?? {},
      optedOut: false,
    }
  },
}

export default bland
