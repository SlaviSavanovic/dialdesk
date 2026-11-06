import { render } from '/vendor/preact-htm.js'
import { api, html, Logo, Offline, useEffect, useLive, useState } from '/lib.js'
import { Agents } from '/screens/agents.js'
import { CallDetail, Calls } from '/screens/calls.js'
import { CampaignDetail, Campaigns } from '/screens/campaigns.js'
import { DoNotCall } from '/screens/dnc.js'
import { GoLive } from '/screens/golive.js'
import { Leads } from '/screens/leads.js'
import { Settings } from '/screens/settings.js'
import { Setup } from '/screens/setup.js'
import { Today } from '/screens/today.js'

const NAV = [
  ['#/', 'Today'],
  ['#/campaigns', 'Campaigns'],
  ['#/leads', 'Leads'],
  ['#/calls', 'Calls'],
  ['#/agents', 'Agents'],
  ['#/dnc', 'Do not call'],
  ['#/settings', 'Settings'],
]

function useRoute() {
  const [route, setRoute] = useState(location.hash || '#/')
  useEffect(() => {
    const update = () => setRoute(location.hash || '#/')
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  return route
}

function screenFor(route) {
  const [, section, id] = route.split('/')
  switch (section) {
    case 'campaigns':
      return id ? html`<${CampaignDetail} id=${id} />` : html`<${Campaigns} />`
    case 'leads':
      return html`<${Leads} />`
    case 'calls':
      return id ? html`<${CallDetail} id=${id} />` : html`<${Calls} />`
    case 'agents':
      return html`<${Agents} />`
    case 'dnc':
      return html`<${DoNotCall} />`
    case 'settings':
      return html`<${Settings} />`
    case 'go-live':
      return html`<${GoLive} />`
    default:
      return html`<${Today} />`
  }
}

function ModeBand({ status }) {
  if (status.mode === 'live') {
    return html`<div class="mode-band live" role="status">
      Live. Campaigns ring real phones.<a href="#/settings">Settings</a>
    </div>`
  }
  return html`<div class="mode-band dry" role="status">
    Dry run. Every campaign call is simulated and no phone rings.
    ${status.provider?.ready && html`<a href="#/go-live">Go live</a>`}
  </div>`
}

function PauseAll({ dashboard }) {
  const running = dashboard?.active.length ?? 0
  if (running === 0) return null
  return html`
    <button class="button small pause" onClick=${() => api('POST', '/api/pause-all', {})}>Pause all</button>
  `
}

function App() {
  const route = useRoute()
  const status = useLive('/api/status')
  const dashboard = useLive('/api/dashboard')

  // A fresh install starts in the wizard. Skipping it leaves the rest of the app open.
  useEffect(() => {
    if (status.data && !status.data.setupComplete && !sessionStorage.getItem('setup-skipped') && route === '#/') {
      location.hash = '#/setup'
    }
  }, [status.data?.setupComplete])

  if (route.startsWith('#/setup')) return html`<${Setup} />`
  if (!status.data) return html`<${Offline} error=${status.error} />`

  const section = route.split('/')[1] ?? ''
  const isCurrent = (href) => href.split('/')[1] === section

  return html`
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="#/"><${Logo} /> dialdesk</a>
        <nav class="nav" aria-label="Main">
          ${NAV.map(
            ([href, label]) =>
              html`<a href=${href} aria-current=${isCurrent(href) ? 'page' : undefined}>${label}</a>`,
          )}
        </nav>
        <div class="topbar-actions"><${PauseAll} dashboard=${dashboard.data} /></div>
      </div>
      <${ModeBand} status=${status.data} />
    </header>
    <main class="page">${screenFor(route)}</main>
    <${Offline} error=${status.error} />
  `
}

render(html`<${App} />`, document.getElementById('app'))
