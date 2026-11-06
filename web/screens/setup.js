import { api, html, Logo, Say, useEffect, useLive, useState } from '/lib.js'

// The one place in dialdesk with real forms. Keys have to be typed somewhere, and
// here they go straight into .env without ever passing through the chat.

const PRACTICE = 'practice'
const REASONS = ['Follow up on form fills', 'Appointment reminders', 'Re-engage old leads', 'Collect feedback']

function PlatformStep({ providers, choice, setChoice }) {
  return html`
    <h1>Which voice platform do you use?</h1>
    <p class="wizard-lede">It handles the phone line and the voice. dialdesk decides who to call and when. Not sure? Start with practice mode.</p>
    <div class="choice-list" role="radiogroup" aria-label="Voice platform">
      ${providers.voice.map(
        (provider, index) => html`
          <button
            class="choice"
            role="radio"
            aria-checked=${choice === provider.name}
            onClick=${() => setChoice(provider.name)}
          >
            <span class="choice-title">
              ${provider.label} ${index === 0 && html`<span class="badge">Easiest start</span>`}
            </span>
            <span class="choice-note">${provider.blurb}</span>
          </button>
        `,
      )}
      <p class="choice-divider">Or try it with no account</p>
      <button class="choice" role="radio" aria-checked=${choice === PRACTICE} onClick=${() => setChoice(PRACTICE)}>
        <span class="choice-title">Practice mode</span>
        <span class="choice-note">Every call is simulated. You can connect a platform whenever you're ready.</span>
      </button>
    </div>
  `
}

function KeyField({ field, value, onChange, replacing, setReplacing }) {
  const id = `key-${field.env}`
  if (field.set && !replacing) {
    return html`
      <div class="field">
        <label>${field.label}</label>
        <div class="saved-key">
          <span>Saved</span>
          <button class="text-button" onClick=${() => setReplacing(true)}>Replace</button>
        </div>
      </div>
    `
  }
  return html`
    <div class="field">
      <label for=${id}>${field.label}</label>
      <input
        id=${id}
        type="password"
        autocomplete="off"
        spellcheck="false"
        value=${value}
        onInput=${(event) => onChange(event.target.value)}
      />
      <span class="field-help">
        ${field.help} <a href=${field.url} target="_blank" rel="noopener noreferrer">Open site ↗</a>
      </span>
    </div>
  `
}

