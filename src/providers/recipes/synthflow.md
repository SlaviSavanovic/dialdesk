# Setting up Synthflow

**Key:** `SYNTHFLOW_API_KEY`, added by the user in the wizard.

**1. Find the agent.** Synthflow calls it a model or an assistant. The user may need to create one in the dashboard first:

```bash
npm run api -- synthflow GET "/v2/assistants?limit=20"
```

**2. Make sure it has a phone number attached.** Numbers can be listed from the API, and the agent's page in the dashboard shows which is attached.

**3. Save its ID:**

```bash
curl -X PUT localhost:3000/api/provider -H "Content-Type: application/json" -d '{"name":"synthflow","config":{"modelId":"THE_AGENT_ID"}}'
```

`fromNumber` is optional and must be a number attached to the agent.

**Watch out:**
- Synthflow's docs list no summary field. To add summaries, read the transcript and save one with `PATCH /api/calls/:id`.
- `src/providers/synthflow.ts` has a TODO. Check how `GET /v2/calls/{id}` nests its response on the first real call.

Docs: https://docs.synthflow.ai
