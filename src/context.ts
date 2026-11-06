import type { Events } from './events.ts'
import type { ApiTarget, ProviderContext, VoiceProvider } from './providers/types.ts'
import type { Secrets } from './secrets.ts'
import type { Store } from './store/types.ts'
import type { CallMode } from './types.ts'

// Everything the app's logic needs, passed in rather than imported, so tests can
// swap in a fake clock and fake providers.
export interface Deps {
  store: Store
  secrets: Secrets
  events: Events
  providers: VoiceProvider[] // always includes the mock
  now: () => Date
  fetch: typeof fetch
}

export function currentMode(deps: Deps): CallMode {
  return deps.secrets.get('LIVE_CALLS') === 'on' ? 'live' : 'dry_run'
}

export async function contextFor(deps: Deps, target: ApiTarget): Promise<ProviderContext> {
  const configs = await deps.store.getSetting<Record<string, Record<string, string>>>('provider_config', {})
  return {
    key: (env) => deps.secrets.get(env),
    config: configs[target.name] ?? {},
    fetch: deps.fetch,
  }
}

export const mockProvider = (deps: Deps) => deps.providers.find((provider) => provider.name === 'mock')!

export async function selectedProvider(deps: Deps): Promise<VoiceProvider | null> {
  const name = await deps.store.getSetting<string | null>('provider', null)
  return deps.providers.find((provider) => provider.name === name && provider.name !== 'mock') ?? null
}

export async function readinessOf(deps: Deps, provider: VoiceProvider) {
  const ctx = await contextFor(deps, provider)
  const missingKeys = provider.keys.filter((key) => !deps.secrets.has(key.env)).map((key) => key.env)
  const missingConfig = provider.config.filter((field) => field.required && !ctx.config[field.name]).map((field) => field.name)
  return { ready: missingKeys.length === 0 && missingConfig.length === 0, missingKeys, missingConfig }
}

export type Dialer =
  | { ok: true; provider: VoiceProvider; ctx: ProviderContext; mode: CallMode }
  | { ok: false; reason: string }

// Decides what a campaign call dials through. Dry run always means the mock,
// whatever keys happen to be set.
export async function dialerFor(deps: Deps): Promise<Dialer> {
  if (currentMode(deps) === 'dry_run') {
    const provider = mockProvider(deps)
    return { ok: true, provider, ctx: await contextFor(deps, provider), mode: 'dry_run' }
  }
  const provider = await selectedProvider(deps)
  if (!provider) return { ok: false, reason: 'Live calling is on, but no voice platform is selected.' }
  const readiness = await readinessOf(deps, provider)
  if (!readiness.ready) {
    const missing = [...readiness.missingKeys, ...readiness.missingConfig].join(', ')
    return { ok: false, reason: `Live calling is on, but ${provider.label} is missing: ${missing}.` }
  }
  return { ok: true, provider, ctx: await contextFor(deps, provider), mode: 'live' }
}
