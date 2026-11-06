import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isVoiceProvider, type ApiTarget, type VoiceProvider } from './types.ts'

// Every file in this folder is a platform, so adding one means adding one file.
// A leading underscore keeps a file out (see _template.ts).
const NOT_PLATFORMS = new Set(['index.ts', 'types.ts', 'shared.ts'])
const folder = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(folder).filter(
  (file) => file.endsWith('.ts') && !file.startsWith('_') && !NOT_PLATFORMS.has(file),
)
const modules = await Promise.all(files.map((file) => import(pathToFileURL(join(folder, file)).href)))

export const targets: ApiTarget[] = modules.map((module) => module.default)

// Includes the mock.
export const allProviders: VoiceProvider[] = targets.filter(isVoiceProvider).sort((a, b) => a.rank - b.rank)

export const findTarget = (name: string) => targets.find((target) => target.name === name)
