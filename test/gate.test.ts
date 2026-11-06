import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkGate, type GateInput } from '../src/gate.ts'
import { checkCallingWindow, zonesFor } from '../src/timezones.ts'

// 3pm on a Wednesday in New York, noon in Los Angeles.
const NOW = new Date('2026-06-03T19:00:00Z')
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    lead: { timezone: null, state: 'NY' },
    campaign: {
      id: 1,
      days: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '09:00',
      windowEnd: '20:00',
      maxPerHour: 30,
      maxAttempts: 3,
      retryDelayMinutes: 60,
    },
    firstLine: 'Hi, this is Ava, an AI assistant.',
    onDnc: false,
    history: [],
    callsThisHour: 0,
    now: NOW,
    ...overrides,
  }
}

const ended = (campaignId: number, outcome: 'no_answer' | 'connected' | 'opted_out', startedAt: string) => ({
  campaignId,
  outcome,
  status: 'ended' as const,
  startedAt,
})

function code(gateInput: GateInput) {
  const result = checkGate(gateInput)
  return result.ok ? 'ok' : result.code
}

describe('gate', () => {
  it('lets a clean lead through', () => {
    assert.equal(code(input()), 'ok')
  })

  it('does not require a consent record', () => {
    // Permission to call is the user's responsibility. See the README.
    assert.equal(code(input({ lead: { timezone: null, state: 'NY' } })), 'ok')
  })

  describe('do-not-call', () => {
    it('blocks a number on the list, for good', () => {
      const result = checkGate(input({ onDnc: true }))
      assert.equal(result.ok, false)
      assert.equal(!result.ok && result.code, 'dnc')
      assert.equal(!result.ok && result.final, true)
    })

    it('outranks every other check', () => {
      assert.equal(code(input({ onDnc: true, firstLine: 'hello', lead: { timezone: null, state: null } })), 'dnc')
    })
  })

  describe('AI disclosure', () => {
    it('blocks a first line that does not say it is an AI', () => {
      assert.equal(code(input({ firstLine: 'Hi, this is Ava from Summit Roofing.' })), 'no_disclosure')
    })

    it('is not fooled by words containing the letters ai', () => {
      assert.equal(code(input({ firstLine: 'I said I would email you, Aiden.' })), 'no_disclosure')
    })

    it('accepts the spelled-out version', () => {
      assert.equal(code(input({ firstLine: 'Hi, I am an artificial intelligence assistant.' })), 'ok')
    })
  })

  describe('attempts', () => {
    it('blocks at the attempt limit, for good', () => {
      const history = [
        ended(1, 'no_answer', hoursBefore(10)),
        ended(1, 'no_answer', hoursBefore(8)),
        ended(1, 'no_answer', hoursBefore(6)),
      ]
      const result = checkGate(input({ history }))
      assert.equal(!result.ok && result.code, 'max_attempts')
      assert.equal(!result.ok && result.final, true)
    })

    it('allows another try under the limit once the gap has passed', () => {
      assert.equal(code(input({ history: [ended(1, 'no_answer', hoursBefore(2))] })), 'ok')
    })

    it('blocks a retry inside the gap and says when', () => {
      const result = checkGate(input({ history: [ended(1, 'no_answer', hoursBefore(0.5))] }))
      assert.equal(!result.ok && result.code, 'retry_gap')
      assert.equal(!result.ok && result.retryAt, new Date(NOW.getTime() + 30 * 60_000).toISOString())
    })

    it('applies the gap across campaigns', () => {
      assert.equal(code(input({ history: [ended(2, 'no_answer', hoursBefore(0.5))] })), 'retry_gap')
    })

    it('only counts attempts from this campaign toward the limit', () => {
      const history = [
        ended(2, 'no_answer', hoursBefore(10)),
        ended(2, 'no_answer', hoursBefore(8)),
        ended(2, 'no_answer', hoursBefore(6)),
      ]
      assert.equal(code(input({ history })), 'ok')
    })

    it('stops once the lead has been reached', () => {
      assert.equal(code(input({ history: [ended(1, 'connected', hoursBefore(5))] })), 'already_reached')
    })

    it('blocks while a call to the number is still open', () => {
      const history = [{ campaignId: 2, outcome: null, status: 'in_progress' as const, startedAt: hoursBefore(0.1) }]
      assert.equal(code(input({ history })), 'call_open')
    })
  })

  describe('calling hours', () => {
    it('blocks when it is too late where the lead is', () => {
      const lateNight = new Date('2026-06-04T02:00:00Z') // 10pm in New York
      assert.equal(code(input({ now: lateNight })), 'outside_hours')
    })

    it('uses the lead\'s time, not the server\'s', () => {
      const earlyMorningLA = new Date('2026-06-03T14:30:00Z') // 7:30am in LA, 10:30am in NY
      assert.equal(code(input({ now: earlyMorningLA, lead: { timezone: null, state: 'CA' } })), 'outside_hours')
      assert.equal(code(input({ now: earlyMorningLA, lead: { timezone: null, state: 'NY' } })), 'ok')
    })

    it('prefers an explicit timezone over the state', () => {
      const earlyMorningLA = new Date('2026-06-03T14:30:00Z')
      const lead = { timezone: 'America/New_York', state: 'CA' }
      assert.equal(code(input({ now: earlyMorningLA, lead })), 'ok')
    })

    it('requires both zones of a two-zone state to be open', () => {
      // 9:15am in Chicago, but only 8:15am in El Paso, which is also Texas.
      const morning = new Date('2026-06-03T14:15:00Z')
      assert.equal(code(input({ now: morning, lead: { timezone: null, state: 'TX' } })), 'outside_hours')
      // 10:15am in Chicago and 9:15am in El Paso.
      const later = new Date('2026-06-03T15:15:00Z')
      assert.equal(code(input({ now: later, lead: { timezone: null, state: 'TX' } })), 'ok')
    })

    it('blocks a day the campaign does not call', () => {
      const campaign = { ...input().campaign, days: [1, 2] } // Monday and Tuesday. NOW is Wednesday.
      assert.equal(code(input({ campaign })), 'outside_hours')
    })

    it('cannot be loosened past the hard limits', () => {
      const lateNight = new Date('2026-06-04T02:30:00Z') // 10:30pm in New York
      const campaign = { ...input().campaign, windowStart: '00:00', windowEnd: '23:59' }
      assert.equal(code(input({ now: lateNight, campaign })), 'outside_hours')
    })

    it('can be made stricter than the default', () => {
      const campaign = { ...input().campaign, windowStart: '09:00', windowEnd: '12:00' }
      assert.equal(code(input({ campaign })), 'outside_hours') // 3pm in New York
    })

    it('treats the end of the window as closed', () => {
      assert.equal(checkCallingWindow(['America/New_York'], new Date('2026-06-04T00:00:00Z'), [3], '09:00', '20:00').ok, false)
    })
  })

  describe('unknown location', () => {
    it('does not call a lead with no timezone or state', () => {
      const result = checkGate(input({ lead: { timezone: null, state: null } }))
      assert.equal(!result.ok && result.code, 'no_timezone')
      assert.equal(!result.ok && result.final, true)
    })

    it('does not call a lead with an unrecognized state', () => {
      assert.equal(code(input({ lead: { timezone: null, state: 'Narnia' } })), 'no_timezone')
    })

    it('finds zones from a full state name', () => {
      assert.deepEqual(zonesFor({ timezone: null, state: 'hawaii' }), ['Pacific/Honolulu'])
    })
  })

  it('blocks at the hourly cap', () => {
    assert.equal(code(input({ callsThisHour: 30 })), 'hourly_cap')
  })
})
