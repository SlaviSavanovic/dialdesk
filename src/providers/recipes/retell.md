# Setting up Retell AI

**Key:** `RETELL_API_KEY`, added by the user in the wizard.

Retell can't replace an agent's prompt per call. It can fill in variables, though, so the agent's whole prompt on Retell is one variable, and dialdesk fills it on each call. Without this the agent ignores your script.

**1. Create the language model with that one-variable prompt.** Save this as `llm.json`:

```json
{ "general_prompt": "{{dialdesk_prompt}}" }
```

```bash
npm run api -- retell POST /create-retell-llm --data @llm.json
```

**2. Create an agent that uses it.** Take the `llm_id` from the last step and pick a voice with the user. Confirm the fields against the docs first:

```bash
npm run api -- retell GET /list-voices
npm run api -- retell POST /create-agent --data '{"response_engine":{"type":"retell-llm","llm_id":"THE_LLM_ID"},"voice_id":"THE_VOICE_ID","agent_name":"dialdesk"}'
```

**3. Find or buy a number:**

```bash
npm run api -- retell GET /list-phone-numbers
```

Buying one costs money, so ask the user first. See `POST /create-phone-number` in the docs.

**4. Save both:**

```bash
curl -X PUT localhost:3000/api/provider -H "Content-Type: application/json" -d '{"name":"retell","config":{"fromNumber":"+14155550100","agentId":"THE_AGENT_ID"}}'
```

**To capture fields,** add them as `post_call_analysis_data` on the agent. Retell returns them, and they show up on the call. Check the docs for the current shape.

Docs: https://docs.retellai.com
