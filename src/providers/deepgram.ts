import type { ApiTarget } from './types.ts'

// Not something dialdesk dials through. Deepgram's voice agent needs your own
// public server bridging it to a phone line, which doesn't fit a local app. Use
// it as the speech recognition inside a platform instead. See recipes/deepgram.md.
const deepgram: ApiTarget = {
  name: 'deepgram',
  label: 'Deepgram',
  keys: [
    {
      env: 'DEEPGRAM_API_KEY',
      label: 'API key',
      help: 'In the Deepgram console, open API Keys and create a key.',
      url: 'https://console.deepgram.com',
    },
  ],
  baseUrl: 'https://api.deepgram.com',
  dialPaths: [],
  authHeaders: (ctx) => ({ Authorization: `Token ${ctx.key('DEEPGRAM_API_KEY') ?? ''}` }),
  keyCheck: () => ({ method: 'GET', path: '/v1/projects' }),
}

export default deepgram
