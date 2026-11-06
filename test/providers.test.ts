import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import bland from '../src/providers/bland.ts'
import deepgram from '../src/providers/deepgram.ts'
import elevenlabs from '../src/providers/elevenlabs.ts'
import { allProviders, targets } from '../src/providers/index.ts'
import { questionsIn, transcriptFor } from '../src/providers/mock.ts'
import retell from '../src/providers/retell.ts'
import { fillSecretPlaceholders, isDialRequest, parseTranscript } from '../src/providers/shared.ts'
import synthflow from '../src/providers/synthflow.ts'
import twilio from '../src/providers/twilio.ts'
import type { DialRequest, ProviderContext } from '../src/providers/types.ts'
import vapi from '../src/providers/vapi.ts'
import { createSecrets, redact } from '../src/secrets.ts'

// These check each adapter against response shapes from the platform's docs. They
// prove the mapping is right, not that the platform behaves the way its docs say.

const REQUEST: DialRequest = {
  to: '+14155550142',
  leadName: 'Maya Chen',
  firstLine: 'Hi, this is Ava, an AI assistant.',
  prompt: 'Follow the script.',
  captureFields: ['best_day'],
}

function stubContext(response: unknown, config: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit }[] = []
  const ctx: ProviderContext = {
    key: () => 'test-key',
    config,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, init })
      return new Response(JSON.stringify(response), { status: 200 })
    }) as unknown as typeof fetch,
  }
  return { ctx, sent, body: () => JSON.parse(sent[0].init.body as string) }
}

describe('Bland', () => {
  it('sends the script and first line with the call', async () => {
    const { ctx, sent, body } = stubContext({ status: 'success', call_id: 'abc' })
    assert.deepEqual(await bland.placeCall(ctx, REQUEST), { providerCallId: 'abc' })
    assert.equal(sent[0].url, 'https://api.bland.ai/v1/calls')
    assert.equal(body().phone_number, REQUEST.to)
    assert.equal(body().task, REQUEST.prompt)
    assert.equal(body().first_sentence, REQUEST.firstLine)
    assert.equal('from' in body(), false, "leaves out from, so Bland's number pool is used")
  })

  it('maps a finished call', async () => {
    const { ctx } = stubContext({
      completed: true,
      status: 'completed',
      queue_status: 'complete',
      answered_by: 'human',
      corrected_duration: '93',
      summary: 'Went well',
      analysis: { best_day: 'Tuesday' },
      transcripts: [
        { user: 'assistant', text: 'Hi' },
        { user: 'user', text: 'Hello' },
        { user: 'agent-action', text: 'ended' },
      ],
    })
    const result = await bland.getCall(ctx, 'abc')
    assert.equal(result.status, 'ended')
    assert.equal(result.outcome, 'connected')
    assert.equal(result.durationSec, 93)
    assert.deepEqual(result.turns, [{ role: 'agent', text: 'Hi' }, { role: 'lead', text: 'Hello' }])
  })

  it('knows voicemail and no answer', async () => {
    const voicemail = stubContext({ completed: true, status: 'completed', answered_by: 'voicemail' })
    assert.equal((await bland.getCall(voicemail.ctx, 'x')).outcome, 'voicemail')
    const noAnswer = stubContext({ completed: true, status: 'no-answer' })
    assert.equal((await bland.getCall(noAnswer.ctx, 'x')).outcome, 'no_answer')
  })

  it('reports a call still going', async () => {
    const { ctx } = stubContext({ completed: false, queue_status: 'started' })
    assert.equal((await bland.getCall(ctx, 'x')).status, 'in_progress')
  })
})

