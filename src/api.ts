import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ROOT } from './config.ts'
import { contextFor, currentMode, readinessOf, selectedProvider, type Deps } from './context.ts'
import { placeTestCall } from './dial.ts'
import { cleanLead, importDncList, importLeadsCsv, normalizePhone } from './leads.ts'
import { sendRequest } from './providers/shared.ts'
import { findTarget, targets } from './providers/index.ts'
import { redact } from './secrets.ts'
import { buildPrompt, defaultFirstLine, hasDisclosure } from './script.ts'
import { DEFAULT_DAYS, DEFAULT_END, DEFAULT_START, HARD_EARLIEST, HARD_LATEST, toMinutes } from './timezones.ts'
import type { AgentInput, CampaignInput, SetupState } from './types.ts'
import { campaignSummary, campaignView, dashboardView, EMPTY_SETUP, providersView, statusView } from './views.ts'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const hostnameOf = (host: string) => host.replace(/:\d+$/, '').toLowerCase()

const fail = (c: Context, status: 400 | 403 | 404 | 409, error: string) => c.json({ error }, status)
const idOf = (c: Context) => Number(c.req.param('id'))
const jsonBody = async (c: Context): Promise<any> => c.req.json().catch(() => ({}))

function requestHost(c: Context) {
  return c.req.header('host') ?? new URL(c.req.url).host
}

function originMatches(c: Context) {
  const origin = c.req.header('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === requestHost(c)
  } catch {
    return false
  }
}

// Keys and the go-live switch only accept requests from the app's own page. curl
// and scripts send no Origin header, so Claude can't set these by accident.
const fromTheApp = originMatches

