import type { ApiTarget } from './types.ts'

// Not a voice platform. This is where phone numbers come from, so Claude can buy
// one and import it into Vapi, Retell or ElevenLabs. See recipes/twilio.md.
const twilio: ApiTarget = {
  name: 'twilio',
  label: 'Twilio',
  keys: [
    {
      env: 'TWILIO_ACCOUNT_SID',
      label: 'Account SID',
      help: 'On the front page of your Twilio console. Starts with AC.',
      url: 'https://console.twilio.com',
    },
    {
      env: 'TWILIO_AUTH_TOKEN',
      label: 'Auth token',
      help: 'Right below the Account SID. Click to reveal it, then copy.',
      url: 'https://console.twilio.com',
    },
  ],
  baseUrl: 'https://api.twilio.com',
  dialPaths: [/\/Calls\b/],
  authHeaders(ctx) {
    const pair = `${ctx.key('TWILIO_ACCOUNT_SID') ?? ''}:${ctx.key('TWILIO_AUTH_TOKEN') ?? ''}`
    return { Authorization: `Basic ${Buffer.from(pair).toString('base64')}` }
  },
  keyCheck: (ctx) => ({ method: 'GET', path: `/2010-04-01/Accounts/${ctx.key('TWILIO_ACCOUNT_SID') ?? ''}.json` }),
}

export default twilio
