import { readFileSync } from 'node:fs'
import { openSecrets } from '../src/config.ts'
import { findTarget, targets } from '../src/providers/index.ts'
import { fillSecretPlaceholders, isDialRequest, sendRequest } from '../src/providers/shared.ts'
import { redact } from '../src/secrets.ts'

// How Claude talks to a platform during setup: create an agent, list numbers,
// import a Twilio number, anything the platform's API offers. It adds the key from
// .env so Claude never sees it, and hides any key that shows up in the response.
//
// It refuses endpoints that place calls. Calls only go out through src/dial.ts.

const USAGE = `Usage:
  npm run api -- <platform> <METHOD> <path> [--data <json or @file>] [--form key=value ...]

Examples:
  npm run api -- vapi GET /phone-number
  npm run api -- retell POST /create-retell-llm --data @llm.json
  npm run api -- twilio POST /2010-04-01/Accounts/AC123/IncomingPhoneNumbers.json --form PhoneNumber=+14155550100

To send a saved key to a platform without seeing it, write {{env:TWILIO_AUTH_TOKEN}}
inside --data or --form, and it gets filled in just before sending.

Platforms: ${targets.filter((target) => target.name !== 'mock').map((target) => target.name).join(', ')}`

function stop(message: string): never {
  console.error(message)
  process.exit(1)
}

const [name, method, path, ...rest] = process.argv.slice(2)
if (!name || !method || !path) stop(USAGE)

const target = findTarget(name)
if (!target || target.name === 'mock') stop(`Unknown platform "${name}".\n\n${USAGE}`)
if (!path.startsWith('/')) stop('The path should start with /, with no host in front of it.')

if (isDialRequest(target, method, path)) {
  stop(
    `Refused: ${method.toUpperCase()} ${path} places phone calls.\n` +
      'Calls only go through the app, so the do-not-call list and calling hours always apply.\n' +
      'For a test call, ask the user, then POST /api/test-call. For a campaign, use POST /api/campaigns/:id/start.',
  )
}

const secrets = openSecrets()
const missing = target.keys.filter((key) => !secrets.has(key.env)).map((key) => key.env)
if (missing.length > 0) stop(`${missing.join(' and ')} not set. Have the user add it in the setup wizard.`)

const fill = (text: string) => fillSecretPlaceholders(text, (name) => secrets.get(name))

let json: unknown
const form: Record<string, string> = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--data') {
    const value = rest[++i] ?? ''
    json = JSON.parse(fill(value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value))
  } else if (rest[i] === '--form') {
    const [key, ...parts] = (rest[++i] ?? '').split('=')
    form[key] = fillSecretPlaceholders(parts.join('='), (name) => secrets.get(name))
  } else {
    stop(`I don't understand "${rest[i]}".\n\n${USAGE}`)
  }
}

const { status, ok, data } = await sendRequest(
  target,
  { key: (env) => secrets.get(env), config: {}, fetch: globalThis.fetch },
  { method: method.toUpperCase(), path, json, form: Object.keys(form).length > 0 ? form : undefined },
)

const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
console.log(redact(text, secrets.allValues()))
if (!ok) stop(`\n${target.label} answered with status ${status}.`)
