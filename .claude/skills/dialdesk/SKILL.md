---
name: dialdesk
description: Operate the dialdesk calling app. Use whenever the user wants to add or import leads, write or change a call script, create, start or pause a campaign, ask how calls are going, read transcripts, see why someone wasn't called, add to the do-not-call list, or try a test call.
---

# Operating dialdesk

The app answers at `http://localhost:3000`, or the port it printed at startup. Everything below is plain HTTP, so use `curl`. If it doesn't answer, start it with `npm start` in the background. Tell the user what happened in plain words, and let them watch the dashboard rather than reading out JSON.

Anything that would ring a real phone needs a clear yes from the user first.

## "How's it going?" / "What's left?"

- `GET /api/dashboard` has today's numbers, active campaigns, live calls, and recent calls.
- `GET /api/status` has dry run or live, what's connected, and `nextSteps` listing what's left to set up.

## "Add these leads" / "Import this list"

Look at the file first, and map its columns to `name, phone, email, timezone, state, consent_source, consent_date, notes`. Then:

```bash
curl -X POST "localhost:3000/api/leads/import?campaignId=1" -H "Content-Type: text/csv" --data-binary @leads.csv
```

`campaignId` is optional. The response lists rows it skipped and why, plus any columns it didn't recognize. Tell the user about both.

- A lead with neither a state nor a timezone never gets called. Offer to help fill those in.
- Never make up `consent_source` or `consent_date`. Leave them blank if they aren't in the data.
- One lead: `POST /api/leads` with `{"name", "phone", "state", ...}`. Change one: `PATCH /api/leads/:id`. Remove one: `DELETE /api/leads/:id`. Search: `GET /api/leads?q=maya`.

## "Write me a script" / "Change what it says"

Follow the funnel in `examples/script-example.md`: most important question first, one per turn, short lines. Show the draft and get approval before saving.

```bash
curl -X POST localhost:3000/api/agents -H "Content-Type: application/json" -d '{"name":"Quote follow-up","businessName":"Summit Roofing","callerName":"Ava","goal":"Find out if they still want a quote","script":"1. Are you still looking...","captureFields":["still_interested","best_day"]}'
```

- Leave out `firstLine` and the AI disclosure line gets added for you. If you set your own, it must include the word "AI" in capitals, or the server refuses it.
- The script doesn't need interruption handling or opt-out handling. Those get added to every agent.
- Change one with `PATCH /api/agents/:id`. See the exact instructions a platform gets with `GET /api/agents/:id`.

## "Call these people" / "Set up a campaign"

```bash
curl -X POST localhost:3000/api/campaigns -H "Content-Type: application/json" -d '{"name":"October quotes","agentId":2,"allLeads":true,"days":[1,2,3,4,5],"windowStart":"09:00","windowEnd":"17:00","maxPerHour":30,"maxAttempts":3,"retryDelayMinutes":1440}'
```

Use `leadIds` instead of `allLeads` for a subset. Days run from 0 (Sunday) to 6 (Saturday). Times are in each lead's local time, and can't go outside 08:00 to 21:00.

- Start: `POST /api/campaigns/:id/start`. If live calling is on, the server stops you. Get the user's yes, then resend with `{"confirmLive": true}`.
- Pause, stop: `POST /api/campaigns/:id/pause`, `/stop`.
- **Stop everything:** `POST /api/pause-all`. Calls in progress finish.
- Change one: `PATCH /api/campaigns/:id`, and `addLeadIds` or `removeLeadIds` work there too.

## "Why wasn't Sam called?"

`GET /api/campaigns/:id` lists every lead with its `state` and a `reason` written for the user. Read them that reason. The usual fixes:

- `no_timezone`: add a `state` or `timezone` to the lead.
- `outside_hours`: it opens later, or the campaign's window or days could change.
- `retry_gap`: `retryAt` says when.
- `dnc`: they asked not to be called. Don't try to get around this.

A campaign paused by itself has a `notice` saying why, usually a platform refusing a call.

## "What did they say?" / "Who's interested?"

- `GET /api/calls?campaignId=1` lists calls. `GET /api/calls/:id` has the transcript as `turns`, the `summary`, and `captured`.
- Answer questions by reading the transcripts, such as "who wants a follow-up this week?"
- If a platform didn't provide a summary or captured info, work it out from the transcript and save it: `PATCH /api/calls/:id` with `{"summary", "captured"}`.

## "Don't call this person" / "Add this list"

- One: `POST /api/dnc` with `{"phone": "...", "reason": "..."}`.
- A list: `POST /api/dnc` with `{"list": "<one number per line, or CSV text>"}`.
- There's no way to remove a number through the API, on purpose.

## "Try it on my phone"

Ask first, because with a platform connected it's a real call. `POST /api/test-call` with `{}`, or `{"agentId": 2}`. It can only ring the number the user saved in the wizard, up to 5 a day. Then read the call with `GET /api/calls/:id`.

## Setting up a platform

Use `src/providers/recipes/<platform>.md` and `npm run api -- <platform> <METHOD> <path>`. Save IDs with `PUT /api/provider` and `{"name":"vapi","config":{"phoneNumberId":"..."}}`. Add a new platform by copying `src/providers/_template.ts`.

## Clearing out the example data

Stop the example campaign, then `DELETE /api/campaigns/:id`, `DELETE /api/agents/:id`, and `DELETE /api/leads/:id` for each example lead. Call history stays.
