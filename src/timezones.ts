// Works out where a lead is and whether it's a reasonable hour to call them.

export const HARD_EARLIEST = '08:00'
export const HARD_LATEST = '21:00'
export const DEFAULT_START = '09:00'
export const DEFAULT_END = '20:00'
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6] // Monday to Saturday

// States that span two zones list both, and a call must be allowed in both.
// Otherwise a 9am call to eastern Texas could reach El Paso at 8am.
const STATE_ZONES: Record<string, string[]> = {
  AL: ['America/Chicago'],
  AK: ['America/Anchorage', 'America/Adak'],
  AZ: ['America/Phoenix', 'America/Denver'],
  AR: ['America/Chicago'],
  CA: ['America/Los_Angeles'],
  CO: ['America/Denver'],
  CT: ['America/New_York'],
  DC: ['America/New_York'],
  DE: ['America/New_York'],
  FL: ['America/New_York', 'America/Chicago'],
  GA: ['America/New_York'],
  HI: ['Pacific/Honolulu'],
  IA: ['America/Chicago'],
  ID: ['America/Boise', 'America/Los_Angeles'],
  IL: ['America/Chicago'],
  IN: ['America/Indiana/Indianapolis', 'America/Chicago'],
  KS: ['America/Chicago', 'America/Denver'],
  KY: ['America/New_York', 'America/Chicago'],
  LA: ['America/Chicago'],
  MA: ['America/New_York'],
  MD: ['America/New_York'],
  ME: ['America/New_York'],
  MI: ['America/Detroit', 'America/Menominee'],
  MN: ['America/Chicago'],
  MO: ['America/Chicago'],
  MS: ['America/Chicago'],
  MT: ['America/Denver'],
  NC: ['America/New_York'],
  ND: ['America/Chicago', 'America/Denver'],
  NE: ['America/Chicago', 'America/Denver'],
  NH: ['America/New_York'],
  NJ: ['America/New_York'],
  NM: ['America/Denver'],
  NV: ['America/Los_Angeles'],
  NY: ['America/New_York'],
  OH: ['America/New_York'],
  OK: ['America/Chicago'],
  OR: ['America/Los_Angeles', 'America/Boise'],
  PA: ['America/New_York'],
  PR: ['America/Puerto_Rico'],
  RI: ['America/New_York'],
  SC: ['America/New_York'],
  SD: ['America/Chicago', 'America/Denver'],
  TN: ['America/New_York', 'America/Chicago'],
  TX: ['America/Chicago', 'America/Denver'],
  UT: ['America/Denver'],
  VA: ['America/New_York'],
  VT: ['America/New_York'],
  WA: ['America/Los_Angeles'],
  WI: ['America/Chicago'],
  WV: ['America/New_York'],
  WY: ['America/Denver'],
}

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

export function normalizeState(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const upper = value.toUpperCase()
  if (STATE_ZONES[upper]) return upper
  return STATE_NAMES[value.toLowerCase()] ?? null
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Every zone this lead could be in. Empty means we don't know, so we don't call.
export function zonesFor(lead: { timezone: string | null; state: string | null }): string[] {
  if (lead.timezone && isValidZone(lead.timezone)) return [lead.timezone]
  const state = normalizeState(lead.state)
  return state ? STATE_ZONES[state] : []
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function localTime(zone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)!.value
  return {
    weekday: WEEKDAYS.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

// "21:30" -> "9:30 PM", "09:00" -> "9 AM"
export function formatClock(minutes: number): string {
  const hours24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return mins === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`
}

const placeName = (zone: string) => zone.split('/').pop()!.replaceAll('_', ' ')

// A campaign can be stricter than the hard limits, never looser.
export function clampWindow(start: string, end: string) {
  const startMinutes = Math.max(toMinutes(start), toMinutes(HARD_EARLIEST))
  const endMinutes = Math.min(toMinutes(end), toMinutes(HARD_LATEST))
  return { startMinutes, endMinutes }
}

export function checkCallingWindow(
  zones: string[],
  now: Date,
  days: number[],
  start: string,
  end: string,
): { ok: true } | { ok: false; reason: string } {
  const { startMinutes, endMinutes } = clampWindow(start, end)

  for (const zone of zones) {
    const local = localTime(zone, now)
    if (!days.includes(local.weekday)) {
      return { ok: false, reason: `This campaign doesn't call on ${WEEKDAY_NAMES[local.weekday]}s.` }
    }
    if (local.minutes < startMinutes || local.minutes >= endMinutes) {
      return {
        ok: false,
        reason: `It's ${formatClock(local.minutes)} in ${placeName(zone)}. Calling hours are ${formatClock(startMinutes)} to ${formatClock(endMinutes)}.`,
      }
    }
  }
  return { ok: true }
}
