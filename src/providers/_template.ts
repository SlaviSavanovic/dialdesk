import { bearer, callApi } from './shared.ts'
import type { VoiceProvider } from './types.ts'

// To add a platform: copy this file to src/providers/<name>.ts, read the
// platform's current API docs, and fill it in. Nothing else needs changing.
// Files starting with an underscore are ignored, so this one never loads.
//
// Don't guess endpoints. If the docs don't settle something, leave a TODO.

const example: VoiceProvider = {
  name: 'example',
  label: 'Example',
  rank: 50,
  blurb: 'One sentence a non-developer can use to choose this platform.',
  keys: [{ env: 'EXAMPLE_API_KEY', label: 'API key', help: 'Where to find it.', url: 'https://example.com' }],
  config: [],
  baseUrl: 'https://api.example.com',
  pollEveryMs: 15_000,
  dialPaths: [/^\/calls\b/], // every endpoint that places a call
  authHeaders: (ctx) => bearer(ctx, 'EXAMPLE_API_KEY'),
  keyCheck: () => ({ method: 'GET', path: '/me' }),

  async placeCall(ctx, request) {
    const call = await callApi(example, ctx, {
      method: 'POST',
      path: '/calls',
      json: { to: request.to, first_message: request.firstLine, prompt: request.prompt },
    })
    return { providerCallId: call.id }
  },

  async getCall(ctx, providerCallId) {
    const call = await callApi(example, ctx, { method: 'GET', path: `/calls/${providerCallId}` })
    return {
      status: call.ended ? 'ended' : 'in_progress',
      outcome: call.ended ? 'connected' : null, // map the platform's end reasons here
      durationSec: call.duration ?? null,
      turns: [],
      summary: call.summary ?? null,
      captured: {},
      optedOut: false,
    }
  },
}

export default example
