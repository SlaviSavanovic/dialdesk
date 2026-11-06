import { Chip, html, PageHead, phone, plural, Say, useLive, useState } from '/lib.js'

function place(lead) {
  if (lead.timezone) return lead.timezone.split('/').pop().replaceAll('_', ' ')
  return lead.state
}

export function Leads() {
  const [query, setQuery] = useState('')
  const { data } = useLive(`/api/leads${query ? `?q=${encodeURIComponent(query)}` : ''}`)

  return html`
    <div class="stack">
      <${PageHead} title="Leads" sub=${data ? plural(data.length, 'person') .replace('persons', 'people') : ' '}>
        <input
          class="search"
          type="search"
          placeholder="Search names, numbers, notes"
          aria-label="Search leads"
          value=${query}
          onInput=${(event) => setQuery(event.target.value)}
        />
      <//>

      <section class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Location</th>
                <th>Permission source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${(data ?? []).map(
                (lead) => html`
                  <tr>
                    <td class="nowrap">
                      ${lead.name}
                      ${lead.email && html`<span class="cell-sub">${lead.email}</span>`}
                    </td>
                    <td class="nowrap">
                      <span class="mono">${phone(lead.phone)}</span>
                      ${lead.onDnc && html`<div style="margin-top:3px"><${Chip} label="Do not call" tone="critical" /></div>`}
                    </td>
                    <td class="nowrap">
                      ${place(lead) ?? html`<${Chip} label="Unknown" tone="warning" />`}
                    </td>
                    <td class="secondary">
                      ${lead.consentSource ?? html`<span class="muted">Not recorded</span>`}
                      ${lead.consentDate && html`<span class="cell-sub">${lead.consentDate}</span>`}
                    </td>
                    <td class="secondary" style="min-width:180px">${lead.notes}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        ${data?.length === 0 && html`<div class="empty">${query ? 'Nobody matches that.' : 'No leads yet.'}</div>`}
      </section>

      <${Say} text="Import leads.csv and add them to my campaign." />
    </div>
  `
}