describe('Vapi', () => {
  it('sends a transient assistant so the script comes from this app', async () => {
    const { ctx, body } = stubContext({ id: 'call_1' }, { phoneNumberId: 'pn_1' })
    assert.deepEqual(await vapi.placeCall(ctx, REQUEST), { providerCallId: 'call_1' })
    assert.equal(body().phoneNumberId, 'pn_1')
    assert.equal(body().customer.number, REQUEST.to)
    assert.equal(body().assistant.firstMessage, REQUEST.firstLine)
    assert.equal(body().assistant.model.messages[0].content, REQUEST.prompt)
  })

  it('maps a finished call', async () => {
    const { ctx } = stubContext({
      status: 'ended',
      endedReason: 'customer-ended-call',
      startedAt: '2026-06-03T19:00:00Z',
      endedAt: '2026-06-03T19:01:30Z',
      artifact: {
        messages: [
          { role: 'system', message: 'Instructions' },
          { role: 'bot', message: 'Hi' },
          { role: 'user', message: 'Hello' },
        ],
      },
      analysis: { summary: 'Went well', structuredData: { best_day: 'Tuesday' } },
    })
    const result = await vapi.getCall(ctx, 'x')
    assert.equal(result.outcome, 'connected')
    assert.equal(result.durationSec, 90)
    assert.deepEqual(result.turns, [{ role: 'agent', text: 'Hi' }, { role: 'lead', text: 'Hello' }])
    assert.equal(result.summary, 'Went well')
    assert.deepEqual(result.captured, { best_day: 'Tuesday' })
  })

  it('maps its end reasons', async () => {
    const reasons = {
      'customer-did-not-answer': 'no_answer',
      'customer-busy': 'busy',
      voicemail: 'voicemail',
      'twilio-failed-to-connect-call': 'failed',
      'assistant-ended-call': 'connected',
    }
    for (const [endedReason, outcome] of Object.entries(reasons)) {
      const { ctx } = stubContext({ status: 'ended', endedReason })
      assert.equal((await vapi.getCall(ctx, 'x')).outcome, outcome, endedReason)
    }
  })
})

describe('Retell', () => {
  it('passes the prompt as a variable, since it cannot be overridden per call', async () => {
    const { ctx, sent, body } = stubContext({ call_id: 'c1' }, { fromNumber: '+14155550100', agentId: 'a1' })
    await retell.placeCall(ctx, REQUEST)
    assert.equal(sent[0].url, 'https://api.retellai.com/v2/create-phone-call')
    assert.equal(body().from_number, '+14155550100')
    assert.equal(body().override_agent_id, 'a1')
    assert.equal(body().retell_llm_dynamic_variables.dialdesk_prompt, REQUEST.prompt)
    assert.equal(body().agent_override.retell_llm.begin_message, REQUEST.firstLine)
  })

  it('maps a finished call', async () => {
    const { ctx } = stubContext({
      call_status: 'ended',
      disconnection_reason: 'user_hangup',
      duration_ms: 90500,
      transcript: 'Agent: Hi\nUser: Hello',
      call_analysis: { call_summary: 'Went well', custom_analysis_data: { best_day: 'Tuesday' } },
    })
    const result = await retell.getCall(ctx, 'x')
    assert.equal(result.outcome, 'connected')
    assert.equal(result.durationSec, 91)
    assert.equal(result.turns[1].role, 'lead')
    assert.equal(result.summary, 'Went well')
  })

  it('maps its end reasons', async () => {
    for (const [reason, outcome] of [['dial_no_answer', 'no_answer'], ['dial_busy', 'busy'], ['voicemail_reached', 'voicemail'], ['dial_failed', 'failed']]) {
      const { ctx } = stubContext({ call_status: 'ended', disconnection_reason: reason })
      assert.equal((await retell.getCall(ctx, 'x')).outcome, outcome, reason)
    }
  })
})

