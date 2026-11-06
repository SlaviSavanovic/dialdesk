import {
  api,
  CallRow,
  CampaignChip,
  html,
  LeadStateChip,
  PageHead,
  phone,
  plural,
  retryText,
  Say,
  scheduleText,
  useLive,
  useState,
  when,
} from '/lib.js'
import { CampaignCard } from '/screens/today.js'

export function Campaigns() {
  const { data } = useLive('/api/campaigns')
  if (!data) return null
  return html`
    <div class="stack">
      <${PageHead} title="Campaigns" sub="Who gets called, when, and with which agent." />
      ${data.length === 0
        ? html`<section class="card empty"><p>No campaigns yet.</p><${Say} text="Make a campaign for all my leads." /></section>`
        : html`<section class="card">
            ${data.map((campaign) => html`<${CampaignCard} campaign=${campaign} />`)}
          </section>`}
      ${data.length > 0 && html`<${Say} text="Make a new campaign for my Texas leads, weekdays only, three tries each." />`}
    </div>
  `
}

const TALLY = [
  ['ready', 'Up next'],
  ['calling', 'On the line'],
  ['waiting', 'Waiting'],
  ['reached', 'Reached'],
  ['done', 'Not calling'],
]

function Controls({ campaign, mode }) {
  const [error, setError] = useState(null)
  const act = async (action) => {
    setError(null)
    try {
      await api('POST', `/api/campaigns/${campaign.id}/${action}`, {})
    } catch (problem) {
      setError(problem.message)
    }
  }
  const start = () => {
    if (mode === 'live' && !confirm(`This will ring real phones, up to ${plural(campaign.leadCount, 'person').replace('persons', 'people')}. Start?`)) return
    act('start')
  }

  return html`
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${error && html`<span class="result bad" style="margin:0">${error}</span>`}
      ${campaign.status === 'running'
        ? html`<button class="button" onClick=${() => act('pause')}>Pause</button>`
        : html`<button class="button primary" disabled=${campaign.status === 'finished'} onClick=${start}>
            ${campaign.status === 'paused' ? 'Resume' : 'Start'}
          </button>`}
    </div>
  `
}

export function CampaignDetail({ id }) {
  const { data, error } = useLive(`/api/campaigns/${id}`)
  const { data: status } = useLive('/api/status')
  if (!data) return error ? html`<p class="muted">Couldn't find that campaign.</p>` : null
  const { campaign, agent, counts, leads, calls } = data

  return html`
    <div class="stack">
      <${PageHead}
        crumb=${{ href: '#/campaigns', label: 'Campaigns' }}
        title=${campaign.name}
        sub=${html`Using <a href="#/agents">${agent?.name ?? 'an agent that no longer exists'}</a>`}
      >
        <div style="display:flex;gap:12px;align-items:center">
          <${CampaignChip} status=${campaign.status} />
          <${Controls} campaign=${campaign} mode=${status?.mode} />
        </div>
      <//>

      ${campaign.notice && html`<div class="notice error">Paused because: ${campaign.notice}</div>`}

      <section class="card tally" aria-label="Where each lead stands">
        ${TALLY.map(
          ([state, label]) => html`
            <div>
              <div class="tally-value">${counts[state]}</div>
              <div class="tally-label">${label}</div>
            </div>
          `,
        )}
      </section>

      <section class="card">
        <div class="card-head"><h2>Rules for this campaign</h2></div>
        <div class="card-body">
          <dl class="facts">
            <dt>When</dt>
            <dd>${scheduleText(campaign)}</dd>
            <dt>Pace</dt>
            <dd>Up to ${campaign.maxPerHour} calls an hour, one at a time</dd>
            <dt>Retries</dt>
            <dd>${plural(campaign.maxAttempts, 'attempt')} per lead, at least ${retryText(campaign.retryDelayMinutes)} apart</dd>
          </dl>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Leads</h2></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Status</th>
                <th>Tries</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              ${leads.map(
                ({ lead, state, reason, retryAt, attempts }) => html`
                  <tr>
                    <td class="nowrap">
                      ${lead.name}
                      <span class="cell-sub mono">${phone(lead.phone)}</span>
                    </td>
                    <td class="nowrap"><${LeadStateChip} state=${state} /></td>
                    <td class="nowrap mono">${attempts}/${campaign.maxAttempts}</td>
                    <td class="secondary" style="min-width:170px">
                      ${reason ?? 'Next in line.'}
                      ${retryAt && html` Next try ${when(retryAt)}.`}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </section>

      ${calls.length > 0 &&
      html`
        <section class="card">
          <div class="card-head"><h2>Calls on this campaign</h2></div>
          <div class="rows">${calls.map((call) => html`<${CallRow} call=${call} />`)}</div>
        </section>
      `}
    </div>
  `
}
