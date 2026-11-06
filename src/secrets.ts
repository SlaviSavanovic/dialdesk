import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

export interface Secrets {
  get(name: string): string | undefined
  has(name: string): boolean
  set(values: Record<string, string>): void
  allValues(): string[]
}

// Reads .env fresh every time, so a key added in the wizard works straight away
// with no restart. Nothing here logs or returns a value to the outside world:
// the API only ever reports whether a key is set.
export function createSecrets(envPath: string, examplePath: string, allowed: string[]): Secrets {
  const read = (): Record<string, string> => {
    try {
      return parseEnv(readFileSync(envPath, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  return {
    get: (name) => read()[name] || undefined,
    has: (name) => Boolean(read()[name]),

    set(values) {
      let text = existsSync(envPath)
        ? readFileSync(envPath, 'utf8')
        : existsSync(examplePath)
          ? readFileSync(examplePath, 'utf8')
          : ''

      for (const [name, value] of Object.entries(values)) {
        if (!allowed.includes(name)) throw new Error(`${name} isn't a setting dialdesk knows about.`)
        if (/[\r\n]/.test(value)) throw new Error(`${name} can't contain a line break.`)

        const line = `${name}=${quote(value)}`
        const existing = new RegExp(`^${name}=.*$`, 'm')
        // A function, so a "$" inside a key isn't read as a replacement pattern.
        text = existing.test(text)
          ? text.replace(existing, () => line)
          : `${text.replace(/\n*$/, '\n')}${line}\n`
      }

      writeFileSync(envPath, text)
      try {
        chmodSync(envPath, 0o600) // Readable only by this user. Has no effect on Windows.
      } catch {}
    },

    allValues: () => Object.values(read()).filter(Boolean),
  }
}

// The .env format has no escape character, so pick a quote the value doesn't use.
// Single quotes come first because nothing inside them gets expanded.
function quote(value: string): string {
  if (/^[\w.+\-:/@=]*$/.test(value)) return value
  const mark = ["'", '"', '`'].find((candidate) => !value.includes(candidate))
  if (!mark) throw new Error('That value contains every kind of quote mark, so it can\'t be saved.')
  return `${mark}${value}${mark}`
}

// Strips any secret out of text before it can reach a log, a response or a chat.
export function redact(text: string, secretValues: string[]): string {
  let clean = text
  for (const secret of secretValues) {
    if (secret.length >= 6) clean = clean.replaceAll(secret, '[redacted]')
  }
  return clean
}
