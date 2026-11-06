# Map

## Modes

- **Beside the chat (default):** Claude drives, and the dashboard updates live in the browser pane over SSE.
- **App blind:** every action works over HTTP, and results come back to the chat as text. The server runs headless.
- **Claude blind:** deliberately small. A person can pause everything, start or pause a campaign, ring their own phone, run the setup wizard, and go live.

The core rule is that screens are for looking at, and input goes through Claude. There are two exceptions, the setup wizard and the Go live screen. API keys have to be typed somewhere that isn't the chat, and going live should take a person's own hands.

## Where things live

```
src/
  server.ts          Starts everything. Picks a port. Binds to this computer only.
  api.ts             Every HTTP route.
  views.ts           The read models behind the screens.
  scheduler.ts       The loop: read open calls, then dial the next lead.
  dial.ts            The only code that places calls.
  gate.ts            Decides if a lead may be called, and why not.
  timezones.ts       Lead location, local time, calling hours.
  script.ts          Builds the agent's instructions. Holds the house rules.
  optout.ts          Spots "stop calling me" in transcripts.
  leads.ts           CSV import, phone number cleanup, do-not-call import.
  secrets.ts         Reads and writes .env. Redacts secrets from text.
  context.ts         Shared dependencies. Decides dry run or live.
  store/             Storage interface, SQLite version, example data.
  providers/
    types.ts         The VoiceProvider interface.
    _template.ts     Copy this to add a platform.
    mock.ts          The simulator.
    bland.ts vapi.ts retell.ts elevenlabs.ts synthflow.ts
    twilio.ts deepgram.ts    Reachable by `npm run api`, never dialed through.
    recipes/         Per-platform setup guides for Claude.
cli/
  api.ts             `npm run api`: reach a platform without seeing its key.
  smoke.mjs          Boots the real server and checks it answers. CI uses it.
web/
  app.js lib.js      Shell, routing, live data, shared components.
  screens/           One file per screen.
  vendor/            Preact + htm and fonts, so nothing loads from the internet.
.claude/
  settings.json      Blocks Claude from .env.
  hooks/guard.mjs    Blocks .env access and direct platform calls from the shell.
  skills/dialdesk/   How to operate the app.
samples/leads.csv    20 fake leads for practice.
examples/            How to write a script.
data/                The database. Git ignores it.
.env                 Keys, MY_PHONE, LIVE_CALLS. Git ignores it. Off limits to Claude.
```

## Platform status

All five real adapters were written from the platforms' docs on 2026-11-02 and tested against responses built from those docs. **None has been run on a live call yet.** When one has, say so here.

| Platform | Live call tested | Still to confirm on a real call |
|---|---|---|
| Bland AI | No | `analysis` field contents |
| Vapi | No | Whether a voice has to be set on the transient assistant, or a default applies |
| Retell AI | No | Transcript line format and `transcript_object` roles |
| ElevenLabs | No | The API field that enables overrides, and how no-answer shows up |
| Synthflow | No | How the get-call response is nested |

## Watch out for

**Calling**
- **Dialing has one door on purpose.** If you add a way to reach a platform's call endpoint outside `dial.ts`, the do-not-call list and calling hours stop applying to it. New platform endpoints that place calls belong in that adapter's `dialPaths`.
- **The attempt is recorded before the API call.** Don't reorder this. A crash mid-dial then counts as an attempt rather than a redial.
- **A failed dial pauses the campaign** and puts the reason on its screen. Otherwise a bad key would use up an attempt on every lead within seconds.
- **Going live pauses running campaigns,** so a dry-run campaign can't start ringing real phones the moment it flips.
- **Opt-outs are found after the call ends,** when the transcript is read, because webhooks can't reach localhost. A number with an unread call can't be redialed, which closes that gap. The agent's instructions also tell it to end the call when asked.
- **Pause doesn't hang up.** Calls in progress finish, and nothing new starts.
- **Nothing runs while the laptop sleeps.** Missed windows are skipped on purpose, with no catch-up burst.

**Platforms**
- **Retell ignores the script unless its agent's prompt is exactly `{{dialdesk_prompt}}`.** It has no per-call prompt override.
- **ElevenLabs rejects calls until overrides are enabled on the agent,** and it can look like a silent failure.
- **Free Vapi numbers can't dial out.** Viewers who pick Vapi need a Twilio number before their first test call.
- **Twilio trial accounts only reach verified numbers.** Fine for a test call, not for real leads.

**Timezones and data**
- **States spanning two zones must be in hours in both.** Texas opens late and closes early as a result. An explicit `timezone` on a lead overrides this.
- **The do-not-call list is keyed by phone number,** and has no delete route on purpose. Re-importing a lead can't revive them.
- **Consent fields are records only.** Nothing reads them. Don't let an import invent them.
- **Simulated calls ask the script's numbered questions,** in order, and the lead's answers are the captured values, so the transcript and "What we found out" agree. A script with no numbered questions gets a generic call. After a restart, calls still ringing lose their script and get the generic call too.
- **Demo data can live apart from the real data.** `DIALDESK_DATA_DIR` and `DIALDESK_ENV_FILE` point a second copy at its own database and keys file, which is how the practice-run screenshots for a video were made without touching anyone's leads.

**Environment**
- **`.env` is read fresh on every use,** so keys work without a restart. It's created from `.env.example` the first time the wizard saves something.
- **Port 3000 is often taken.** The app checks by connecting, because binding can succeed even when another app holds the port on all interfaces. Use the port it prints.
- **`node:sqlite` prints an experimental warning.** `npm start` hides it with a flag. Run the code some other way and you'll see it.
- **The guard hook relies on `$CLAUDE_PROJECT_DIR` being expanded by the shell.** This hasn't been confirmed on Windows. The GitHub Actions run covers tests and boot on Windows, not the hook inside Claude Code.
- **The guard is a guardrail, not a lock.** It catches accidents and can be deleted by anyone who owns the machine.