export function createApi(deps: Deps) {
  const app = new Hono()

  // This server has no login, so it must only answer the person at this computer.
  // The host check stops DNS rebinding, and the origin check stops any other site
  // open in the browser from posting here.
  app.use('*', async (c, next) => {
    if (!LOCAL_HOSTS.has(hostnameOf(requestHost(c)))) return fail(c, 403, 'dialdesk only answers on localhost.')
    const isWrite = !['GET', 'HEAD'].includes(c.req.method)
    if (isWrite && c.req.header('origin') && !originMatches(c)) return fail(c, 403, 'Request came from another site.')
    await next()
  })

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = deps.events.subscribe((topic) => {
        void stream.writeSSE({ event: 'change', data: topic })
      })
      stream.onAbort(unsubscribe)
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' })
        await stream.sleep(25_000)
      }
    }),
  )

  // ---- Reading state ----------------------------------------------------------

  app.get('/api/status', async (c) => c.json(await statusView(deps)))
  app.get('/api/dashboard', async (c) => c.json(await dashboardView(deps)))
  app.get('/api/providers', async (c) => c.json(await providersView(deps)))

  // ---- Setup wizard -----------------------------------------------------------

  app.get('/api/setup', async (c) => c.json(await deps.store.getSetting('setup', EMPTY_SETUP)))

  app.put('/api/setup', async (c) => {
    const body = await jsonBody(c)
    const setup = await deps.store.getSetting<SetupState>('setup', EMPTY_SETUP)
    const next: SetupState = {
      complete: typeof body.complete === 'boolean' ? body.complete : setup.complete,
      answers: { ...setup.answers, ...body.answers },
    }
    await deps.store.setSetting('setup', next)
    deps.events.emit('setup')
    return c.json(next)
  })

  // Keys go from the wizard straight into .env, never through the chat, and they
  // never come back out. The response only says which ones are set.
  app.post('/api/secrets', async (c) => {
    if (!fromTheApp(c)) return fail(c, 403, 'Keys can only be added from the setup wizard in the browser. Never ask the user to paste one into the chat.')
    const { values } = await jsonBody(c)
    const allowed = targets.flatMap((target) => target.keys.map((key) => key.env))
    const next: Record<string, string> = {}

    for (const [name, value] of Object.entries(values ?? {})) {
      const text = String(value ?? '').trim()
      if (!text) continue
      if (name === 'MY_PHONE') {
        const phone = normalizePhone(text)
        if (!phone) return fail(c, 400, `"${text}" doesn't look like a phone number.`)
        next.MY_PHONE = phone
      } else if (allowed.includes(name)) {
        next[name] = text
      } else {
        return fail(c, 400, `${name} isn't a key dialdesk knows about.`)
      }
    }

    deps.secrets.set(next)
    deps.events.emit('status')
    return c.json({ saved: Object.keys(next) })
  })

  // Sends a harmless request to prove a key works. Reports only yes or no.
  app.post('/api/providers/:name/check', async (c) => {
    const target = findTarget(c.req.param('name'))
    if (!target || target.name === 'mock') return fail(c, 404, 'No such platform.')
    if (target.keys.some((key) => !deps.secrets.has(key.env))) {
      return c.json({ ok: false, message: 'No key saved yet.' })
    }
    const ctx = await contextFor(deps, target)
    const check = target.keyCheck(ctx)
    try {
      const { ok, status } = await sendRequest(target, ctx, { method: check.method, path: check.path, json: check.body })
      if (ok) return c.json({ ok: true, message: `${target.label} accepted this key.` })
      if (status === 401 || status === 403) {
        return c.json({ ok: false, message: `${target.label} rejected this key. Make sure you copied all of it.` })
      }
      return c.json({ ok: false, message: `${target.label} answered with an error (${status}).` })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, message: `Couldn't reach ${target.label}: ${redact(message, deps.secrets.allValues())}` })
    }
  })

  // Chooses the platform and saves its non-secret IDs. name: null means simulate only.
  app.put('/api/provider', async (c) => {
    const { name, config } = await jsonBody(c)
    if (name === null) {
      await deps.store.setSetting('provider', null)
      deps.events.emit('status')
      return c.json(await statusView(deps))
    }
    const provider = deps.providers.find((candidate) => candidate.name === name && candidate.name !== 'mock')
    if (!provider) return fail(c, 400, `Unknown platform "${name}". Options: ${deps.providers.filter((p) => p.name !== 'mock').map((p) => p.name).join(', ')}.`)

    await deps.store.setSetting('provider', provider.name)
    if (config) {
      const known = provider.config.map((field) => field.name)
      const unknown = Object.keys(config).filter((field) => !known.includes(field))
      if (unknown.length > 0) return fail(c, 400, `${provider.label} has no setting called ${unknown.join(', ')}. Options: ${known.join(', ') || 'none'}.`)
      const configs = await deps.store.getSetting<Record<string, Record<string, string>>>('provider_config', {})
      await deps.store.setSetting('provider_config', { ...configs, [provider.name]: { ...configs[provider.name], ...config } })
    }
    deps.events.emit('status')
    return c.json(await statusView(deps))
  })

  // ---- Leads ------------------------------------------------------------------

  app.get('/api/leads', async (c) => {
    const leads = await deps.store.listLeads(c.req.query('q'))
    const dnc = new Set((await deps.store.listDnc()).map((entry) => entry.phone))
    return c.json(leads.map((lead) => ({ ...lead, onDnc: dnc.has(lead.phone) })))
  })

  app.post('/api/leads', async (c) => {
    const cleaned = cleanLead(await jsonBody(c))
    if ('error' in cleaned) return fail(c, 400, cleaned.error)
    const { lead, created } = await deps.store.upsertLead(cleaned, deps.now().toISOString())
    deps.events.emit('leads')
    return c.json(lead, created ? 201 : 200)
  })

  // Send text/csv, or JSON with a csv field. Add campaignId to put them in a campaign.
  app.post('/api/leads/import', async (c) => {
    const isCsv = c.req.header('content-type')?.includes('text/csv')
    const body = isCsv ? { csv: await c.req.text(), campaignId: c.req.query('campaignId') } : await jsonBody(c)
    if (!body.csv) return fail(c, 400, 'Send the CSV as text/csv, or as JSON with a csv field.')
    const result = await importLeadsCsv(deps.store, body.csv, deps.now().toISOString())
    if (body.campaignId) await deps.store.addCampaignLeads(Number(body.campaignId), result.leadIds)
    deps.events.emit('leads')
    deps.events.emit('campaigns')
    return c.json(result)
  })

  app.get('/api/leads/:id', async (c) => {
    const lead = await deps.store.getLead(idOf(c))
    if (!lead) return fail(c, 404, 'No such lead.')
    return c.json({
      lead,
      onDnc: await deps.store.isOnDnc(lead.phone),
      calls: await deps.store.listCalls({ leadId: lead.id }),
    })
  })

  app.patch('/api/leads/:id', async (c) => {
    const lead = await deps.store.getLead(idOf(c))
    if (!lead) return fail(c, 404, 'No such lead.')
    const cleaned = cleanLead({ ...lead, ...(await jsonBody(c)) })
    if ('error' in cleaned) return fail(c, 400, cleaned.error)
    const updated = await deps.store.updateLead(lead.id, cleaned)
    deps.events.emit('leads')
    return c.json(updated)
  })

  app.delete('/api/leads/:id', async (c) => {
    await deps.store.deleteLead(idOf(c))
    deps.events.emit('leads')
    return c.json({ deleted: true })
  })

  // ---- Agents -----------------------------------------------------------------

  app.get('/api/agents', async (c) => c.json(await deps.store.listAgents()))

  app.get('/api/agents/:id', async (c) => {
    const agent = await deps.store.getAgent(idOf(c))
    if (!agent) return fail(c, 404, 'No such agent.')
    // The exact instructions a platform receives, with a sample name filled in.
    return c.json({ agent, compiledPrompt: buildPrompt(agent, { name: 'Sample Lead' }) })
  })

  app.post('/api/agents', async (c) => {
    const body = await jsonBody(c)
    for (const field of ['name', 'businessName', 'callerName', 'goal', 'script']) {
      if (!body[field]?.trim?.()) return fail(c, 400, `An agent needs a ${field}.`)
    }
    const input: AgentInput = {
      name: body.name,
      businessName: body.businessName,
      callerName: body.callerName,
      goal: body.goal,
      script: body.script,
      firstLine: body.firstLine ?? defaultFirstLine(body.callerName, body.businessName),
      captureFields: Array.isArray(body.captureFields) ? body.captureFields : [],
    }
    if (!hasDisclosure(input.firstLine)) return fail(c, 400, 'The first line has to say the caller is an AI. Use the word "AI" in capitals.')
    const agent = await deps.store.createAgent(input, deps.now().toISOString())
    deps.events.emit('agents')
    return c.json(agent, 201)
  })

  app.patch('/api/agents/:id', async (c) => {
    const body = await jsonBody(c)
    if (body.firstLine !== undefined && !hasDisclosure(body.firstLine)) {
      return fail(c, 400, 'The first line has to say the caller is an AI. Use the word "AI" in capitals.')
    }
    const agent = await deps.store.updateAgent(idOf(c), body, deps.now().toISOString())
    if (!agent) return fail(c, 404, 'No such agent.')
    deps.events.emit('agents')
    return c.json(agent)
  })

  app.delete('/api/agents/:id', async (c) => {
    const inUse = (await deps.store.listCampaigns()).some((campaign) => campaign.agentId === idOf(c))
    if (inUse) return fail(c, 409, 'A campaign still uses this agent. Delete the campaign first.')
    await deps.store.deleteAgent(idOf(c))
    deps.events.emit('agents')
    return c.json({ deleted: true })
  })

  // ---- Campaigns --------------------------------------------------------------

  app.get('/api/campaigns', async (c) => {
    const campaigns = await deps.store.listCampaigns()
    return c.json(await Promise.all(campaigns.map((campaign) => campaignSummary(deps, campaign))))
  })

  app.post('/api/campaigns', async (c) => {
    const body = await jsonBody(c)
    if (!body.name?.trim?.()) return fail(c, 400, 'A campaign needs a name.')
    if (!(await deps.store.getAgent(Number(body.agentId)))) return fail(c, 400, 'A campaign needs an agentId that exists.')
    const input: CampaignInput = {
      name: body.name,
      agentId: Number(body.agentId),
      days: body.days ?? DEFAULT_DAYS,
      windowStart: body.windowStart ?? DEFAULT_START,
      windowEnd: body.windowEnd ?? DEFAULT_END,
      maxPerHour: body.maxPerHour ?? 30,
      maxAttempts: body.maxAttempts ?? 3,
      retryDelayMinutes: body.retryDelayMinutes ?? 24 * 60,
    }
    const problem = campaignProblem(input)
    if (problem) return fail(c, 400, problem)

    const campaign = await deps.store.createCampaign(input, deps.now().toISOString())
    const leadIds = body.allLeads ? (await deps.store.listLeads()).map((lead) => lead.id) : body.leadIds ?? []
    await deps.store.addCampaignLeads(campaign.id, leadIds)
    deps.events.emit('campaigns')
    return c.json(await campaignSummary(deps, campaign), 201)
  })

  app.get('/api/campaigns/:id', async (c) => {
    const campaign = await deps.store.getCampaign(idOf(c))
    if (!campaign) return fail(c, 404, 'No such campaign.')
    return c.json(await campaignView(deps, campaign))
  })

  app.patch('/api/campaigns/:id', async (c) => {
    const campaign = await deps.store.getCampaign(idOf(c))
    if (!campaign) return fail(c, 404, 'No such campaign.')
    const body = await jsonBody(c)
    const problem = campaignProblem({ ...campaign, ...body })
    if (problem) return fail(c, 400, problem)
    await deps.store.updateCampaign(campaign.id, body)
    if (body.addLeadIds) await deps.store.addCampaignLeads(campaign.id, body.addLeadIds)
    if (body.removeLeadIds) await deps.store.removeCampaignLeads(campaign.id, body.removeLeadIds)
    deps.events.emit('campaigns')
    return c.json(await campaignSummary(deps, (await deps.store.getCampaign(campaign.id))!))
  })

  app.delete('/api/campaigns/:id', async (c) => {
    const campaign = await deps.store.getCampaign(idOf(c))
    if (!campaign) return fail(c, 404, 'No such campaign.')
    if (campaign.status === 'running') return fail(c, 409, 'Pause this campaign before deleting it.')
    await deps.store.deleteCampaign(campaign.id)
    deps.events.emit('campaigns')
    return c.json({ deleted: true })
  })

  app.post('/api/campaigns/:id/start', async (c) => {
    const campaign = await deps.store.getCampaign(idOf(c))
    if (!campaign) return fail(c, 404, 'No such campaign.')
    const leads = await deps.store.campaignLeads(campaign.id)
    if (leads.length === 0) return fail(c, 400, 'This campaign has no leads yet.')

    if (currentMode(deps) === 'live') {
      const { confirmLive } = await jsonBody(c)
      if (confirmLive !== true && !fromTheApp(c)) {
        return fail(c, 409, `Live calling is on, so this will ring up to ${leads.length} real people. Ask the user first, then resend with {"confirmLive": true}.`)
      }
    }

    const notices = await deps.store.getSetting<Record<string, string>>('campaign_notices', {})
    delete notices[campaign.id]
    await deps.store.setSetting('campaign_notices', notices)
    await deps.store.setCampaignStatus(campaign.id, 'running')
    deps.events.emit('campaigns')
    return c.json(await campaignSummary(deps, (await deps.store.getCampaign(campaign.id))!))
  })

  for (const [action, status] of [['pause', 'paused'], ['stop', 'stopped']] as const) {
    app.post(`/api/campaigns/:id/${action}`, async (c) => {
      const campaign = await deps.store.getCampaign(idOf(c))
      if (!campaign) return fail(c, 404, 'No such campaign.')
      await deps.store.setCampaignStatus(campaign.id, status)
      deps.events.emit('campaigns')
      return c.json(await campaignSummary(deps, (await deps.store.getCampaign(campaign.id))!))
    })
  }

  // The wizard's practice button: fake leads, simulated calls, something to watch.
  app.post('/api/practice', async (c) => {
    if (currentMode(deps) === 'live') return fail(c, 409, 'Practice campaigns only run in dry run.')
    const campaigns = await deps.store.listCampaigns()
    const campaign = campaigns.find((candidate) => candidate.status === 'ready') ?? campaigns.at(-1)
    if (!campaign) return fail(c, 400, 'There is no campaign to practice with.')

    const csv = readFileSync(join(ROOT, 'samples', 'leads.csv'), 'utf8')
    const { leadIds } = await importLeadsCsv(deps.store, csv, deps.now().toISOString())
    await deps.store.addCampaignLeads(campaign.id, leadIds)
    await deps.store.setCampaignStatus(campaign.id, 'running')
    deps.events.emit('leads')
    deps.events.emit('campaigns')
    return c.json({ campaignId: campaign.id, added: leadIds.length })
  })

  // The one big red button. Calls already ringing finish, but nothing new starts.
  app.post('/api/pause-all', async (c) => {
    const paused = await pauseRunning(deps)
    return c.json({ paused })
  })

  // ---- Calls ------------------------------------------------------------------

  app.get('/api/calls', async (c) => {
    const campaignId = c.req.query('campaignId')
    return c.json(
      await deps.store.listCalls({
        campaignId: campaignId ? Number(campaignId) : undefined,
        limit: Number(c.req.query('limit') ?? 200),
      }),
    )
  })

  app.get('/api/calls/:id', async (c) => {
    const call = await deps.store.getCall(idOf(c))
    return call ? c.json(call) : fail(c, 404, 'No such call.')
  })

  // Lets Claude fill in a summary or captured info by reading the transcript, for
  // platforms that don't provide them.
  app.patch('/api/calls/:id', async (c) => {
    const { summary, captured } = await jsonBody(c)
    if (!(await deps.store.getCall(idOf(c)))) return fail(c, 404, 'No such call.')
    const call = await deps.store.updateCall(idOf(c), { summary, captured })
    deps.events.emit('calls')
    return c.json(call)
  })

  app.post('/api/test-call', async (c) => {
    const { agentId } = await jsonBody(c)
    const agent = agentId ? await deps.store.getAgent(Number(agentId)) : (await deps.store.listAgents())[0]
    if (!agent) return fail(c, 400, 'Create an agent first.')
    const result = await placeTestCall(deps, agent)
    return result.placed ? c.json({ placed: true, call: result.call }) : fail(c, 400, result.reason)
  })

  // ---- Do-not-call list -------------------------------------------------------

  app.get('/api/dnc', async (c) => c.json(await deps.store.listDnc()))

  // There's deliberately no way to remove a number through the API.
  app.post('/api/dnc', async (c) => {
    const { phone, reason, list } = await jsonBody(c)
    const now = deps.now().toISOString()
    if (list) {
      const result = await importDncList(deps.store, list, now)
      deps.events.emit('dnc')
      return c.json(result)
    }
    const normalized = normalizePhone(phone)
    if (!normalized) return fail(c, 400, `"${phone}" doesn't look like a phone number.`)
    await deps.store.addDnc({ phone: normalized, source: 'manual', reason: reason ?? null, addedAt: now })
    deps.events.emit('dnc')
    return c.json({ added: normalized }, 201)
  })

  // ---- Dry run and live -------------------------------------------------------

  app.post('/api/go-live', async (c) => {
    if (!fromTheApp(c)) return fail(c, 403, 'Going live can only be done by the user, on the Go live screen in the browser.')
    const { confirm } = await jsonBody(c)
    if (confirm !== 'GO LIVE') return fail(c, 400, 'Type GO LIVE to confirm.')

    const provider = await selectedProvider(deps)
    if (!provider) return fail(c, 400, 'Choose a voice platform first.')
    const readiness = await readinessOf(deps, provider)
    if (!readiness.ready) {
      return fail(c, 400, `${provider.label} is missing: ${[...readiness.missingKeys, ...readiness.missingConfig].join(', ')}.`)
    }

    // A campaign left running during dry run must not start ringing real people
    // the moment this flips.
    await pauseRunning(deps)
    deps.secrets.set({ LIVE_CALLS: 'on' })
    deps.events.emit('status')
    return c.json(await statusView(deps))
  })

  app.post('/api/dry-run', async (c) => {
    deps.secrets.set({ LIVE_CALLS: 'off' })
    deps.events.emit('status')
    return c.json(await statusView(deps))
  })

  app.onError((error, c) => {
    const message = redact(error.message, deps.secrets.allValues())
    console.error('Request failed:', message)
    return c.json({ error: message }, 500)
  })

  return app
}

