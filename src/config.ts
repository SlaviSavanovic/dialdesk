import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSecrets } from './secrets.ts'
import { targets } from './providers/index.ts'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const WEB_DIR = join(ROOT, 'web')
export const DATA_DIR = process.env.DIALDESK_DATA_DIR ?? join(ROOT, 'data')
export const ENV_PATH = process.env.DIALDESK_ENV_FILE ?? join(ROOT, '.env')

// The only names that can be written to .env.
export const ALLOWED_SECRETS = [
  ...targets.flatMap((target) => target.keys.map((key) => key.env)),
  'MY_PHONE',
  'LIVE_CALLS',
]

export const openSecrets = () => createSecrets(ENV_PATH, join(ROOT, '.env.example'), ALLOWED_SECRETS)
