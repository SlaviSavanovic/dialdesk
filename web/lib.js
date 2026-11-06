// Shared helpers and small components for every screen.
import { html, useEffect, useRef, useState } from '/vendor/preact-htm.js'

export { html, useEffect, useRef, useState }

// ---- Talking to the server --------------------------------------------------

export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `Something went wrong (${response.status}).`)
  return data
}

// One connection to the server's event stream, shared by every screen. Bursts of
// changes are grouped together so a screen refetches once rather than ten times.
const listeners = new Set()
let timer = null

function connectEvents() {
  const source = new EventSource('/events')
  source.addEventListener('change', () => {
    clearTimeout(timer)
    timer = setTimeout(() => listeners.forEach((listener) => listener()), 120)
  })
  // Catch up on anything missed while the connection was down.
  source.onopen = () => listeners.forEach((listener) => listener())
}
connectEvents()

// Fetches a URL and refetches whenever the server says something changed. The
// old data stays on screen during a refetch, so nothing flashes.
export function useLive(path) {
  const [state, setState] = useState({ data: null, error: null })
  const latest = useRef(path)
  latest.current = path

  useEffect(() => {
    let alive = true
    const load = () =>
      api('GET', path)
        .then((data) => {
          if (alive && latest.current === path) setState({ data, error: null })
        })
        .catch((error) => {
          if (alive) setState((previous) => ({ data: previous.data, error }))
        })
    load()
    listeners.add(load)
    return () => {
      alive = false
      listeners.delete(load)
    }
  }, [path])

  return state
}

// ---- Formatting -------------------------------------------------------------

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function when(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date)
}

export function duration(seconds) {
  if (seconds === null || seconds === undefined) return '–'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function phone(e164) {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '')
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164
}

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function scheduleText(campaign) {
  const days = [...campaign.days].sort()
  let dayText = days.map((day) => DAY_NAMES[day]).join(', ')
  if (days.length === 7) dayText = 'Every day'
  else if (days.join() === '1,2,3,4,5') dayText = 'Mon to Fri'
  else if (days.join() === '1,2,3,4,5,6') dayText = 'Mon to Sat'
  return `${dayText}, ${clockText(campaign.windowStart)} to ${clockText(campaign.windowEnd)} their time`
}

function clockText(time) {
  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const text = hours % 12 || 12
  return minutes ? `${text}:${String(minutes).padStart(2, '0')} ${suffix}` : `${text} ${suffix}`
}

export function retryText(minutes) {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`
}

// ---- Labels -----------------------------------------------------------------

const OUTCOMES = {
  connected: { label: 'Reached', tone: 'good' },
  no_answer: { label: 'No answer', tone: '' },
  voicemail: { label: 'Voicemail', tone: '' },
  busy: { label: 'Busy', tone: '' },
  opted_out: { label: 'Asked to stop', tone: 'serious' },
  failed: { label: 'Failed', tone: 'critical' },
}

export const outcomeLabel = (outcome) => OUTCOMES[outcome]?.label ?? outcome

const CALL_STATES = {
  dialing: { label: 'Dialing', tone: 'active', pulse: true },
  ringing: { label: 'Ringing', tone: 'active', pulse: true },
  in_progress: { label: 'On the line', tone: 'active', pulse: true },
}

const CAMPAIGN_STATES = {
  ready: { label: 'Not started', tone: '' },
  running: { label: 'Running', tone: 'active', pulse: true },
  paused: { label: 'Paused', tone: 'warning' },
  stopped: { label: 'Stopped', tone: '' },
  finished: { label: 'Finished', tone: 'good' },
}

const LEAD_STATES = {
  calling: { label: 'On the line', tone: 'active', pulse: true },
  ready: { label: 'Up next', tone: 'active' },
  waiting: { label: 'Waiting', tone: 'warning' },
  reached: { label: 'Reached', tone: 'good' },
  done: { label: 'Not calling', tone: '' },
}

// ---- Components -------------------------------------------------------------

export const Logo = () => html`
  <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="currentColor" />
    <circle cx="16" cy="16" r="4" fill="#1fa67c" />
    <g fill="var(--surface)">
      <circle cx="16" cy="6.5" r="1.8" />
      <circle cx="24.2" cy="11.2" r="1.8" />
      <circle cx="24.2" cy="20.8" r="1.8" />
      <circle cx="16" cy="25.5" r="1.8" />
      <circle cx="7.8" cy="20.8" r="1.8" />
      <circle cx="7.8" cy="11.2" r="1.8" />
    </g>
  </svg>
`

export function Chip({ label, tone = '', pulse = false }) {
  return html`<span class="chip"><span class="dot ${tone} ${pulse ? 'pulse' : ''}"></span>${label}</span>`
}

export function CallChip({ call }) {
  if (call.status !== 'ended') return html`<${Chip} ...${CALL_STATES[call.status]} />`
  return html`<${Chip} ...${OUTCOMES[call.outcome] ?? { label: 'Ended' }} />`
}

export const CampaignChip = ({ status }) => html`<${Chip} ...${CAMPAIGN_STATES[status]} />`
export const LeadStateChip = ({ state }) => html`<${Chip} ...${LEAD_STATES[state]} />`

export function Say({ text }) {
  return html`<div class="say"><span class="say-label">Say to Claude</span><span class="say-text">“${text}”</span></div>`
}

export function PageHead({ title, sub, crumb, children }) {
  return html`
    <div>
      ${crumb && html`<a class="crumb" href=${crumb.href}>← ${crumb.label}</a>`}
      <div class="page-head">
        <div>
          <h1>${title}</h1>
          ${sub && html`<p>${sub}</p>`}
        </div>
        ${children}
      </div>
    </div>
  `
}

export function Offline({ error }) {
  if (!error) return null
  return html`<div class="offline" role="alert">Can't reach dialdesk. Is it still running?</div>`
}

export function CallRow({ call }) {
  return html`
    <a class="row" href="#/calls/${call.id}">
      <div class="row-main">
        <div class="row-title">${call.leadName}</div>
        <div class="row-sub">
          <span class="mono">${phone(call.phone)}</span>${call.mode === 'dry_run' ? ' · simulated' : ''}
        </div>
      </div>
      <div class="row-side">
        <span class="mono muted hide-narrow">${duration(call.durationSec)}</span>
        <span class="muted hide-narrow" style="font-size:13px">${when(call.startedAt)}</span>
        <${CallChip} call=${call} />
      </div>
    </a>
  `
}
