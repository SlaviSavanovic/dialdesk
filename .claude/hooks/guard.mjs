// Runs before Claude's tools in this project. It stops two accidents:
//  1. Reading or changing .env, which would put API keys into the chat.
//  2. Reaching a voice platform directly, which would skip the app's gate.
//
// It's a guardrail, not a lock. Exit code 2 blocks the action and shows Claude
// the message, so Claude knows the right way to do what it was trying to do.

const PLATFORM_HOSTS = /api\.(vapi\.ai|retellai\.com|bland\.ai|elevenlabs\.io|synthflow\.ai|twilio\.com|deepgram\.com)|api\.(us|eu)\.synthflow\.ai/i

// `.env` on its own, but not `.env.example`, `.environment` or `foo.env`.
const ENV_FILE = /(^|[\s"'`=<>|&;:(/\\])\.env(?![\w.-])/
const PRINTS_ENV = /(^|[\s;&|(])(printenv|env|set|export -p)(\s*($|[;&|)]))/

const ENV_MESSAGE =
  'Blocked: .env holds API keys and is off limits to Claude. ' +
  'The user adds keys in the setup wizard in the browser. GET /api/status shows which are set.'

function checkFile(path) {
  if (path && /(^|[/\\])\.env$/.test(path)) return ENV_MESSAGE
  return null
}

function checkCommand(command) {
  if (ENV_FILE.test(command) || PRINTS_ENV.test(command)) return ENV_MESSAGE
  if (PLATFORM_HOSTS.test(command)) {
    return 'Blocked: reach voice platforms with `npm run api -- <platform> <METHOD> <path>`. It adds the key for you, and dialing has to go through the app.'
  }
  if (/\/api\/(secrets|go-live)\b/.test(command)) {
    return 'Blocked: keys and going live are for the user, in the browser. Send them to the setup wizard or the Go live screen.'
  }
  return null
}

let input = ''
for await (const chunk of process.stdin) input += chunk

let event = {}
try {
  event = JSON.parse(input)
} catch {
  process.exit(0)
}

const tool = event.tool_input ?? {}
const problem =
  event.tool_name === 'Bash' ? checkCommand(tool.command ?? '') : checkFile(tool.file_path ?? tool.path)

if (problem) {
  console.error(problem)
  process.exit(2)
}
