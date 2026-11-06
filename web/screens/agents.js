import { html, PageHead, Say, useLive } from '/lib.js'

function AgentCard({ agent }) {
  return html`
    <section class="card">
      <div class="card-head">
        <h2 style="font-size:16px">${agent.name}</h2>
        <span class="muted" style="font-size:13.5px">${agent.callerName}, for ${agent.businessName}</span>
      </div>
      <div class="card-body stack">
        <div>
          <div class="section-label">Goal</div>
          <div>${agent.goal}</div>
        </div>
        <div>
          <div class="section-label">Always opens with</div>
          <div class="first-line">${agent.firstLine}</div>
        </div>
        <div>
          <div class="section-label">Script</div>
          <pre class="script">${agent.script}</pre>
        </div>
        ${agent.captureFields.length > 0 &&
        html`
          <div>
            <div class="section-label">Tries to find out</div>
            <div class="tags">${agent.captureFields.map((field) => html`<span class="tag">${field}</span>`)}</div>
          </div>
        `}
      </div>
    </section>
  `
}

export function Agents() {
  const { data } = useLive('/api/agents')
  if (!data) return null
  return html`
    <div class="stack">
      <${PageHead} title="Agents" sub="Who's calling and what they say. Claude writes and edits these with you." />
      ${data.map((agent) => html`<${AgentCard} agent=${agent} />`)}
      ${data.length === 0 && html`<section class="card empty"><p>No agents yet.</p></section>`}
      <${Say} text="Make the script shorter and ask about budget first." />
    </div>
  `
}
