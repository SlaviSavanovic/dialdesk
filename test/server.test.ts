import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApi } from '../src/api.ts'
import mock from '../src/providers/mock.ts'
import { addAgent, addCampaign, addLead, fakeProvider, makeDeps, memorySecrets } from './helpers.ts'

const APP_ORIGIN = 'http://localhost'
const SECRET = 'super-secret-key-value'

function setup(secrets: Record<string, string> = {}) {
  const fake = fakeProvider()
  const { deps } = makeDeps({ providers: [mock, fake.provider], secrets: memorySecrets(secrets) })
  const app = createApi(deps)
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { deps, app, send, fake }
}

describe('who the server answers', () => {
  it('refuses requests addressed to any other host', async () => {
    const { send } = setup()
    const response = await send('GET', '/api/status', undefined, { host: 'evil.example.com' })
    assert.equal(response.status, 403)
  })

  it('refuses writes coming from another website', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    await deps.store.setCampaignStatus(campaign.id, 'ready')

    const response = await send('POST', `/api/campaigns/${campaign.id}/start`, {}, { origin: 'https://evil.example.com' })
    assert.equal(response.status, 403)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'ready')
  })

  it('allows Claude to use the API from the command line', async () => {
    const { send } = setup()
    const response = await send('POST', '/api/leads', { name: 'Maya', phone: '415-555-0142', state: 'CA' })
    assert.equal(response.status, 201)
  })
})

describe('secrets', () => {
  it('only accepts keys from the app page, not from the command line', async () => {
    const { send, deps } = setup()
    const response = await send('POST', '/api/secrets', { values: { VAPI_API_KEY: SECRET } })
    assert.equal(response.status, 403)
    assert.equal(deps.secrets.has('VAPI_API_KEY'), false)
  })

  it('saves keys from the wizard and never returns them', async () => {
    const { send, deps } = setup()
    const response = await send('POST', '/api/secrets', { values: { VAPI_API_KEY: SECRET } }, { origin: APP_ORIGIN })
    assert.equal(response.status, 200)
    assert.equal(deps.secrets.get('VAPI_API_KEY'), SECRET)
    assert.doesNotMatch(await response.text(), new RegExp(SECRET))
  })

  it('refuses to write anything that is not a known key', async () => {
    const { send, deps } = setup()
    for (const name of ['LIVE_CALLS', 'PATH', 'SOMETHING_ELSE']) {
      const response = await send('POST', '/api/secrets', { values: { [name]: 'on' } }, { origin: APP_ORIGIN })
      assert.equal(response.status, 400, name)
    }
    assert.equal(deps.secrets.has('LIVE_CALLS'), false)
  })

  it('never exposes a key value in any read endpoint', async () => {
    const { send } = setup({ FAKE_KEY: SECRET, VAPI_API_KEY: SECRET, MY_PHONE: '+14155550100' })
    for (const path of ['/api/status', '/api/providers', '/api/setup', '/api/dashboard']) {
      const text = await (await send('GET', path)).text()
      assert.doesNotMatch(text, new RegExp(SECRET), path)
      assert.doesNotMatch(text, /\+14155550100/, path)
    }
  })

  it('reports which keys are set', async () => {
    const { send } = setup({ VAPI_API_KEY: SECRET })
    const { voice } = await (await send('GET', '/api/providers')).json()
    assert.equal(voice.find((provider: any) => provider.name === 'fake').keys[0].set, false)
  })

  it('normalizes your phone number and rejects a bad one', async () => {
    const { send, deps } = setup()
    const bad = await send('POST', '/api/secrets', { values: { MY_PHONE: '123' } }, { origin: APP_ORIGIN })
    assert.equal(bad.status, 400)
    await send('POST', '/api/secrets', { values: { MY_PHONE: '(415) 555-0100' } }, { origin: APP_ORIGIN })
    assert.equal(deps.secrets.get('MY_PHONE'), '+14155550100')
  })
})

describe('going live', () => {
  async function ready() {
    const env = setup({ FAKE_KEY: SECRET })
    await env.deps.store.setSetting('provider', 'fake')
    return env
  }

  it('cannot be done from the command line', async () => {
    const { send, deps } = await ready()
    const response = await send('POST', '/api/go-live', { confirm: 'GO LIVE' })
    assert.equal(response.status, 403)
    assert.equal(deps.secrets.has('LIVE_CALLS'), false)
  })

  it('needs the phrase typed out', async () => {
    const { send } = await ready()
    const response = await send('POST', '/api/go-live', { confirm: 'yes' }, { origin: APP_ORIGIN })
    assert.equal(response.status, 400)
  })

  it('needs a platform that is ready', async () => {
    const { send } = setup()
    const response = await send('POST', '/api/go-live', { confirm: 'GO LIVE' }, { origin: APP_ORIGIN })
    assert.equal(response.status, 400)
  })

  it('pauses running campaigns so nothing rings the moment it flips', async () => {
    const { send, deps } = await ready()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])

    const response = await send('POST', '/api/go-live', { confirm: 'GO LIVE' }, { origin: APP_ORIGIN })
    assert.equal(response.status, 200)
    assert.equal(deps.secrets.get('LIVE_CALLS'), 'on')
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'paused')
  })

  it('makes Claude confirm before starting a live campaign', async () => {
    const { send, deps } = await ready()
    deps.secrets.set({ LIVE_CALLS: 'on' })
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    await deps.store.setCampaignStatus(campaign.id, 'paused')

    const first = await send('POST', `/api/campaigns/${campaign.id}/start`, {})
    assert.equal(first.status, 409)
    assert.match((await first.json()).error, /real people/)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'paused')

    const second = await send('POST', `/api/campaigns/${campaign.id}/start`, { confirmLive: true })
    assert.equal(second.status, 200)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'running')
  })

  it('can always go back to dry run', async () => {
    const { send, deps } = await ready()
    deps.secrets.set({ LIVE_CALLS: 'on' })
    await send('POST', '/api/dry-run', {})
    assert.equal(deps.secrets.get('LIVE_CALLS'), 'off')
  })
})

