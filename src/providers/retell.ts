import type { Outcome } from '../types.ts'
import { callApi, parseTranscript } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// Written from Retell's API docs on 2026-11-02. Not yet run on a live call.
// https://docs.retellai.com/api-references/create-phone-call
// https://docs.retellai.com/api-references/get-call
//
// Retell can override the first line per call but not the prompt. So the agent's
// prompt on Retell must be just {{dialdesk_prompt}}, and we fill that variable
// on each call. recipes/retell.md covers setting that up.

function outcomeOf(call: any): Outcome {
  const reason: string = call.disconnection_reason ?? ''
  if (call.call_analysis?.in_voicemail || reason === 'voicemail_reached') return 'voicemail'
  if (reason === 'dial_no_answer') return 'no_answer'
  if (reason === 'dial_busy') return 'busy'
  if (call.call_status === 'not_connected' || call.call_status === 'error') return 'failed'
  if (/dial_failed|error/.test(reason)) return 'failed'
  return 'connected'
}

const retell: VoiceProvider = {
  name: 'retell',
  label: 'Retell AI',
  rank: 3,
  blurb: 'Strong for natural conversation. You can buy a phone number directly from Retell or bring your own.',
  keys: [
    {
      env: 'RETELL_API_KEY',
      label: 'API key',
      help: 'In the Retell dashboard, open API Keys and copy your key.',
      url: 'https://dashboard.retellai.com',
    },
  ],
  config: [
    {
      name: 'fromNumber',
      label: 'Your Retell phone number',
      required: true,
      hint: 'A number on the account, in E.164 format. List them with GET /list-phone-numbers. See recipes/retell.md.',
    },
    {
      name: 'agentId',
      label: 'Agent ID',
      required: true,
      hint: 'An agent whose prompt is exactly {{dialdesk_prompt}}. See recipes/retell.md.',
    },
  ],
  baseUrl: 'https://api.retellai.com',
  pollEveryMs: 15_000,
  dialPaths: [/^(\/v\d+)?\/create-phone-call\b/, /^(\/v\d+)?\/create-batch-call\b/],
  authHeaders: (ctx) => ({ Authorization: `Bearer ${ctx.key('RETELL_API_KEY') ?? ''}` }),
  keyCheck: () => ({
    method: 'POST',
    path: '/v2/list-agents?limit=1',
    body: { filter_criteria: { channel: { op: 'eq', value: 'voice' } } },
  }),

  async placeCall(ctx, request) {
    const call = await callApi(retell, ctx, {
      method: 'POST',
      path: '/v2/create-phone-call',
      json: {
        from_number: ctx.config.fromNumber,
        to_number: request.to,
        override_agent_id: ctx.config.agentId,
        retell_llm_dynamic_variables: { dialdesk_prompt: request.prompt, lead_name: request.leadName },
        agent_override: { retell_llm: { begin_message: request.firstLine } },
      },
    })
    return { providerCallId: call.call_id }
  },

  async getCall(ctx, providerCallId) {
    const call = await callApi(retell, ctx, { method: 'GET', path: `/v2/get-call/${providerCallId}` })
    const ended = ['ended', 'error', 'not_connected'].includes(call.call_status)

    if (!ended) {
      return {
        status: call.call_status === 'ongoing' ? 'in_progress' : 'queued',
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
      durationSec: call.duration_ms != null ? Math.round(call.duration_ms / 1000) : null,
      turns: parseTranscript(call.transcript),
      summary: call.call_analysis?.call_summary ?? null,
      captured: call.call_analysis?.custom_analysis_data ?? {},
      optedOut: false,
    }
  },
}

export default retell
