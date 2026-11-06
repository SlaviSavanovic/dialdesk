// Starts the real server in a throwaway folder and checks that it answers. CI uses
// this on Windows and macOS, because that's what unit tests can't prove.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const folder = mkdtempSync(join(tmpdir(), 'dialdesk-smoke-'))
const port = 3987
const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', 'src/server.ts', '--port', String(port)],
  {
    env: { ...process.env, DIALDESK_DATA_DIR: folder, DIALDESK_ENV_FILE: join(folder, '.env') },
    stdio: 'inherit',
  },
)

async function check() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()
      const page = await fetch(`http://127.0.0.1:${port}/`)
      if (status.mode !== 'dry_run') throw new Error(`A fresh install should be in dry run, but mode is ${status.mode}.`)
      if (!page.ok) throw new Error(`The page answered with status ${page.status}.`)
      return
    } catch (error) {
      if (error.message?.includes('fresh install') || error.message?.includes('The page')) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error('The server never answered.')
}

let exitCode = 0
try {
  await check()
  console.log('Smoke check passed.')
} catch (error) {
  console.error(`Smoke check failed: ${error.message}`)
  exitCode = 1
} finally {
  server.kill()
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {}
}
process.exit(exitCode)
