import { CallChip, CallRow, duration, html, PageHead, phone, Say, useLive, when } from '/lib.js'

export function Calls() {
  const { data } = useLive('/api/calls?limit=200')
  if (!data) return null
  return html`
    <div class="stack">
      <${PageHead} title="Calls" sub="Every call, with what was said and what it found out." />
      <section class="card">
        ${data.length === 0
          ? html`<div class="empty"><p>No calls yet.</p><${Say} text="Start the example campaign." /></div>`
          : html`<div class="rows calls-list">${data.map((call) => html`<${CallRow} call=${call} />`)}</div>`}
      </section>
    </div>
  `
}

const prettyField = (name) => name.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())

function Transcript({ turns }) {
  return html`
    <div class="transcript">
      ${turns.map(
        (turn) => html`
          <div class="turn ${turn.role}">
            <span class="turn-who">${turn.role === 'lead' ? 'Them' : 'Agent'}</span>
            ${turn.text}
          </div>
        `,
      )}
    </div>
  `
}

export function CallDetail({ id }) {
  const { data: call, error } = useLive(`/api/calls/${id}`)
  if (!call) return error ? html`<p class="muted">Couldn't find that call.</p>` : null

  const captured = Object.entries(call.captured)
  return html`
    <div class="stack">
      <${PageHead}
        crumb=${{ href: '#/calls', label: 'Calls' }}
        title=${call.leadName}
        sub=${html`<span class="mono">${phone(call.phone)}</span> · ${when(call.startedAt)}`}
      >
        <${CallChip} call=${call} />
      <//>

      ${call.error && html`<div class="notice error">${call.error}</div>`}

      <div class="split">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>Details</h2></div>
            <div class="card-body">
              <dl class="facts">
                <dt>Length</dt>
                <dd class="mono">${duration(call.durationSec)}</dd>
                <dt>Type</dt>
                <dd>${call.kind === 'test' ? 'Test call' : 'Campaign call'}, ${call.mode === 'live' ? 'real' : 'simulated'}</dd>
                <dt>Placed with</dt>
                <dd>${call.provider === 'mock' ? 'Simulator' : call.provider}</dd>
                ${call.campaignId &&
                html`<dt>Campaign</dt>
                  <dd><a href="#/campaigns/${call.campaignId}">View campaign</a></dd>`}
              </dl>
            </div>
          </section>

          ${call.summary &&
          html`
            <section class="card">
              <div class="card-head"><h2>Summary</h2></div>
              <div class="card-body secondary">${call.summary}</div>
            </section>
          `}

          ${captured.length > 0 &&
          html`
            <section class="card">
              <div class="card-head"><h2>What we found out</h2></div>
              <div class="card-body">
                <dl class="facts">
                  ${captured.map(
                    ([name, value]) => html`
                      <dt>${prettyField(name)}</dt>
                      <dd>${typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                    `,
                  )}
                </dl>
              </div>
            </section>
          `}
        </div>

        <section class="card">
          <div class="card-head"><h2>Transcript</h2></div>
          <div class="card-body">
            ${call.turns.length > 0
              ? html`<${Transcript} turns=${call.turns} />`
              : html`<p class="muted">${call.status === 'ended' ? 'Nothing was said on this call.' : 'The transcript appears when the call ends.'}</p>`}
          </div>
        </section>
      </div>
    </div>
  `
}
