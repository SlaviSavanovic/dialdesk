import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Agent, Call, Campaign, DncEntry, Lead } from '../types.ts'
import type { CallFilter, Store } from './types.ts'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    timezone TEXT,
    state TEXT,
    consent_source TEXT,
    consent_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    caller_name TEXT NOT NULL,
    goal TEXT NOT NULL,
    first_line TEXT NOT NULL,
    script TEXT NOT NULL,
    capture_fields TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    status TEXT NOT NULL,
    days TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    max_per_hour INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    retry_delay_minutes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaign_leads (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    PRIMARY KEY (campaign_id, lead_id)
  );
  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    lead_id INTEGER,
    lead_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    kind TEXT NOT NULL,
    mode TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_call_id TEXT,
    status TEXT NOT NULL,
    outcome TEXT,
    duration_sec INTEGER,
    turns TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    captured TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    last_polled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS calls_phone ON calls(phone);
  CREATE INDEX IF NOT EXISTS calls_status ON calls(status);
  CREATE TABLE IF NOT EXISTS dnc (
    phone TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    reason TEXT,
    added_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

type Row = Record<string, any>

const toLead = (r: Row): Lead => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  timezone: r.timezone,
  state: r.state,
  consentSource: r.consent_source,
  consentDate: r.consent_date,
  notes: r.notes,
  createdAt: r.created_at,
})