describe('ElevenLabs', () => {
  it('sends overrides and uses the right trunk', async () => {
    const twilioCall = stubContext({ success: true, conversation_id: 'conv' }, { agentId: 'a', phoneNumberId: 'p' })
    assert.deepEqual(await elevenlabs.placeCall(twilioCall.ctx, REQUEST), { providerCallId: 'conv' })
    assert.match(twilioCall.sent[0].url, /\/v1\/convai\/twilio\/outbound-call$/)
    const override = twilioCall.body().conversation_initiation_client_data.conversation_config_override.agent
    assert.equal(override.first_message, REQUEST.firstLine)
    assert.equal(override.prompt.prompt, REQUEST.prompt)

    const sipCall = stubContext({ conversation_id: 'conv' }, { agentId: 'a', phoneNumberId: 'p', phoneType: 'sip' })
    await elevenlabs.placeCall(sipCall.ctx, REQUEST)
    assert.match(sipCall.sent[0].url, /\/v1\/convai\/sip-trunk\/outbound-call$/)
  })

  it('maps a finished conversation', async () => {
    const { ctx } = stubContext({
      status: 'done',
      metadata: { call_duration_secs: 75, termination_reason: 'Call ended by remote party' },
      transcript: [
        { role: 'agent', message: 'Hi' },
        { role: 'user', message: 'Hello' },
        { role: 'agent', message: null },
      ],
      analysis: {
        transcript_summary: 'Went well',
        data_collection_results: { best_day: { value: 'Tuesday', rationale: 'said so' } },
      },
    })
    const result = await elevenlabs.getCall(ctx, 'x')
    assert.equal(result.outcome, 'connected')
    assert.equal(result.durationSec, 75)
    assert.equal(result.turns.length, 2)
    assert.deepEqual(result.captured, { best_day: 'Tuesday' })
  })

  it('treats a done call nobody spoke on as no answer', async () => {
    const { ctx } = stubContext({ status: 'done', metadata: {}, transcript: [{ role: 'agent', message: 'Hi' }] })
    assert.equal((await elevenlabs.getCall(ctx, 'x')).outcome, 'no_answer')
  })

  it('waits while the transcript is still processing', async () => {
    const { ctx } = stubContext({ status: 'processing' })
    assert.equal((await elevenlabs.getCall(ctx, 'x')).status, 'in_progress')
  })

  it('authenticates with its own header', () => {
    const { ctx } = stubContext({})
    assert.deepEqual(elevenlabs.authHeaders(ctx), { 'xi-api-key': 'test-key' })
  })
})

describe('Synthflow', () => {
  it('sends prompt and greeting with the call', async () => {
    const { ctx, sent, body } = stubContext({ status: 'ok', response: { call_id: 'c1' } }, { modelId: 'm1' })
    assert.deepEqual(await synthflow.placeCall(ctx, REQUEST), { providerCallId: 'c1' })
    assert.equal(sent[0].url, 'https://api.synthflow.ai/v2/calls')
    assert.equal(body().model_id, 'm1')
    assert.equal(body().phone, REQUEST.to)
    assert.equal(body().prompt, REQUEST.prompt)
    assert.equal(body().greeting, REQUEST.firstLine)
  })

  it('maps its statuses', async () => {
    for (const [status, outcome] of [['completed', 'connected'], ['no-answer', 'no_answer'], ['busy', 'busy'], ['left_voicemail', 'voicemail'], ['failed', 'failed']]) {
      const { ctx } = stubContext({ status, duration: 30, transcript: 'agent: Hi\nuser: Hello' })
      assert.equal((await synthflow.getCall(ctx, 'x')).outcome, outcome, status)
    }
  })

  it('finds the call inside a wrapped response', async () => {
    const { ctx } = stubContext({ response: { calls: [{ status: 'completed', duration: 30 }] } })
    assert.equal((await synthflow.getCall(ctx, 'x')).durationSec, 30)
  })
})

