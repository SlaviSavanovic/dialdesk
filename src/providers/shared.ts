import type { Turn } from '../types.ts'
import type { ApiTarget, ProviderContext } from './types.ts'

export class ProviderError extends Error {
  status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

export interface ApiRequest {
  method: string
  path: string
  json?: unknown
  form?: Record<string, string>
}

export async function sendRequest(target: ApiTarget, ctx: ProviderContext, request: ApiRequest) {
  const headers: Record<string, string> = { ...target.authHeaders(ctx), Accept: 'application/json' }
  let body: string | undefined
  if (request.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(request.form).toString()
  } else if (request.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(request.json)
  }

  const response = await ctx.fetch(`${target.baseUrl}${request.path}`, {
    method: request.method,
    headers,
    body,
  })
  const text = await response.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: response.status, ok: response.ok, data }
}

// For adapters: returns the parsed body, or throws a readable error. Headers are
// never part of the message, so the key can't end up in the call log.
export async function callApi(target: ApiTarget, ctx: ProviderContext, request: ApiRequest): Promise<any> {
  const { status, ok, data } = await sendRequest(target, ctx, request)
  if (ok) return data
  throw new ProviderError(`${target.label} said no (${status}): ${describeError(data)}`, status)
}

function describeError(data: any): string {
  const message = data?.message ?? data?.error?.message ?? data?.error ?? data?.detail ?? data
  const text = typeof message === 'string' ? message : JSON.stringify(message)
  return text.slice(0, 300)
}

export const bearer = (ctx: ProviderContext, env: string) => ({ Authorization: `Bearer ${ctx.key(env) ?? ''}` })

// True if this request would place a call. `npm run api` refuses these, so that
// dialing can only happen through the gate in src/dial.ts.
export function isDialRequest(target: ApiTarget, method: string, path: string): boolean {
  if (method.toUpperCase() === 'GET') return false
  const cleanPath = path.split('?')[0].replace(/\/{2,}/g, '/')
  return target.dialPaths.some((pattern) => pattern.test(cleanPath))
}

// Importing a Twilio number means sending Twilio's token to another platform. So
// that Claude never handles it, `npm run api` swaps {{env:NAME}} for the real value.
export function fillSecretPlaceholders(text: string, getSecret: (name: string) => string | undefined): string {
  return text.replace(/\{\{env:([A-Z0-9_]+)\}\}/g, (_match, name: string) => {
    const value = getSecret(name)
    if (value === undefined) throw new Error(`${name} isn't set. Have the user add it in the setup wizard.`)
    return JSON.stringify(value).slice(1, -1) // escaped, so it's safe inside a JSON string
  })
}

// Turns "Agent: hi\nUser: hello" into turns. If the format isn't recognized the
// whole text counts as the lead's words, so an opt-out can't slip past unread.
export function parseTranscript(text: string | null | undefined): Turn[] {
  if (!text?.trim()) return []
  const turns: Turn[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(agent|assistant|ai|bot|robot|user|human|customer|lead)\s*:\s*(.*)$/i)
    if (match) {
      const role = /^(user|human|customer|lead)$/i.test(match[1]) ? 'lead' : 'agent'
      turns.push({ role, text: match[2].trim() })
    } else if (line.trim() && turns.length > 0) {
      turns[turns.length - 1].text += ` ${line.trim()}`
    }
  }
  return turns.length > 0 ? turns : [{ role: 'lead', text: text.trim() }]
}

export function secondsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const seconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null
}