function KeysStep({ provider, twilio, values, setValues, result }) {
  const [replacing, setReplacing] = useState({})
  const field = (entry) => html`
    <${KeyField}
      field=${entry}
      value=${values[entry.env] ?? ''}
      onChange=${(value) => setValues({ ...values, [entry.env]: value })}
      replacing=${replacing[entry.env]}
      setReplacing=${(on) => setReplacing({ ...replacing, [entry.env]: on })}
    />
  `
  const usesTwilio = ['vapi', 'retell', 'elevenlabs'].includes(provider.name)

  return html`
    <h1>Add your ${provider.label} key</h1>
    <p class="wizard-lede">This lets dialdesk place calls through your account.</p>
    <div class="reassure">Paste it here, not in the chat. It goes straight into a private file on this computer, and Claude never sees it.</div>
    ${provider.keys.map(field)}
    ${result && html`<p class="result ${result.ok ? 'good' : 'bad'}">${result.message}</p>`}
    ${usesTwilio &&
    html`
      <details class="more">
        <summary>Add Twilio too, so Claude can set up your phone number</summary>
        ${twilio.keys.map(field)}
      </details>
    `}
    ${provider.missingConfig.length > 0 &&
    html`<p class="field-help">Claude will find or create anything else ${provider.label} needs, like phone number and agent IDs, once you're back in the chat.</p>`}
  `
}

function BusinessStep({ answers, setAnswers }) {
  const set = (name) => (event) => setAnswers({ ...answers, [name]: event.target.value })
  return html`
    <h1>Tell me about the calls</h1>
    <p class="wizard-lede">Claude uses this to write your agent's script. You'll approve it before anything goes out.</p>

    <div class="field">
      <label for="business">Your business name</label>
      <input id="business" value=${answers.businessName} onInput=${set('businessName')} placeholder="Summit Roofing" />
    </div>
    <div class="field">
      <label for="caller">What should the agent call itself?</label>
      <input id="caller" value=${answers.callerName} onInput=${set('callerName')} placeholder="Ava" />
      <span class="field-help">It always says it's an AI. This is just its name.</span>
    </div>
    <div class="field">
      <label for="who">Who are you calling?</label>
      <input id="who" value=${answers.whoYouCall} onInput=${set('whoYouCall')} placeholder="Homeowners who asked for a quote on our site" />
    </div>
    <div class="field">
      <label for="why">Why are you calling them?</label>
      <div class="quick-picks">
        ${REASONS.map(
          (reason) => html`
            <button class="quick-pick" onClick=${() => setAnswers({ ...answers, callReason: reason })}>${reason}</button>
          `,
        )}
      </div>
      <input id="why" value=${answers.callReason} onInput=${set('callReason')} />
    </div>
    <div class="field">
      <label for="capture">What do you need to find out on each call?</label>
      <textarea
        id="capture"
        rows="3"
        placeholder="Most important first, one per line.
Are they still interested?
What day works best?"
        value=${answers.captureText}
        onInput=${set('captureText')}
      ></textarea>
    </div>
  `
}

function PhoneStep({ status, value, setValue, error }) {
  const [replacing, setReplacing] = useState(false)
  return html`
    <h1>What's your own phone number?</h1>
    <p class="wizard-lede">The test call rings this number so you can hear your agent. It's the only number the test button can reach.</p>
    ${status.myPhone.set && !replacing
      ? html`
          <div class="field">
            <label>Your number</label>
            <div class="saved-key">
              <span>Saved, ending <span class="mono">${status.myPhone.lastFour}</span></span>
              <button class="text-button" onClick=${() => setReplacing(true)}>Replace</button>
            </div>
          </div>
        `
      : html`
          <div class="field">
            <label for="myphone">Your number</label>
            <input id="myphone" type="tel" autocomplete="tel" value=${value} onInput=${(event) => setValue(event.target.value)} placeholder="(415) 555-0100" />
            <span class="field-help">Include the country code if you're outside the US, like +44 20 7946 0958.</span>
          </div>
        `}
    ${error && html`<p class="result bad">${error}</p>`}
  `
}

function DoneStep({ practice, onPractice }) {
  return html`
    <h1>You're set up</h1>
    <p class="wizard-lede">
      ${practice
        ? "You're in practice mode, so every call is simulated. Watch a campaign run, then head back to Claude."
        : 'No real calls go out until you turn on live calling yourself. Head back to Claude to write your script and try a test call.'}
    </p>
    <div class="stack">
      <${Say} text="Setup's done. Draft my script." />
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="button primary" onClick=${onPractice}>Run a practice campaign</button>
        <a class="button" href="#/">Go to the dashboard</a>
      </div>
    </div>
  `
}

export function Setup() {
  const { data: providers } = useLive('/api/providers')
  const { data: status } = useLive('/api/status')
  const { data: setup } = useLive('/api/setup')

  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState(null)
  const [keyValues, setKeyValues] = useState({})
  const [keyResult, setKeyResult] = useState(null)
  const [answers, setAnswers] = useState(null)
  const [myPhone, setMyPhone] = useState('')
  const [phoneError, setPhoneError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Pick up earlier answers once, so running setup again starts filled in.
  useEffect(() => {
    if (setup && !answers) {
      const { captureFields, ...rest } = setup.answers
      setAnswers({ ...rest, captureText: (captureFields ?? []).join('\n') })
    }
  }, [setup])

  useEffect(() => {
    if (providers && choice === null) {
      setChoice(providers.voice.find((provider) => provider.selected)?.name ?? null)
    }
  }, [providers])

  if (!providers || !status || !answers) return null

  const provider = providers.voice.find((candidate) => candidate.name === choice)
  const twilio = providers.services.find((service) => service.name === 'twilio')
  const practice = choice === PRACTICE

  const steps = practice ? ['platform', 'business', 'phone', 'done'] : ['platform', 'keys', 'business', 'phone', 'done']
  const current = steps[step]

  const saveAnswers = () => {
    const { captureText, ...rest } = answers
    const captureFields = captureText.split('\n').map((line) => line.trim()).filter(Boolean)
    return api('PUT', '/api/setup', { answers: { ...rest, captureFields } })
  }

  // Each step saves when you leave it, so closing the tab loses nothing.
  async function saveStep() {
    if (current === 'platform') {
      await api('PUT', '/api/provider', { name: practice ? null : choice })
    }
    if (current === 'keys') {
      const entered = Object.fromEntries(Object.entries(keyValues).filter(([, value]) => value.trim()))
      if (Object.keys(entered).length > 0) {
        await api('POST', '/api/secrets', { values: entered })
        setKeyValues({})
      }
      // A failed check stops you once. Pressing on means you know better than the
      // check, for example when the platform itself is having a bad day.
      const alreadyWarned = keyResult && !keyResult.ok && Object.keys(entered).length === 0
      if (!alreadyWarned && provider.keys.every((key) => key.set || entered[key.env])) {
        const result = await api('POST', `/api/providers/${provider.name}/check`, {})
        if (!result.ok) {
          setKeyResult(result)
          return false
        }
      }
      setKeyResult(null)
    }
    if (current === 'business') await saveAnswers()
    if (current === 'phone') {
      setPhoneError(null)
      if (myPhone.trim()) await api('POST', '/api/secrets', { values: { MY_PHONE: myPhone } })
      await api('PUT', '/api/setup', { complete: true })
    }
    return true
  }

  async function next() {
    setBusy(true)
    try {
      if (await saveStep()) {
        setStep(step + 1)
        scrollTo(0, 0)
      }
    } catch (error) {
      if (current === 'phone') setPhoneError(error.message)
      else setKeyResult({ ok: false, message: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function runPractice() {
    await api('POST', '/api/practice', {})
    location.hash = '#/'
  }

  function skip() {
    sessionStorage.setItem('setup-skipped', '1')
    location.hash = '#/'
  }

  const canContinue = current !== 'platform' || choice !== null
  const hasEnteredKey = Object.values(keyValues).some((value) => value.trim())
  const keySaved = provider?.keys.every((key) => key.set)
  let nextLabel = 'Continue'
  if (current === 'keys') {
    if (hasEnteredKey) nextLabel = 'Save and check'
    else if (keyResult && !keyResult.ok) nextLabel = 'Continue anyway'
    else if (!keySaved) nextLabel = 'Skip for now'
  }
  if (current === 'phone' && !myPhone.trim() && !status.myPhone.set) nextLabel = 'Skip for now'

  return html`
    <div class="wizard">
      <div class="wizard-top">
        <span class="brand"><${Logo} /> dialdesk</span>
        ${current !== 'done' && html`<button class="text-button" onClick=${skip}>Skip setup</button>`}
      </div>
      <div class="wizard-body">
        <div class="wizard-progress" role="img" aria-label="Step ${step + 1} of ${steps.length}">
          ${steps.map((_, index) => html`<span class=${index <= step ? 'done' : ''}></span>`)}
        </div>

        ${current === 'platform' && html`<${PlatformStep} providers=${providers} choice=${choice} setChoice=${setChoice} />`}
        ${current === 'keys' &&
        html`<${KeysStep} provider=${provider} twilio=${twilio} values=${keyValues} setValues=${setKeyValues} result=${keyResult} />`}
        ${current === 'business' && html`<${BusinessStep} answers=${answers} setAnswers=${setAnswers} />`}
        ${current === 'phone' && html`<${PhoneStep} status=${status} value=${myPhone} setValue=${setMyPhone} error=${phoneError} />`}
        ${current === 'done' && html`<${DoneStep} practice=${practice} onPractice=${runPractice} />`}

        ${current !== 'done' &&
        html`
          <div class="wizard-nav">
            ${step > 0
              ? html`<button class="text-button" onClick=${() => setStep(step - 1)}>Back</button>`
              : html`<span></span>`}
            <button class="button primary" disabled=${!canContinue || busy} onClick=${next}>
              ${busy ? 'One moment' : nextLabel}
            </button>
          </div>
        `}
      </div>
    </div>
  `
}