describe('reaching platforms from the command line', () => {
  it('refuses every endpoint that places a call', () => {
    const dials: [typeof bland, string][] = [
      [bland, '/v1/calls'],
      [bland, '/v1/batches'],
      [vapi, '/call'],
      [vapi, '/campaign'],
      [retell, '/v2/create-phone-call'],
      [retell, '/create-phone-call'],
      [retell, '/v2/create-batch-call'],
      [elevenlabs, '/v1/convai/twilio/outbound-call'],
      [elevenlabs, '/v1/convai/sip-trunk/outbound-call'],
      [elevenlabs, '/v1/convai/batch-calling/submit'],
      [synthflow, '/v2/calls'],
      [twilio as any, '/2010-04-01/Accounts/AC1/Calls.json'],
    ]
    for (const [target, path] of dials) {
      assert.equal(isDialRequest(target, 'POST', path), true, `${target.name} ${path}`)
    }
  })

  it('is not fooled by query strings, doubled slashes or lowercase methods', () => {
    assert.equal(isDialRequest(vapi, 'post', '/call?x=1'), true)
    assert.equal(isDialRequest(vapi, 'POST', '//call'), true)
  })

  it('refuses a dial from the actual command, before touching the network or any key', () => {
    const result = spawnSync(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', 'cli/api.ts', 'vapi', 'POST', '/call'],
      { encoding: 'utf8', env: { ...process.env, DIALDESK_ENV_FILE: join(tmpdir(), 'dialdesk-does-not-exist') } },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Refused/)
  })

  it('fills in a saved key without the command ever containing it', () => {
    const get = (name: string) => (name === 'TWILIO_AUTH_TOKEN' ? 'to"ken' : undefined)
    const body = fillSecretPlaceholders('{"twilioAuthToken":"{{env:TWILIO_AUTH_TOKEN}}"}', get)
    assert.equal(JSON.parse(body).twilioAuthToken, 'to"ken')
    assert.throws(() => fillSecretPlaceholders('{{env:MISSING}}', get), /MISSING/)
  })

  it('allows setup work and reading calls', () => {
    assert.equal(isDialRequest(vapi, 'GET', '/call/123'), false)
    assert.equal(isDialRequest(vapi, 'GET', '/phone-number'), false)
    assert.equal(isDialRequest(vapi, 'POST', '/assistant'), false)
    assert.equal(isDialRequest(retell, 'POST', '/create-retell-llm'), false)
    assert.equal(isDialRequest(twilio as any, 'POST', '/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json'), false)
    assert.equal(isDialRequest(deepgram as any, 'GET', '/v1/projects'), false)
  })
})

describe('provider discovery', () => {
  it('picks up every file in the folder and skips the template', () => {
    assert.deepEqual(
      targets.map((target) => target.name).sort(),
      ['bland', 'deepgram', 'elevenlabs', 'mock', 'retell', 'synthflow', 'twilio', 'vapi'],
    )
    assert.deepEqual(allProviders.map((provider) => provider.name), ['mock', 'bland', 'vapi', 'retell', 'elevenlabs', 'synthflow'])
  })

  it('requires dial paths on every real platform', () => {
    for (const provider of allProviders.filter((p) => p.name !== 'mock')) {
      assert.ok(provider.dialPaths.length > 0, provider.name)
    }
  })
})

describe('transcripts', () => {
  it('splits labeled lines into turns', () => {
    assert.deepEqual(parseTranscript('Agent: Hi\nUser: Hello there\nand more'), [
      { role: 'agent', text: 'Hi' },
      { role: 'lead', text: 'Hello there and more' },
    ])
  })

  it('treats an unknown format as the lead speaking, so an opt-out is still seen', () => {
    assert.deepEqual(parseTranscript('please stop calling me'), [{ role: 'lead', text: 'please stop calling me' }])
  })
})

describe('simulator', () => {
  const script = 'Script:\n1. Are you still looking to get your roof looked at?\n   If no: thank them.\n2. Is anything leaking right now?\n3. What day works best?\n\nThen confirm the day.'
  const request = { firstLine: 'Hi, this is Ava, an AI assistant.', prompt: script, captureFields: ['still_interested', 'leak_now', 'best_day'] }

  it('asks the script\'s questions in order', () => {
    assert.deepEqual(questionsIn(script), ['Are you still looking to get your roof looked at?', 'Is anything leaking right now?', 'What day works best?'])
  })

  it('answers with what it captured, so the transcript and the findings agree', () => {
    const turns = transcriptFor('connected', request, { still_interested: 'Yes', leak_now: 'No', best_day: 'Saturday at 10' })
    assert.deepEqual(turns.filter((turn) => turn.role === 'lead').map((turn) => turn.text), ["Okay, what's this about?", 'Yeah, I am.', 'No.', 'Saturday at 10 works for me.'])
    assert.match(turns.at(-1)!.text, /Saturday at 10/)
    assert.ok(!turns.some((turn) => /Tuesday/.test(turn.text)))
  })

  it('falls back to a generic call when the script has no numbered questions', () => {
    const turns = transcriptFor('connected', { ...request, prompt: 'Follow the script.' }, { best_day: 'Thursday after 3' })
    assert.match(turns.at(-1)!.text, /Thursday after 3/)
  })
})