describe('agents', () => {
  const base = { name: 'A', businessName: 'Biz', callerName: 'Ava', goal: 'G', script: 'S' }

  it('adds the AI disclosure by default', async () => {
    const { send } = setup()
    const agent = await (await send('POST', '/api/agents', base)).json()
    assert.equal(agent.firstLine, 'Hi, this is Ava, an AI assistant calling from Biz. This call may be recorded.')
  })

  it('refuses a first line with no disclosure', async () => {
    const { send, deps } = setup()
    const response = await send('POST', '/api/agents', { ...base, firstLine: 'Hi, this is Ava!' })
    assert.equal(response.status, 400)

    const agent = await addAgent(deps)
    const patch = await send('PATCH', `/api/agents/${agent.id}`, { firstLine: 'Hi, this is Ava!' })
    assert.equal(patch.status, 400)
  })
})

describe('campaigns', () => {
  it('rejects calling hours outside the hard limits', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const response = await send('POST', '/api/campaigns', { name: 'C', agentId: agent.id, windowStart: '07:00', windowEnd: '23:00' })
    assert.equal(response.status, 400)
  })

  it('shows why each lead is or is not callable', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const ok = await addLead(deps, 'Fine', '+14155550101')
    const noPlace = await addLead(deps, 'Nowhere', '+14155550102', null)
    const campaign = await addCampaign(deps, agent.id, [ok.id, noPlace.id])

    const view = await (await send('GET', `/api/campaigns/${campaign.id}`)).json()
    assert.equal(view.counts.ready, 1)
    assert.equal(view.counts.done, 1)
    assert.equal(view.leads[1].code, 'no_timezone')
  })

  it('stops everything with pause all', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    const result = await (await send('POST', '/api/pause-all', {})).json()
    assert.equal(result.paused, 1)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'paused')
  })
})

describe('practice campaign', () => {
  it('loads the sample leads into a ready campaign and starts it', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    await deps.store.setCampaignStatus(campaign.id, 'ready')

    const result = await (await send('POST', '/api/practice', {})).json()
    assert.equal(result.campaignId, campaign.id)
    assert.equal(result.added, 20)
    assert.equal((await deps.store.getCampaign(campaign.id))!.status, 'running')
    assert.equal((await deps.store.campaignLeads(campaign.id)).length, 21)
  })

  it('every sample number is fictional', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    await addCampaign(deps, agent.id, [])
    await send('POST', '/api/practice', {})
    for (const lead of await deps.store.listLeads()) {
      assert.match(lead.phone, /^\+1\d{3}55501\d{2}$/, lead.name)
    }
  })

  it('refuses to run while live', async () => {
    const { send, deps } = setup({ LIVE_CALLS: 'on' })
    const agent = await addAgent(deps)
    await addCampaign(deps, agent.id, [])
    assert.equal((await send('POST', '/api/practice', {})).status, 409)
  })
})

describe('clearing out example data', () => {
  it('deletes a campaign and its agent, in that order, keeping the call history', async () => {
    const { send, deps } = setup()
    const agent = await addAgent(deps)
    const lead = await addLead(deps, 'Lead', '+14155550101')
    const campaign = await addCampaign(deps, agent.id, [lead.id])
    await deps.store.createCall({
      campaignId: campaign.id, leadId: lead.id, leadName: lead.name, phone: lead.phone,
      kind: 'campaign', mode: 'dry_run', provider: 'mock', startedAt: deps.now().toISOString(),
    })

    assert.equal((await send('DELETE', `/api/agents/${agent.id}`)).status, 409, 'agent is still in use')
    assert.equal((await send('DELETE', `/api/campaigns/${campaign.id}`)).status, 409, 'campaign is still running')

    await deps.store.setCampaignStatus(campaign.id, 'stopped')
    assert.equal((await send('DELETE', `/api/campaigns/${campaign.id}`)).status, 200)
    assert.equal((await send('DELETE', `/api/agents/${agent.id}`)).status, 200)
    assert.equal((await deps.store.listCalls()).length, 1)
  })
})

describe('do-not-call list', () => {
  it('has no way to remove a number', async () => {
    const { send, deps } = setup()
    await deps.store.addDnc({ phone: '+14155550101', source: 'opt_out', reason: null, addedAt: deps.now().toISOString() })
    const response = await send('DELETE', '/api/dnc/+14155550101')
    assert.equal(response.status, 404)
    assert.equal(await deps.store.isOnDnc('+14155550101'), true)
  })
})
