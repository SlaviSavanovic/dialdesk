import { api, Chip, html, PageHead, useLive, useState } from '/lib.js'

// Going live can only happen here, in the browser, by a person. The server
// refuses this request from the command line.

const YOUR_CALL = [
  {
    title: 'You have permission to call these people',
    note: "dialdesk doesn't check this. Getting consent and following the rules where you and your leads are located is on you.",
  },
  {
    title: "You've heard the agent on a real test call",
    note: 'Ring your own phone from Settings and listen to how it sounds.',
  },
  {
    title: 'You know what happens when someone says stop',
    note: 'They go on the do-not-call list right after the call, and no campaign can reach them again.',
  },
  {
    title: "You've checked the calling hours",
    note: "Campaigns default to 9 AM to 8 PM in each lead's local time. Some places are stricter, and it's easy to tighten.",
  },
  {
    title: 'You accept the costs',
    note: 'Your voice platform bills you for every minute. dialdesk has no spending limit of its own.',
  },
]

export function GoLive() {
  const { data: status } = useLive('/api/status')
  const { data: agents } = useLive('/api/agents')
  const [checked, setChecked] = useState({})
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState(null)

  if (!status || !agents) return null

  const crumb = { href: '#/settings', label: 'Settings' }
  if (status.mode === 'live') {
    return html`
      <div class="stack">
        <${PageHead} crumb=${crumb} title="You're live" sub="Campaigns ring real phones. Nothing starts until you or Claude starts a campaign." />
      </div>
    `
  }

  const platformReady = Boolean(status.provider?.ready)
  const hasAgent = agents.length > 0
  const allChecked = YOUR_CALL.every((_, index) => checked[index])
  const canGo = platformReady && hasAgent && allChecked && phrase.trim() === 'GO LIVE'

  const goLive = async () => {
    setError(null)
    try {
      await api('POST', '/api/go-live', { confirm: phrase.trim() })
      location.hash = '#/'
    } catch (problem) {
      setError(problem.message)
    }
  }

  return html`
    <div class="stack" style="max-width:680px">
      <${PageHead} crumb=${crumb} title="Go live" sub="After this, campaigns ring real phones. Any campaign running now gets paused, so nothing rings until you start it again." />

      <section class="card">
        <div class="card-head"><h2>What dialdesk can check</h2></div>
        <div class="rows">
          <div class="row">
            <div class="row-main">
              <div class="row-title">Voice platform connected</div>
              <div class="row-sub">${status.provider ? status.provider.label : 'None chosen yet'}${status.provider && !platformReady ? ', setup not finished' : ''}</div>
            </div>
            ${platformReady ? html`<${Chip} label="Ready" tone="good" />` : html`<${Chip} label="Not ready" tone="warning" />`}
          </div>
          <div class="row">
            <div class="row-main">
              <div class="row-title">An agent that says it's an AI</div>
              <div class="row-sub">Every call opens with the AI disclosure. The app won't dial without it.</div>
            </div>
            ${hasAgent ? html`<${Chip} label="Ready" tone="good" />` : html`<${Chip} label="No agent yet" tone="warning" />`}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>What only you can confirm</h2></div>
        <div class="card-body">
          <div class="checks">
            ${YOUR_CALL.map(
              (item, index) => html`
                <label class="check">
                  <input
                    type="checkbox"
                    checked=${Boolean(checked[index])}
                    onChange=${(event) => setChecked({ ...checked, [index]: event.target.checked })}
                  />
                  <div>
                    <strong>${item.title}</strong>
                    <span>${item.note}</span>
                  </div>
                </label>
              `,
            )}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-body" style="padding-top:18px">
          <div class="field" style="margin-bottom:12px">
            <label for="phrase">Type GO LIVE to confirm</label>
            <input
              id="phrase"
              autocomplete="off"
              value=${phrase}
              onInput=${(event) => setPhrase(event.target.value)}
              style="max-width:240px"
            />
          </div>
          ${error && html`<p class="result bad" style="margin:0 0 12px">${error}</p>`}
          <button class="button danger" disabled=${!canGo} onClick=${goLive}>Turn on live calling</button>
          <p class="field-help" style="margin-top:14px">dialdesk is software, not legal advice. The README explains what it does and doesn't handle.</p>
        </div>
      </section>
    </div>
  `
}
