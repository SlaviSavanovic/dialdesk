# dialdesk

A local AI calling app. You operate it for the user and change its code when they ask. New here? `MAP.md` has the tour, and `ONBOARDING.md` is the setup script.

## Rules

**Secrets**
- Never ask the user to paste a key into the chat. Keys go in the setup wizard in the browser.
- Never read, print, or commit `.env`. Refer to keys by name only. `GET /api/status` and `GET /api/providers` show which are set.
- Reach platforms with `npm run api`, which adds the key and redacts it. To send a saved key to a platform, write `{{env:NAME}}` in the data.

**Live calls**
- Anything that would ring a real phone needs the user's explicit OK in this conversation, every time. That means test calls with a real platform, and starting a campaign while live.
- Going live is for the user alone, on the Go live screen. Don't try to do it for them.
- Never place a call any way other than through the app. `src/dial.ts` is the only code that calls `placeCall`. Don't add another path, and don't call a platform's dial endpoint directly.

**Guardrails: never disable these**

Never disable or weaken these checks: the do-not-call list, opt-out detection, calling hours, attempt limits, the AI disclosure, dry run. If the user wants one changed, explain what it's for. If they still want it, it's their code and their call, so make the change they asked for and tell them plainly what it does. Don't quietly work around one to make something else function.

**Consent**

dialdesk doesn't check permission to call, and this is deliberate: that's the user's responsibility. `consentSource` and `consentDate` are their own records. Never make up values for them. If they ask what the rules are, share what the README says and suggest a lawyer. You aren't giving legal advice.

**Don't guess at APIs.** Read the platform's current docs before writing or changing an adapter. If the docs don't settle something, leave a marked TODO.

## Running it

```bash
npm start
```

Runs at http://localhost:3000, or the next free port, which it prints.

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run api -- <platform> <METHOD> <path>
```

There's no build step. Node runs the TypeScript directly, which means `import type` for types, `.ts` in import paths, and no enums.

## How it works

The user talks to you, you call the local HTTP API, and the dashboard updates live over `/events`.

- **The gate** (`src/gate.ts`) is a pure function that decides if a lead may be called. Every reason it gives is shown to the user as written.
- **The dialer** (`src/dial.ts`) runs the gate, writes the attempt to the database, then places the call. The write comes first so that a crash can never cause a double dial.
- **The scheduler** (`src/scheduler.ts`) ticks every 2 seconds. It reads open calls first, then dials, so an opt-out always counts before the next call goes out.
- **Providers** (`src/providers/`) only do two things at run time: place a call and fetch the result. Every other platform feature is set up by you, with `npm run api`. Adding a platform means adding one file, starting from `_template.ts`.
- **Storage** sits behind the `Store` interface in `src/store/types.ts`. Nothing outside `src/store` knows it's SQLite.

## Changing it

- Most requests are operating the app, not changing it. The skill in `.claude/skills/dialdesk/SKILL.md` covers those.
- Screens are read-only on purpose. Don't add forms for things you can do through the API. The exceptions are the setup wizard and the Go live screen, because those have to be the person's own hands.
- Everything the app does has to be reachable by HTTP or CLI, apart from those two.
- Every screen should look like a finished product. Assume it ends up in a video.
- Keep `MAP.md` and the skill current when you change things.
- Run the tests before calling anything done.