describe('.env file', () => {
  function tempSecrets() {
    const dir = mkdtempSync(join(tmpdir(), 'dialdesk-'))
    const envPath = join(dir, '.env')
    const examplePath = join(dir, '.env.example')
    writeFileSync(examplePath, '# A comment\nVAPI_API_KEY=\nLIVE_CALLS=off\n')
    const secrets = createSecrets(envPath, examplePath, ['VAPI_API_KEY', 'LIVE_CALLS', 'MY_PHONE'])
    return { secrets, envPath, cleanup: () => rmSync(dir, { recursive: true }) }
  }

  it('starts from the example, keeps comments and updates in place', () => {
    const { secrets, envPath, cleanup } = tempSecrets()
    secrets.set({ VAPI_API_KEY: 'abc123' })
    const text = readFileSync(envPath, 'utf8')
    assert.match(text, /# A comment/)
    assert.match(text, /^VAPI_API_KEY=abc123$/m)
    assert.equal(secrets.get('LIVE_CALLS'), 'off')
    cleanup()
  })

  it('reads a new value straight away, with no restart', () => {
    const { secrets, cleanup } = tempSecrets()
    assert.equal(secrets.has('VAPI_API_KEY'), false)
    secrets.set({ VAPI_API_KEY: 'abc123' })
    assert.equal(secrets.get('VAPI_API_KEY'), 'abc123')
    cleanup()
  })

  it('round-trips keys with awkward characters', () => {
    const { secrets, cleanup } = tempSecrets()
    for (const value of ['has#hash', 'has space', 'has$dollar', 'has"quote', "has'single", 'a=b=c', 'back\\slash']) {
      secrets.set({ VAPI_API_KEY: value })
      assert.equal(secrets.get('VAPI_API_KEY'), value)
    }
    cleanup()
  })

  it('refuses unknown names and line breaks', () => {
    const { secrets, cleanup } = tempSecrets()
    assert.throws(() => secrets.set({ NOT_ALLOWED: 'x' }))
    assert.throws(() => secrets.set({ VAPI_API_KEY: 'a\nLIVE_CALLS=on' }))
    cleanup()
  })

  it('redacts secrets from text', () => {
    assert.equal(redact('key abc123xyz failed', ['abc123xyz']), 'key [redacted] failed')
  })
})

describe('guard hook', () => {
  const run = (event: object) =>
    spawnSync(process.execPath, ['.claude/hooks/guard.mjs'], { input: JSON.stringify(event), encoding: 'utf8' })
  const bash = (command: string) => run({ tool_name: 'Bash', tool_input: { command } }).status

  it('blocks reading or changing .env from the shell', () => {
    for (const command of ['cat .env', 'type .env', 'grep KEY .env', 'cp .env /tmp/x', 'echo X=1 >> .env', 'node -e "fs.readFileSync(\'.env\')"', 'cat ./.env', 'printenv', 'env']) {
      assert.equal(bash(command), 2, command)
    }
  })

  it('allows .env.example and ordinary commands', () => {
    for (const command of ['cat .env.example', 'npm test', 'npm run api -- vapi GET /assistant', 'git status', 'node --env-file-if-exists=foo x.js']) {
      assert.equal(bash(command), 0, command)
    }
  })

  it('blocks direct calls to voice platforms', () => {
    for (const command of ['curl https://api.vapi.ai/call -d x', 'curl -X POST api.bland.ai/v1/calls', 'wget https://api.retellai.com/v2/create-phone-call']) {
      assert.equal(bash(command), 2, command)
    }
  })

  it('blocks the human-only endpoints from the shell', () => {
    assert.equal(bash('curl -X POST localhost:3000/api/go-live'), 2)
    assert.equal(bash('curl -X POST localhost:3000/api/secrets'), 2)
  })

  it('blocks the file tools on .env', () => {
    for (const tool_name of ['Read', 'Edit', 'Write']) {
      assert.equal(run({ tool_name, tool_input: { file_path: '/project/.env' } }).status, 2, tool_name)
      assert.equal(run({ tool_name, tool_input: { file_path: '/project/.env.example' } }).status, 0, tool_name)
    }
  })

  it('tells Claude what to do instead', () => {
    const result = run({ tool_name: 'Bash', tool_input: { command: 'curl https://api.vapi.ai/call' } })
    assert.match(result.stderr, /npm run api/)
  })
})
