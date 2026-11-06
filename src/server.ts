import { connect } from 'node:net'
import { join, relative } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApi } from './api.ts'
import { DATA_DIR, openSecrets, WEB_DIR } from './config.ts'
import { currentMode, type Deps } from './context.ts'
import { createEvents } from './events.ts'
import { allProviders } from './providers/index.ts'
import { createScheduler } from './scheduler.ts'
import { seedIfEmpty } from './store/seed.ts'
import { createSqliteStore } from './store/sqlite.ts'

const deps: Deps = {
  store: createSqliteStore(join(DATA_DIR, 'dialdesk.sqlite')),
  secrets: openSecrets(),
  events: createEvents(),
  providers: allProviders,
  now: () => new Date(),
  fetch: globalThis.fetch,
}

await seedIfEmpty(deps.store, deps.now().toISOString())

const app = createApi(deps)
app.use('/*', serveStatic({ root: relative(process.cwd(), WEB_DIR) }))

const scheduler = createScheduler(deps)

function someoneIsListening(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

// Bound to this computer only. Binding can succeed even when another app holds
// the same port on all interfaces, so check by actually trying to connect.
async function isFree(port: number) {
  const taken = await Promise.all([someoneIsListening(port, '127.0.0.1'), someoneIsListening(port, '::1')])
  return !taken.includes(true)
}

function requestedPort(): number | null {
  const flag = process.argv.indexOf('--port')
  const raw = flag >= 0 ? process.argv[flag + 1] : process.env.PORT
  return raw ? Number(raw) : null
}

async function choosePort(): Promise<number> {
  const requested = requestedPort()
  if (requested) {
    if (await isFree(requested)) return requested
    console.error(`Port ${requested} is already in use.`)
    process.exit(1)
  }
  for (let port = 3000; port < 3020; port++) {
    if (await isFree(port)) return port
  }
  console.error('Ports 3000 to 3019 are all in use. Pick another with: npm start -- --port 4000')
  process.exit(1)
}

const port = await choosePort()
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`\n  dialdesk is running at http://localhost:${port}`)
  console.log(
    currentMode(deps) === 'live'
      ? '  LIVE: campaigns will ring real phones.\n'
      : '  Dry run: every campaign call is simulated.\n',
  )
  scheduler.start()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop()
    process.exit(0)
  })
}
