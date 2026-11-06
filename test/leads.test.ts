import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { importDncList, importLeadsCsv, normalizePhone } from '../src/leads.ts'
import { makeDeps, NOW } from './helpers.ts'

describe('phone numbers', () => {
  it('normalizes the usual US formats to E.164', () => {
    for (const raw of ['(415) 555-0142', '415-555-0142', '415.555.0142', '4155550142', '+1 415 555 0142', '1-415-555-0142']) {
      assert.equal(normalizePhone(raw), '+14155550142', raw)
    }
  })

  it('keeps international numbers that have a country code', () => {
    assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958')
  })

  it('rejects things that cannot be phone numbers', () => {
    for (const raw of ['555-1234', '123', 'call me', '', null, undefined]) {
      assert.equal(normalizePhone(raw), null, String(raw))
    }
  })
})

describe('CSV import', () => {
  it('imports the documented columns', async () => {
    const { deps } = makeDeps()
    const csv = [
      'name,phone,email,timezone,state,consent_source,consent_date,notes',
      'Maya Chen,(415) 555-0142,maya@example.com,,CA,Web form,2026-05-01,Asked about a repair',
    ].join('\n')

    const result = await importLeadsCsv(deps.store, csv, NOW)
    assert.equal(result.imported, 1)
    assert.deepEqual(result.skipped, [])

    const [lead] = await deps.store.listLeads()
    assert.equal(lead.phone, '+14155550142')
    assert.equal(lead.state, 'CA')
    assert.equal(lead.consentSource, 'Web form')
    assert.equal(lead.consentDate, '2026-05-01')
    assert.equal(lead.notes, 'Asked about a repair')
  })

  it('imports a lead with no consent fields', async () => {
    const { deps } = makeDeps()
    const result = await importLeadsCsv(deps.store, 'name,phone\nMaya,415-555-0142', NOW)
    assert.equal(result.imported, 1)
    assert.equal((await deps.store.listLeads())[0].consentSource, null)
  })

  it('tolerates messy headers, a byte order mark and quoted commas', async () => {
    const { deps } = makeDeps()
    const csv = '﻿Full Name, Phone Number ,Time-Zone\n"Chen, Maya",415-555-0142,America/Los_Angeles'
    const result = await importLeadsCsv(deps.store, csv, NOW)
    assert.equal(result.imported, 1)
    const [lead] = await deps.store.listLeads()
    assert.equal(lead.name, 'Chen, Maya')
    assert.equal(lead.timezone, 'America/Los_Angeles')
  })

  it('reports bad rows with their line number and keeps the good ones', async () => {
    const { deps } = makeDeps()
    const csv = [
      'name,phone,state',
      'Good,415-555-0142,CA',
      'Bad Phone,12345,CA',
      ',415-555-0143,CA',
      'Bad State,415-555-0144,Narnia',
    ].join('\n')

    const result = await importLeadsCsv(deps.store, csv, NOW)
    assert.equal(result.imported, 1)
    assert.deepEqual(result.skipped.map((skip) => skip.row), [3, 4, 5])
    assert.match(result.skipped[0].reason, /12345/)
  })

  it('updates instead of duplicating when a number already exists', async () => {
    const { deps } = makeDeps()
    await importLeadsCsv(deps.store, 'name,phone\nMaya,415-555-0142', NOW)
    const result = await importLeadsCsv(deps.store, 'name,phone,notes\nMaya Chen,(415) 555-0142,New note', NOW)
    assert.equal(result.imported, 0)
    assert.equal(result.updated, 1)
    const leads = await deps.store.listLeads()
    assert.equal(leads.length, 1)
    assert.equal(leads[0].name, 'Maya Chen')
  })

  it('names columns it did not recognize so Claude can map them', async () => {
    const { deps } = makeDeps()
    const result = await importLeadsCsv(deps.store, 'name,phone,favorite_color\nMaya,415-555-0142,green', NOW)
    assert.deepEqual(result.unknownColumns, ['favorite_color'])
  })

  it('accepts a full state name', async () => {
    const { deps } = makeDeps()
    await importLeadsCsv(deps.store, 'name,phone,state\nMaya,415-555-0142,california', NOW)
    assert.equal((await deps.store.listLeads())[0].state, 'CA')
  })

  it('rejects a timezone it cannot use', async () => {
    const { deps } = makeDeps()
    const result = await importLeadsCsv(deps.store, 'name,phone,timezone\nMaya,415-555-0142,Mars/Olympus', NOW)
    assert.equal(result.imported, 0)
    assert.match(result.skipped[0].reason, /Mars\/Olympus/)
  })
})

describe('do-not-call import', () => {
  it('accepts a plain list or a CSV', async () => {
    const { deps } = makeDeps()
    const result = await importDncList(deps.store, '415-555-0142\nMaya,(415) 555-0143,note\nnot a number\n', NOW)
    assert.equal(result.added, 2)
    assert.deepEqual(result.skipped, ['not a number'])
    assert.equal(await deps.store.isOnDnc('+14155550142'), true)
    assert.equal(await deps.store.isOnDnc('+14155550143'), true)
  })

  it('does not overwrite an opt-out with a later import', async () => {
    const { deps } = makeDeps()
    await deps.store.addDnc({ phone: '+14155550142', source: 'opt_out', reason: 'Said stop', addedAt: NOW })
    await importDncList(deps.store, '415-555-0142', NOW)
    const [entry] = await deps.store.listDnc()
    assert.equal(entry.source, 'opt_out')
  })
})
