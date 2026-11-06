# Onboarding

You're setting dialdesk up for someone, probably not a developer. Go one step at a time and say what you're about to do. Read `CLAUDE.md` first, because its rules apply throughout.

## 1. Get it running

Check for Node 22.18 or newer, and help them install it if it's missing. Run `npm install`, then start the app and open it in the browser pane beside the chat, using `preview_start` with the `dialdesk` config if you have it. Otherwise run `npm start` in the background and give them the address it prints. Port 3000 might be taken, so use whatever port it printed in place of 3000 everywhere below.

## 2. Hand them the wizard

A fresh install opens on the setup wizard. Tell them to fill it in, and to paste their API key there and **not in the chat**. It asks which platform they use, their key, a few questions about their calls, and their own phone number. Practice mode needs no account.

Wait for them to say they're done. Then read what they entered:

```bash
curl localhost:3000/api/setup
```

```bash
curl localhost:3000/api/status
```

`nextSteps` in the status lists what's still missing, and it's your guide from here on. Ask in chat about anything the wizard skipped.

## 3. Write the script

Draft it from their answers using the information funnel in `examples/script-example.md`. Show it in the chat and get their approval, then create the agent with `POST /api/agents`. Leave out `firstLine` and the AI disclosure gets added for you. Put what they need to find out in `captureFields`.

The example agent and campaign are in the app to look at. Use the skill in `.claude/skills/dialdesk/SKILL.md` for the details of operating it.

## 4. Practice

Import the fake leads and run a campaign in dry run, so they can watch it work. The numbers are fictional and nothing rings.

```bash
curl -X POST localhost:3000/api/leads/import -H "Content-Type: text/csv" --data-binary @samples/leads.csv
```

Create a campaign with their new agent and start it. Point out on the dashboard who got called and who didn't, and why. The campaign screen gives a reason for every lead.

## 5. Finish connecting their platform

Skip this if they're in practice mode. Read `src/providers/recipes/<platform>.md` and follow it, using `npm run api` to reach the platform. **Check the platform's current docs as you go.** Those APIs change, and if an adapter has drifted, fix `src/providers/<platform>.ts` and tell them. Anything that costs money, like buying a number, needs a clear yes first.

## 6. Ring their phone

Ask first. Then:

```bash
curl -X POST localhost:3000/api/test-call -H "Content-Type: application/json" -d '{}'
```

It can only reach the number they entered in the wizard. Afterwards, ask how it sounded and fix what they didn't like. Read the result with `GET /api/calls/:id`. This is the first time this platform's adapter may have run for real, so if the results look wrong, read the raw response with `npm run api` and fix the adapter.

## 7. Bring in their real leads

Clear out the example data if they want to, then import their list. Map their columns to `name, phone, email, timezone, state, consent_source, consent_date, notes`. Tell them which rows got skipped and why.

**Don't fill in consent fields their data doesn't have.** Leave them blank.

Mention that any lead with no state or timezone won't get called, and offer to help fill those in.

## 8. Going live

Walk them through the Go live screen at `#/go-live`, and be straightforward about these two things:

- Whether they have permission to call these people is their responsibility, and the app doesn't check. The README has a starting point, and a lawyer can answer what applies to them.
- Their platform bills them per minute, and the app has no spending limit.

**They have to go live themselves, in the browser.** You can't do it for them, and the server refuses if you try.

Once they're live, get a clear yes before starting any campaign. The server asks you to resend with `{"confirmLive": true}`, and it's only OK to do that after they've said yes.

Finish by telling them how to run it next time, and that they can ask you for anything from here.