async function pauseRunning(deps: Deps): Promise<number> {
  let paused = 0
  for (const campaign of await deps.store.listCampaigns()) {
    if (campaign.status === 'running') {
      await deps.store.setCampaignStatus(campaign.id, 'paused')
      paused++
    }
  }
  deps.events.emit('campaigns')
  return paused
}

function campaignProblem(input: CampaignInput): string | null {
  const isTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!isTime(input.windowStart) || !isTime(input.windowEnd)) return 'Times need to look like 09:00 or 20:00.'
  if (toMinutes(input.windowStart) >= toMinutes(input.windowEnd)) return 'The calling window has to end after it starts.'
  if (toMinutes(input.windowStart) < toMinutes(HARD_EARLIEST) || toMinutes(input.windowEnd) > toMinutes(HARD_LATEST)) {
    return `Calling hours can't go outside ${HARD_EARLIEST} to ${HARD_LATEST} in the lead's local time.`
  }
  if (!Array.isArray(input.days) || input.days.length === 0 || input.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return 'days should be a list of numbers from 0 (Sunday) to 6 (Saturday).'
  }
  if (input.maxPerHour < 1 || input.maxAttempts < 1 || input.retryDelayMinutes < 1) {
    return 'maxPerHour, maxAttempts and retryDelayMinutes all have to be at least 1.'
  }
  return null
}
