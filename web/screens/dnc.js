import { html, PageHead, phone, plural, Say, useLive, when } from '/lib.js'

const SOURCES = {
  opt_out: 'Asked on a call',
  manual: 'Added by you',
  import: 'Imported list',
  seed: 'Example data',
}

export function DoNotCall() {
  const { data } = useLive('/api/dnc')
  if (!data) return null
  return html`
    <div class="stack">
      <${PageHead}
        title="Do not call"
        sub=${`${plural(data.length, 'number')}. These never get called again, from any campaign.`}
      />
      <section class="card">
        ${data.length === 0
          ? html`<div class="empty">The list is empty.</div>`
          : html`
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>How it got here</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.map(
                      (entry) => html`
                        <tr>
                          <td class="nowrap mono">${phone(entry.phone)}</td>
                          <td class="secondary">
                            ${SOURCES[entry.source] ?? entry.source}
                            ${entry.reason && html`<span class="cell-sub">${entry.reason}</span>`}
                          </td>
                          <td class="nowrap secondary">${when(entry.addedAt)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `}
      </section>
      <${Say} text="Add these numbers to the do-not-call list." />
    </div>
  `
}
