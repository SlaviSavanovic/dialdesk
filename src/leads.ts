import { parse } from 'csv-parse/sync'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import type { Store } from './store/types.ts'
import { isValidZone, normalizeState } from './timezones.ts'
import type { LeadInput } from './types.ts'

// Returns E.164 ("+14155550142"), or null if it can't be a real number.
// Numbers with no country code are assumed to be US.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parsed = parsePhoneNumberFromString(raw.trim(), 'US')
  return parsed?.isValid() ? parsed.number : null
}

const COLUMN_ALIASES: Record<string, keyof LeadInput> = {
  name: 'name',
  full_name: 'name',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  cell: 'phone',
  email: 'email',
  email_address: 'email',
  timezone: 'timezone',
  time_zone: 'timezone',
  tz: 'timezone',
  state: 'state',
  consent_source: 'consentSource',
  consent_date: 'consentDate',
  notes: 'notes',
  note: 'notes',
}

const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, '_')
const blankToNull = (value: string | undefined) => value?.trim() || null

// Checks one lead's fields and cleans them up. Used by CSV import and the API.
export function cleanLead(raw: Partial<Record<keyof LeadInput, string | null>>): LeadInput | { error: string } {
  const name = raw.name?.trim()
  if (!name) return { error: 'Missing a name.' }

  const phone = normalizePhone(raw.phone)
  if (!phone) return { error: `"${raw.phone ?? ''}" isn't a valid phone number.` }

  const timezone = raw.timezone?.trim() || null
  if (timezone && !isValidZone(timezone)) {
    return { error: `"${timezone}" isn't a timezone we recognize. Use a name like America/Chicago.` }
  }

  const stateText = raw.state?.trim() || null
  const state = normalizeState(stateText)
  if (stateText && !state) return { error: `"${stateText}" isn't a US state we recognize.` }

  return {
    name,
    phone,
    timezone,
    state,
    email: raw.email?.trim() || null,
    consentSource: raw.consentSource?.trim() || null,
    consentDate: raw.consentDate?.trim() || null,
    notes: raw.notes?.trim() || null,
  }
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: { row: number; reason: string }[]
  unknownColumns: string[]
  leadIds: number[]
}

export async function importLeadsCsv(store: Store, csv: string, now: string): Promise<ImportResult> {
  const headers: string[] = []
  const rows: Record<string, string>[] = parse(csv, {
    columns: (header: string[]) => {
      headers.push(...header.map(normalizeHeader))
      return headers
    },
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })

  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: [],
    unknownColumns: headers.filter((header) => !COLUMN_ALIASES[header]),
    leadIds: [],
  }

  for (const [index, row] of rows.entries()) {
    const fields: Partial<Record<keyof LeadInput, string>> = {}
    for (const [header, value] of Object.entries(row)) {
      const field = COLUMN_ALIASES[header]
      if (field && value) fields[field] = value
    }

    const cleaned = cleanLead(fields)
    // +2 because row 1 of the file is the header and people count from 1.
    if ('error' in cleaned) {
      result.skipped.push({ row: index + 2, reason: cleaned.error })
      continue
    }

    const { lead, created } = await store.upsertLead(cleaned, now)
    if (created) result.imported++
    else result.updated++
    result.leadIds.push(lead.id)
  }
  return result
}

// Accepts a CSV or a plain list. Each line just needs a phone number somewhere.
export async function importDncList(store: Store, text: string, now: string) {
  let added = 0
  const skipped: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const phone = line.split(',').map((cell) => normalizePhone(blankToNull(cell))).find(Boolean)
    if (phone) {
      await store.addDnc({ phone, source: 'import', reason: null, addedAt: now })
      added++
    } else {
      skipped.push(line.trim())
    }
  }
  return { added, skipped }
}
