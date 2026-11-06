import type { Outcome, Turn } from '../types.ts'
import { callApi, ProviderError } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// Written from ElevenLabs' API docs on 2026-11-02. Not yet run on a live call.
// https://elevenlabs.io/docs/eleven-agents/api-reference/twilio/outbound-call
// https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get
//
// Per-call overrides are off by default on ElevenLabs. If they aren't enabled on
// the agent the call gets rejected, so recipes/elevenlabs.md turns them on first.

function outcomeOf(conversation: any, turns: Turn[]): Outcome {
  const reason = String(conversation.metadata?.termination_reason ?? '').toLowerCase()
  if (reason.includes('voicemail')) return 'voicemail'
  if (reason.includes('busy')) return 'busy'
  if (reason.includes('no answer') || reason.includes('no-answer')) return 'no_answer'
  if (conversation.status === 'failed') return 'failed'
  // The docs don't list a no-answer status, so this goes by whether anyone spoke.
  return turns.some((turn) => turn.role === 'lead') ? 'connected' : 'no_answer'
}

function collected(conversation: any): Record<string, unknown> {
  const results: Record<string, any> = conversation.analysis?.data_collection_results ?? {}
  return Object.fromEntries(Object.entries(results).map(([name, result]) => [name, result?.value]))
}

const elevenlabs: VoiceProvider = {
  name: 'elevenlabs',
  label: 'ElevenLabs',
  rank: 4,
  blurb: 'The most natural voices. Needs a Twilio or SIP number connected to your account.',
  keys: [
    {
      env: 'ELEVENLABS_API_KEY',
      label: 'API key',
      help: 'In ElevenLabs, open your settings, then API Keys, and create a key.',
      url: 'https://elevenlabs.io/app/settings/api-keys',
    },
  ],
  config: [
    {
      name: 'agentId',
      label: 'Agent ID',
      required: true,
      hint: 'An agent with first message and prompt overrides enabled. See recipes/elevenlabs.md.',
    },
    {
      name: 'phoneNumberId',
      label: 'Phone number ID',
      required: true,
      hint: 'The ID of a number connected to ElevenLabs. See recipes/elevenlabs.md.',
    },
    {
      name: 'phoneType',
      label: 'Phone type',
      required: false,
      hint: 'Either twilio or sip. Defaults to twilio.',
    },
  ],
  baseUrl: 'https://api.elevenlabs.io',
  pollEveryMs: 15_000,
  dialPaths: [/outbound-call\b/, /batch-calling\b/],
  authHeaders: (ctx) => ({ 'xi-api-key': ctx.key('ELEVENLABS_API_KEY') ?? '' }),
  keyCheck: () => ({ method: 'GET', path: '/v1/convai/agents?page_size=1' }),

  async placeCall(ctx, request) {
    const trunk = ctx.config.phoneType === 'sip' ? 'sip-trunk' : 'twilio'
    const data = await callApi(elevenlabs, ctx, {
      method: 'POST',
      path: `/v1/convai/${trunk}/outbound-call`,
      json: {
        agent_id: ctx.config.agentId,
        agent_phone_number_id: ctx.config.phoneNumberId,
        to_number: request.to,
        conversation_initiation_client_data: {
          dynamic_variables: { lead_name: request.leadName },
          conversation_config_override: {
            agent: {
              first_message: request.firstLine,
              prompt: { prompt: request.prompt },
            },
          },
        },
      },
    })
    if (!data?.conversation_id) {
      throw new ProviderError(`ElevenLabs didn't start the call: ${data?.message ?? 'no reason given'}`)
    }
    return { providerCallId: data.conversation_id }
  },

  async getCall(ctx, providerCallId) {
    const conversation = await callApi(elevenlabs, ctx, {
      method: 'GET',
      path: `/v1/convai/conversations/${providerCallId}`,
    })

    // "processing" means the call is over but the transcript isn't ready yet.
    if (conversation.status !== 'done' && conversation.status !== 'failed') {
      return {
        status: conversation.status === 'initiated' ? 'queued' : 'in_progress',
        outcome: null,
        durationSec: null,
        turns: [],
        summary: null,
        captured: {},
        optedOut: false,
      }
    }

    const turns: Turn[] = (conversation.transcript ?? [])
      .filter((turn: any) => turn.message)
      .map((turn: any) => ({ role: turn.role === 'user' ? 'lead' : 'agent', text: turn.message }))

    return {
      status: 'ended',
      outcome: outcomeOf(conversation, turns),
      durationSec: conversation.metadata?.call_duration_secs ?? null,
      turns,
      summary: conversation.analysis?.transcript_summary ?? null,
      captured: collected(conversation),
      optedOut: false,
    }
  },
}

export default elevenlabs
