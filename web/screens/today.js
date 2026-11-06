import { CallRow, CampaignChip, duration, html, outcomeLabel, PageHead, plural, Say, scheduleText, useLive } from '/lib.js'

const OUTCOME_ORDER = ['connected', 'no_answer', 'voicemail', 'busy', 'opted_out', 'failed']

function Stats({ today }) {
  const rate = today.connectRate === null ? '–' : `${Math.round(today.connectRate * 100)}%`
  return html`
    <section class="card stats" aria-label="Today's numbers">
      <div class="stat stat-hero">
        <span class="stat-label">Calls today</span>
        <span class="stat-value">${today.calls.toLocaleString()}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Connect rate</span>
        <span class="stat-value">${rate}</span>
      </div>
      <div class="stat">
        <span class="stat-label">People reached</span>
        <span class="stat-value">${today.reached.toLocaleString()}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Average call</span>
        <span class="stat-value">${duration(today.averageSeconds)}</span>
      </div>
    </section>
  `
}

// A single measure across categories: one color, every value labeled at the bar's
// end, and the share revealed on hover. The list itself doubles as the table view.
function Outcomes({ today }) {
  const largest = Math.max(1, ...OUTCOME_ORDER.map((outcome) => today.outcomes[outcome]))
  return html`
    <section class="card">
      <div class="card-head"><h2>Outcomes today</h2></div>
      <div class="card-body">
        ${today.finished === 0
          ? html`<p class="muted" style="padding:6px 0 4px">Nothing to show until a call finishes.</p>`
          : html`
              <div class="bars">
                ${OUTCOME_ORDER.map((outcome) => {
                  const count = today.outcomes[outcome]
                  const share = Math.round((count / today.finished) * 100)
                  return html`
                    <div class="bar-row ${count === 0 ? 'zero' : ''}" title="${outcomeLabel(outcome)}: ${count} (${share}%)">
                      <span class="bar-label">${outcomeLabel(outcome)}</span>
                      <div class="bar-track">
                        <div class="bar-fill" style="width:${(count / largest) * 100}%"></div>
                      </div>
                      <span class="bar-value">
                        <span class="bar-count">${count}</span>
                        <span class="bar-share">${share}%</span>
                      </span>
                    </div>
                  `
                })}
              </div>
            `}
      </div>
    </section>
  `
}

export function CampaignCard({ campaign }) {
  const percent = campaign.leadCount > 0 ? (campaign.reachedCount / campaign.leadCount) * 100 : 0
  return html`
    <a class="campaign-card" href="#/campaigns/${campaign.id}">
      <div class="campaign-top">
        <span class="campaign-name">${campaign.name}</span>
        <${CampaignChip} status=${campaign.status} />
      </div>
      <div class="campaign-meta">
        ${plural(campaign.leadCount, 'lead')} · ${campaign.reachedCount} reached · ${plural(campaign.callCount, 'call')}
        <br />
        ${scheduleText(campaign)}
      </div>
      <div class="progress" role="img" aria-label="${campaign.reachedCount} of ${campaign.leadCount} reached">
        <div style="width:${percent}%"></div>
      </div>
      ${campaign.notice && html`<div class="notice error" style="margin-top:11px">${campaign.notice}</div>`}
    </a>
  `
}

function Campaigns({ campaigns }) {
  const shown = campaigns.filter((campaign) => campaign.status !== 'stopped').slice(0, 4)
  return html`
    <section class="card">
      <div class="card-head">
        <h2>Campaigns</h2>
        <a class="muted" href="#/campaigns" style="font-size:13.5px">See all</a>
      </div>
      ${shown.map((campaign) => html`<div style="border-top:1px solid var(--line)"><${CampaignCard} campaign=${campaign} /></div>`)}
    </section>
  `
}

function NextUp({ steps }) {
  if (steps.length === 0) return null
  return html`
    <section class="card">
      <div class="card-head"><h2>Still to do</h2></div>
      <div class="card-body">
        <ul style="margin:0 0 14px;padding-left:18px;color:var(--ink-2)">
          ${steps.map((step) => html`<li>${step}</li>`)}
        </ul>
        <${Say} text="What's left to set up?" />
      </div>
    </section>
  `
}

export function Today() {
  const { data } = useLive('/api/dashboard')
  const { data: status } = useLive('/api/status')
  if (!data) return null

  return html`
    <div class="stack">
      <${PageHead} title="Today" />
      <${Stats} today=${data.today} />
      ${data.live.length > 0 &&
      html`
        <section class="card">
          <div class="card-head"><h2>On the line now</h2></div>
          <div class="rows">${data.live.map((call) => html`<${CallRow} call=${call} />`)}</div>
        </section>
      `}
      <div class="split">
        <div class="stack">
          <${Outcomes} today=${data.today} />
          <${NextUp} steps=${status?.nextSteps ?? []} />
        </div>
        <div class="stack">
          <${Campaigns} campaigns=${data.campaigns} />
          <section class="card">
            <div class="card-head">
              <h2>Recent calls</h2>
              <a class="muted" href="#/calls" style="font-size:13.5px">See all</a>
            </div>
            ${data.recent.length === 0
              ? html`<div class="empty" style="border-top:1px solid var(--line)">
                  <p>No calls yet.</p>
                  <${Say} text="Start the example campaign." />
                </div>`
              : html`<div class="rows">${data.recent.map((call) => html`<${CallRow} call=${call} />`)}</div>`}
          </section>
        </div>
      </div>
    </div>
  `
}
