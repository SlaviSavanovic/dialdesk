import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { placeTestCall, TEST_CALLS_PER_DAY } from '../src/dial.ts'
import mock from '../src/providers/mock.ts'
import { createScheduler } from '../src/scheduler.ts'
import { addAgent, addCampaign, addLead, fakeProvider, makeDeps, memorySecrets } from './helpers.ts'

// Live mode with a fake platform, so tests can see exactly what gets dialed.
async function liveSetup(result = {}) {
  const fake = fakeProvider(result)
  const env = makeDeps({
    providers: [mock, fake.provider],
    secrets: memorySecrets({ LIVE_CALLS: 'on', FAKE_KEY: 'secret-value' }),
  })
  await env.deps.store.setSetting('provider', 'fake')
  return { ...env, ...fake, scheduler: createScheduler(env.deps) }
}

describe('scheduler', () => {
  it('dials the next eligible lead and records the result', async () => {
    const { deps, scheduler, placed } = await liveSetup({
      outcome: 'connected',
      durationSec: 90,
      summary: 'Went well',
      turns: [{ role: 'lead', text: 'Sure' }],
      captured: { best_day: 'Tuesday' },
    })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Maya Chen', '+14155550142', 'NY')
    await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    assert.equal(placed.length, 1)
    assert.equal(placed[0].to, '+14155550142')

    await scheduler.tick()
    const [call] = await deps.store.listCalls()
    assert.equal(call.status, 'ended')
    assert.equal(call.outcome, 'connected')
    assert.equal(call.durationSec, 90)
    assert.equal(call.summary, 'Went well')
    assert.deepEqual(call.captured, { best_day: 'Tuesday' })
  })

  it('sends the disclosure as the first line, filled in for the lead', async () => {
    const { deps, scheduler, placed } = await liveSetup()
    const agent = await addAgent(deps, 'Hi {{first_name}}, this is Ava, an AI assistant.')
    const lead = await addLead(deps, 'Maya Chen', '+14155550142')
    await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    assert.equal(placed[0].firstLine, 'Hi Maya, this is Ava, an AI assistant.')
    assert.match(placed[0].prompt, /take you off our list/)
  })

  it('never dials a blocked lead, and moves on to the next one', async () => {
    const { deps, scheduler, placed } = await liveSetup()
    const agent = await addAgent(deps)
    const blocked = await addLead(deps, 'On The List', '+14155550101')
    const noLocation = await addLead(deps, 'No Location', '+14155550102', null)
    const fine = await addLead(deps, 'Fine', '+14155550103')
    await deps.store.addDnc({ phone: blocked.phone, source: 'manual', reason: null, addedAt: deps.now().toISOString() })
    await addCampaign(deps, agent.id, [blocked.id, noLocation.id, fine.id])

    await scheduler.tick()
    assert.deepEqual(placed.map((request) => request.to), ['+14155550103'])
  })

  it('places one call at a time per campaign', async () => {
    const { deps, scheduler, placed } = await liveSetup({ status: 'in_progress', outcome: null })
    const agent = await addAgent(deps)
    const one = await addLead(deps, 'One', '+14155550101')
    const two = await addLead(deps, 'Two', '+14155550102')
    await addCampaign(deps, agent.id, [one.id, two.id])

    await scheduler.tick()
    await scheduler.tick()
    await scheduler.tick()
    assert.equal(placed.length, 1)
  })

  it('does nothing for a paused campaign', async () => {
    const { deps, scheduler, placed } = await liveSetup()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    await deps.store.setCampaignStatus(campaign.id, 'paused')

    await scheduler.tick()
    assert.equal(placed.length, 0)
  })

  it('respects the hourly cap', async () => {
    const { deps, scheduler, placed } = await liveSetup()
    const agent = await addAgent(deps)
    const one = await addLead(deps, 'One', '+14155550101')
    const two = await addLead(deps, 'Two', '+14155550102')
    await addCampaign(deps, agent.id, [one.id, two.id], { maxPerHour: 1 })

    await scheduler.tick() // dials One
    await scheduler.tick() // reads One's result, cap blocks Two
    assert.equal(placed.length, 1)
  })

  it('retries after the gap and stops at max attempts', async () => {
    const { deps, scheduler, placed, advanceMinutes } = await liveSetup({ outcome: 'no_answer' })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id], { maxAttempts: 2, retryDelayMinutes: 30 })

    await scheduler.tick() // first attempt
    await scheduler.tick() // result, then blocked by the gap
    assert.equal(placed.length, 1)

    advanceMinutes(31)
    await scheduler.tick() // second attempt
    await scheduler.tick() // result, attempts used up, campaign finishes
    assert.equal(placed.length, 2)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'finished')
  })

  it('adds a lead to the do-not-call list when they ask to stop, and never calls again', async () => {
    const { deps, scheduler, placed, advanceMinutes } = await liveSetup({
      outcome: 'connected',
      turns: [
        { role: 'agent', text: 'Hi there' },
        { role: 'lead', text: "Please don't call me again." },
      ],
    })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const first = await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    await scheduler.tick()
    assert.equal(await deps.store.isOnDnc(lead.phone), true)
    assert.equal((await deps.store.listCalls())[0].outcome, 'opted_out')

    // Not even from a brand new campaign, days later.
    await deps.store.setCampaignStatus(first.id, 'stopped')
    await addCampaign(deps, agent.id, [lead.id])
    advanceMinutes(60 * 72)
    await scheduler.tick()
    assert.equal(placed.length, 1)
  })

  it('honors an opt-out flagged by the platform', async () => {
    const { deps, scheduler } = await liveSetup({ outcome: 'connected', optedOut: true })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    await scheduler.tick()
    assert.equal(await deps.store.isOnDnc(lead.phone), true)
  })

  it('does not treat the agent\'s own words as an opt-out', async () => {
    const { deps, scheduler } = await liveSetup({
      outcome: 'connected',
      turns: [{ role: 'agent', text: "I'll take you off our list. Do not call again." }],
    })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    await scheduler.tick()
    assert.equal(await deps.store.isOnDnc(lead.phone), false)
  })

  it('records a failed dial without losing the attempt', async () => {
    const { deps, scheduler, provider, placed } = await liveSetup()
    provider.placeCall = async () => {
      throw new Error('Platform is down, key secret-value rejected')
    }
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    await addCampaign(deps, agent.id, [lead.id])

    await scheduler.tick()
    const [call] = await deps.store.listCalls()
    assert.equal(call.outcome, 'failed')
    assert.equal(call.error, 'Platform is down, key [redacted] rejected')
    assert.equal(placed.length, 0)
  })

  it('pauses the campaign when the platform refuses a call, instead of burning through every lead', async () => {
    const { deps, scheduler, provider } = await liveSetup()
    provider.placeCall = async () => {
      throw new Error('Invalid API key')
    }
    const agent = await addAgent(deps)
    const one = await addLead(deps, 'One', '+14155550101')
    const two = await addLead(deps, 'Two', '+14155550102')
    const campaign = await addCampaign(deps, agent.id, [one.id, two.id])

    await scheduler.tick()
    await scheduler.tick()
    await scheduler.tick()
    assert.equal((await deps.store.listCalls()).length, 1, 'only the first lead lost an attempt')
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'paused')
    const notices = await deps.store.getSetting<Record<string, string>>('campaign_notices', {})
    assert.equal(notices[campaign.id], 'Invalid API key')
  })

  describe('surviving a restart', () => {
    it('picks up a call that was in progress when the app stopped', async () => {
      const { deps, placed, scheduler } = await liveSetup({ outcome: 'connected' })
      const agent = await addAgent(deps)
      const lead = await addLead(deps, 'Lead', '+14155550101')
      await addCampaign(deps, agent.id, [lead.id])
      await scheduler.tick()

      const afterRestart = createScheduler(deps)
      await afterRestart.tick()
      assert.equal((await deps.store.listCalls())[0].outcome, 'connected')
      assert.equal(placed.length, 1)
    })

    it('never redials a number if the app died in the middle of dialing', async () => {
      const { deps, placed, advanceMinutes } = await liveSetup()
      const agent = await addAgent(deps)
      const lead = await addLead(deps, 'Lead', '+14155550101')
      const campaign = await addCampaign(deps, agent.id, [lead.id], { retryDelayMinutes: 60 })

      // What a crash mid-dial leaves behind: a row with no provider call ID.
      await deps.store.createCall({
        campaignId: campaign.id,
        leadId: lead.id,
        leadName: lead.name,
        phone: lead.phone,
        kind: 'campaign',
        mode: 'live',
        provider: 'fake',
        startedAt: deps.now().toISOString(),
      })

      const afterRestart = createScheduler(deps)
      await afterRestart.tick()
      assert.equal(placed.length, 0, 'still might be ringing, so it must not redial')

      advanceMinutes(3)
      await afterRestart.tick()
      assert.equal(placed.length, 0, 'it counts as an attempt, so the retry gap applies')
      assert.equal((await deps.store.listCalls())[0].outcome, 'failed')

      advanceMinutes(60)
      await afterRestart.tick()
      assert.equal(placed.length, 1, 'only after the retry gap')
    })
  })

  describe('dry run', () => {
    it('uses the mock even when a real platform is ready', async () => {
      const fake = fakeProvider()
      const { deps } = makeDeps({
        providers: [mock, fake.provider],
        secrets: memorySecrets({ FAKE_KEY: 'secret-value' }), // no LIVE_CALLS
      })
      await deps.store.setSetting('provider', 'fake')
      const agent = await addAgent(deps)
      const lead = await addLead(deps, 'Lead', '+14155550101')
      await addCampaign(deps, agent.id, [lead.id])

      await createScheduler(deps).tick()
      const [call] = await deps.store.listCalls()
      assert.equal(fake.placed.length, 0)
      assert.equal(call.provider, 'mock')
      assert.equal(call.mode, 'dry_run')
    })

    it('still enforces the gate', async () => {
      const { deps } = makeDeps()
      const agent = await addAgent(deps)
      const lead = await addLead(deps, 'Lead', '+14155550101')
      await deps.store.addDnc({ phone: lead.phone, source: 'manual', reason: null, addedAt: deps.now().toISOString() })
      await addCampaign(deps, agent.id, [lead.id])

      await createScheduler(deps).tick()
      assert.equal((await deps.store.listCalls()).length, 0)
    })
  })

  it('does not dial when live is on but the platform is not ready', async () => {
    const fake = fakeProvider()
    const { deps } = makeDeps({
      providers: [mock, fake.provider],
      secrets: memorySecrets({ LIVE_CALLS: 'on' }), // no FAKE_KEY
    })
    await deps.store.setSetting('provider', 'fake')
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    await addCampaign(deps, agent.id, [lead.id])

    await createScheduler(deps).tick()
    assert.equal(fake.placed.length, 0)
    assert.equal((await deps.store.listCalls()).length, 0, 'and it must not fall back to the mock and look like it worked')
  })

  describe('test call', () => {
    it('only ever reaches MY_PHONE', async () => {
      const fake = fakeProvider()
      const { deps } = makeDeps({
        providers: [mock, fake.provider],
        secrets: memorySecrets({ MY_PHONE: '+14155550100', FAKE_KEY: 'secret-value' }),
      })
      await deps.store.setSetting('provider', 'fake')
      const agent = await addAgent(deps)

      const result = await placeTestCall(deps, agent)
      assert.equal(result.placed, true)
      assert.equal(fake.placed[0].to, '+14155550100')
    })

    it('is the one real call allowed during dry run', async () => {
      const fake = fakeProvider()
      const { deps } = makeDeps({
        providers: [mock, fake.provider],
        secrets: memorySecrets({ MY_PHONE: '+14155550100', FAKE_KEY: 'secret-value' }),
      })
      await deps.store.setSetting('provider', 'fake')
      const result = await placeTestCall(deps, await addAgent(deps))
      assert.equal(result.placed && result.call.mode, 'live')
    })

    it('uses the simulator when no platform is ready', async () => {
      const { deps } = makeDeps({ secrets: memorySecrets({ MY_PHONE: '+14155550100' }) })
      const result = await placeTestCall(deps, await addAgent(deps))
      assert.equal(result.placed && result.call.provider, 'mock')
    })

    it('refuses when there is no number saved', async () => {
      const { deps } = makeDeps()
      const result = await placeTestCall(deps, await addAgent(deps))
      assert.equal(result.placed, false)
    })

    it('is capped per day and does not count as a campaign attempt', async () => {
      const { deps } = makeDeps({ secrets: memorySecrets({ MY_PHONE: '+14155550100' }) })
      const agent = await addAgent(deps)
      for (let i = 0; i < TEST_CALLS_PER_DAY; i++) {
        assert.equal((await placeTestCall(deps, agent)).placed, true)
      }
      assert.equal((await placeTestCall(deps, agent)).placed, false)
      assert.equal((await deps.store.callsForPhone('+14155550100')).length, 0)
    })
  })
})
