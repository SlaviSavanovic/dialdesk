import { api, Chip, html, PageHead, Say, useLive, useState } from '/lib.js'

function KeyRow({ field }) {
  return html`
    <div class="row">
      <div class="row-main">
        <div class="row-title">${field.label}</div>
        <div class="row-sub mono">${field.env}</div>
      </div>
      ${field.set ? html`<${Chip} label="Key set" tone="good" />` : html`<${Chip} label="Not set" tone="warning" />`}
    </div>
  `
}

function Platform({ providers, status }) {
  const provider = providers.voice.find((candidate) => candidate.selected)
  if (!provider) {
    return html`
      <section class="card">
        <div class="card-head"><h2>Voice platform</h2><${Chip} label="Simulator only" /></div>
        <div class="card-body">
          <p class="secondary" style="margin-bottom:14px">
            No platform is connected, so every call is simulated. Connect one when you want real calls.
          </p>
          <a class="button" href="#/setup">Connect a platform</a>
        </div>
      </section>
    `
  }
  return html`
    <section class="card">
      <div class="card-head">
        <h2>${provider.label}</h2>
        ${provider.ready ? html`<${Chip} label="Ready" tone="good" />` : html`<${Chip} label="Setup not finished" tone="warning" />`}
      </div>
      <div class="rows">
        ${provider.keys.map((field) => html`<${KeyRow} field=${field} />`)}
        ${provider.config.map(
          (field) => html`
            <div class="row">
              <div class="row-main">
                <div class="row-title">${field.label}</div>
                <div class="row-sub">${field.value ? html`<span class="mono">${field.value}</span>` : field.required ? 'Claude can find or create this for you.' : 'Optional'}</div>
              </div>
              ${field.value ? html`<${Chip} label="Set" tone="good" />` : field.required ? html`<${Chip} label="Not set" tone="warning" />` : null}
            </div>
          `,
        )}
      </div>
      ${provider.missingConfig.length > 0 &&
      html`<div class="card-body" style="padding-top:14px;border-top:1px solid var(--line)">
        <${Say} text="Finish setting up ${provider.label}." />
      </div>`}
    </section>
  `
}

function TestCall({ status, provider }) {
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const call = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { call: placed } = await api('POST', '/api/test-call', {})
      location.hash = `#/calls/${placed.id}`
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const real = provider?.ready
  return html`
    <section class="card">
      <div class="card-head"><h2>Test call</h2></div>
      <div class="card-body">
        <p class="secondary" style="margin-bottom:14px">
          ${status.myPhone.set
            ? html`Rings your own number, ending <span class="mono">${status.myPhone.lastFour}</span>. It can't call anyone else.
                ${real ? ' This is a real call, even in dry run.' : ' With no platform ready, this one is simulated.'}`
            : 'Add your own number in setup first. It’s the only number a test call can ring.'}
        </p>
        ${message && html`<p class="result bad" style="margin:0 0 12px">${message}</p>`}
        ${status.myPhone.set
          ? html`<button class="button" disabled=${busy} onClick=${call}>${real ? 'Ring my phone' : 'Run a simulated test call'}</button>`
          : html`<a class="button" href="#/setup">Add my number</a>`}
      </div>
    </section>
  `
}

function Mode({ status }) {
  if (status.mode === 'live') {
    return html`
      <section class="card">
        <div class="card-head"><h2>Calling mode</h2><${Chip} label="Live" tone="critical" /></div>
        <div class="card-body">
          <p class="secondary" style="margin-bottom:14px">Campaigns ring real phones. Going back to dry run takes effect right away.</p>
          <button class="button" onClick=${() => api('POST', '/api/dry-run', {})}>Back to dry run</button>
        </div>
      </section>
    `
  }
  return html`
    <section class="card">
      <div class="card-head"><h2>Calling mode</h2><${Chip} label="Dry run" tone="warning" /></div>
      <div class="card-body">
        <p class="secondary" style="margin-bottom:14px">Campaigns run for real but every call is simulated, so you can see what would happen first.</p>
        <a class="button" href="#/go-live">Review and go live</a>
      </div>
    </section>
  `
}

export function Settings() {
  const { data: status } = useLive('/api/status')
  const { data: providers } = useLive('/api/providers')
  if (!status || !providers) return null

  const selected = providers.voice.find((candidate) => candidate.selected)
  return html`
    <div class="stack">
      <${PageHead} title="Settings" sub="Keys only show as set or not set. Their values never leave this computer's .env file except to reach the platform they belong to.">
        <a class="button" href="#/setup">Run setup again</a>
      <//>
      <div class="split">
        <div class="stack">
          <${Mode} status=${status} />
          <${TestCall} status=${status} provider=${selected} />
        </div>
        <div class="stack">
          <${Platform} providers=${providers} status=${status} />
          <section class="card">
            <div class="card-head"><h2>Optional services</h2></div>
            <div class="rows">
              ${providers.services.flatMap((service) =>
                service.keys.map((field) => html`<${KeyRow} field=${{ ...field, label: `${service.label} ${field.label}` }} />`),
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  `
}