const toAgent = (r: Row): Agent => ({
  id: r.id,
  name: r.name,
  businessName: r.business_name,
  callerName: r.caller_name,
  goal: r.goal,
  firstLine: r.first_line,
  script: r.script,
  captureFields: JSON.parse(r.capture_fields),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toCampaign = (r: Row): Campaign => ({
  id: r.id,
  name: r.name,
  agentId: r.agent_id,
  status: r.status,
  days: JSON.parse(r.days),
  windowStart: r.window_start,
  windowEnd: r.window_end,
  maxPerHour: r.max_per_hour,
  maxAttempts: r.max_attempts,
  retryDelayMinutes: r.retry_delay_minutes,
  createdAt: r.created_at,
})

const toCall = (r: Row): Call => ({
  id: r.id,
  campaignId: r.campaign_id,
  leadId: r.lead_id,
  leadName: r.lead_name,
  phone: r.phone,
  kind: r.kind,
  mode: r.mode,
  provider: r.provider,
  providerCallId: r.provider_call_id,
  status: r.status,
  outcome: r.outcome,
  durationSec: r.duration_sec,
  turns: JSON.parse(r.turns),
  summary: r.summary,
  captured: JSON.parse(r.captured),
  error: r.error,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  lastPolledAt: r.last_polled_at,
})

const toDnc = (r: Row): DncEntry => ({
  phone: r.phone,
  source: r.source,
  reason: r.reason,
  addedAt: r.added_at,
})

// Maps the camelCase fields a patch may contain to their columns, and says how
// to store each one. Anything not listed here can't be patched.
const LEAD_COLUMNS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  timezone: 'timezone',
  state: 'state',
  consentSource: 'consent_source',
  consentDate: 'consent_date',
  notes: 'notes',
}
const AGENT_COLUMNS: Record<string, string> = {
  name: 'name',
  businessName: 'business_name',
  callerName: 'caller_name',
  goal: 'goal',
  firstLine: 'first_line',
  script: 'script',
  captureFields: 'capture_fields',
}
const CAMPAIGN_COLUMNS: Record<string, string> = {
  name: 'name',
  agentId: 'agent_id',
  days: 'days',
  windowStart: 'window_start',
  windowEnd: 'window_end',
  maxPerHour: 'max_per_hour',
  maxAttempts: 'max_attempts',
  retryDelayMinutes: 'retry_delay_minutes',
}
const CALL_COLUMNS: Record<string, string> = {
  providerCallId: 'provider_call_id',
  status: 'status',
  outcome: 'outcome',
  durationSec: 'duration_sec',
  turns: 'turns',
  summary: 'summary',
  captured: 'captured',
  error: 'error',
  endedAt: 'ended_at',
  lastPolledAt: 'last_polled_at',
}

// Arrays and objects are stored as JSON text.
const toColumnValue = (value: unknown) =>
  value !== null && typeof value === 'object' ? JSON.stringify(value) : (value as string | number | null)

export function createSqliteStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)

  const all = (sql: string, ...params: any[]) => db.prepare(sql).all(...params) as Row[]
  const one = (sql: string, ...params: any[]) => db.prepare(sql).get(...params) as Row | undefined

  function patchRow(table: string, columns: Record<string, string>, id: number, patch: object) {
    const entries = Object.entries(patch).filter(([field, value]) => columns[field] && value !== undefined)
    if (entries.length === 0) return
    const assignments = entries.map(([field]) => `${columns[field]} = ?`).join(', ')
    const values = entries.map(([, value]) => toColumnValue(value))
    db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...values, id)
  }

  const store: Store = {
    async listLeads(query) {
      if (!query) return all('SELECT * FROM leads ORDER BY id').map(toLead)
      const like = `%${query}%`
      return all(
        'SELECT * FROM leads WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? ORDER BY id',
        like, like, like, like,
      ).map(toLead)
    },

    async getLead(id) {
      const row = one('SELECT * FROM leads WHERE id = ?', id)
      return row ? toLead(row) : null
    },

    async upsertLead(input, now) {
      const existing = one('SELECT id FROM leads WHERE phone = ?', input.phone)
      if (existing) {
        patchRow('leads', LEAD_COLUMNS, existing.id, input)
        return { lead: toLead(one('SELECT * FROM leads WHERE id = ?', existing.id)!), created: false }
      }
      const result = db
        .prepare(
          `INSERT INTO leads (name, phone, email, timezone, state, consent_source, consent_date, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, input.phone, input.email, input.timezone, input.state,
          input.consentSource, input.consentDate, input.notes, now,
        )
      return { lead: toLead(one('SELECT * FROM leads WHERE id = ?', result.lastInsertRowid)!), created: true }
    },

    async updateLead(id, patch) {
      patchRow('leads', LEAD_COLUMNS, id, patch)
      return store.getLead(id)
    },

    async deleteLead(id) {
      db.prepare('DELETE FROM campaign_leads WHERE lead_id = ?').run(id)
      db.prepare('DELETE FROM leads WHERE id = ?').run(id)
    },

    async listAgents() {
      return all('SELECT * FROM agents ORDER BY id DESC').map(toAgent)
    },

    async getAgent(id) {
      const row = one('SELECT * FROM agents WHERE id = ?', id)
      return row ? toAgent(row) : null
    },

    async createAgent(input, now) {
      const result = db
        .prepare(
          `INSERT INTO agents (name, business_name, caller_name, goal, first_line, script, capture_fields, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, input.businessName, input.callerName, input.goal, input.firstLine,
          input.script, JSON.stringify(input.captureFields), now, now,
        )
      return (await store.getAgent(Number(result.lastInsertRowid)))!
    },

    async updateAgent(id, patch, now) {
      patchRow('agents', AGENT_COLUMNS, id, patch)
      db.prepare('UPDATE agents SET updated_at = ? WHERE id = ?').run(now, id)
      return store.getAgent(id)
    },

    async deleteAgent(id) {
      db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    },

    async listCampaigns() {
      return all('SELECT * FROM campaigns ORDER BY id DESC').map(toCampaign)
    },

    async getCampaign(id) {
      const row = one('SELECT * FROM campaigns WHERE id = ?', id)
      return row ? toCampaign(row) : null
    },

    async createCampaign(input, now) {
      const result = db
        .prepare(
          `INSERT INTO campaigns (name, agent_id, status, days, window_start, window_end, max_per_hour, max_attempts, retry_delay_minutes, created_at)
           VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name, input.agentId, JSON.stringify(input.days), input.windowStart, input.windowEnd,
          input.maxPerHour, input.maxAttempts, input.retryDelayMinutes, now,
        )
      return (await store.getCampaign(Number(result.lastInsertRowid)))!
    },

    async updateCampaign(id, patch) {
      patchRow('campaigns', CAMPAIGN_COLUMNS, id, patch)
      return store.getCampaign(id)
    },

    // Call history stays. It's the record of who was called and when.
    async deleteCampaign(id) {
      db.prepare('DELETE FROM campaign_leads WHERE campaign_id = ?').run(id)
      db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
    },

    async setCampaignStatus(id, status) {
      db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(status, id)
    },

    async addCampaignLeads(campaignId, leadIds) {
      const insert = db.prepare('INSERT OR IGNORE INTO campaign_leads (campaign_id, lead_id) VALUES (?, ?)')
      for (const leadId of leadIds) insert.run(campaignId, leadId)
    },

    async removeCampaignLeads(campaignId, leadIds) {
      const remove = db.prepare('DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?')
      for (const leadId of leadIds) remove.run(campaignId, leadId)
    },

    async campaignLeads(campaignId) {
      return all(
        `SELECT leads.* FROM leads
         JOIN campaign_leads ON campaign_leads.lead_id = leads.id
         WHERE campaign_leads.campaign_id = ? ORDER BY leads.id`,
        campaignId,
      ).map(toLead)
    },

    async createCall(input) {
      const result = db
        .prepare(
          `INSERT INTO calls (campaign_id, lead_id, lead_name, phone, kind, mode, provider, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'dialing', ?)`,
        )
        .run(
          input.campaignId, input.leadId, input.leadName, input.phone,
          input.kind, input.mode, input.provider, input.startedAt,
        )
      return (await store.getCall(Number(result.lastInsertRowid)))!
    },

    async updateCall(id, patch) {
      patchRow('calls', CALL_COLUMNS, id, patch)
      return (await store.getCall(id))!
    },

    async getCall(id) {
      const row = one('SELECT * FROM calls WHERE id = ?', id)
      return row ? toCall(row) : null
    },

    async listCalls(filter: CallFilter = {}) {
      const where: string[] = []
      const params: (string | number)[] = []
      if (filter.campaignId !== undefined) { where.push('campaign_id = ?'); params.push(filter.campaignId) }
      if (filter.leadId !== undefined) { where.push('lead_id = ?'); params.push(filter.leadId) }
      if (filter.since !== undefined) { where.push('started_at >= ?'); params.push(filter.since) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      params.push(filter.limit ?? 200)
      return all(`SELECT * FROM calls ${clause} ORDER BY id DESC LIMIT ?`, ...params).map(toCall)
    },

    async openCalls() {
      return all("SELECT * FROM calls WHERE status != 'ended' ORDER BY id").map(toCall)
    },

    async callsForPhone(phone) {
      return all("SELECT * FROM calls WHERE phone = ? AND kind = 'campaign' ORDER BY id", phone).map(toCall)
    },

    async countCampaignCallsSince(campaignId, since) {
      return one('SELECT COUNT(*) AS n FROM calls WHERE campaign_id = ? AND started_at >= ?', campaignId, since)!.n
    },

    async countTestCallsSince(since) {
      return one("SELECT COUNT(*) AS n FROM calls WHERE kind = 'test' AND started_at >= ?", since)!.n
    },

    async isOnDnc(phone) {
      return one('SELECT 1 FROM dnc WHERE phone = ?', phone) !== undefined
    },

    async addDnc(entry) {
      // First entry wins: an opt-out shouldn't be overwritten by a later import.
      db.prepare('INSERT OR IGNORE INTO dnc (phone, source, reason, added_at) VALUES (?, ?, ?, ?)')
        .run(entry.phone, entry.source, entry.reason, entry.addedAt)
    },

    async listDnc() {
      return all('SELECT * FROM dnc ORDER BY added_at DESC').map(toDnc)
    },

    async getSetting<T>(key: string, fallback: T) {
      const row = one('SELECT value FROM settings WHERE key = ?', key)
      return row ? (JSON.parse(row.value) as T) : fallback
    },

    async setSetting(key, value) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(key, JSON.stringify(value))
    },
  }

  return store
}
