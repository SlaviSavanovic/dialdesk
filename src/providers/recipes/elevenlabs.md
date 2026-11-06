# Setting up ElevenLabs

**Key:** `ELEVENLABS_API_KEY`, added by the user in the wizard.

**Per-call overrides are off by default, and dialdesk depends on them.** If they aren't enabled the call gets rejected, which can look like a call that silently fails. Do step 2 before the first test call.

**1. Find or create an agent:**

```bash
npm run api -- elevenlabs GET "/v1/convai/agents?page_size=30"
```

**2. Turn on overrides for the first message and the prompt.** The docs put this under the agent's Security tab. Check the current API field for it at https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides. If you can't confirm it, have the user turn on these two in the dashboard: first message and system prompt.

**3. Connect a phone number.** It needs Twilio or a SIP trunk. See `twilio.md`, then list what's connected:

```bash
npm run api -- elevenlabs GET /v1/convai/phone-numbers
```

To import from Twilio, confirm the fields against the docs first. The credentials are filled in for you:

```bash
npm run api -- elevenlabs POST /v1/convai/phone-numbers --data '{"provider":"twilio","phone_number":"+14155550100","label":"dialdesk","sid":"{{env:TWILIO_ACCOUNT_SID}}","token":"{{env:TWILIO_AUTH_TOKEN}}"}'
```

**4. Save the IDs.** Set `phoneType` to `sip` if it's a SIP trunk number:

```bash
curl -X PUT localhost:3000/api/provider -H "Content-Type: application/json" -d '{"name":"elevenlabs","config":{"agentId":"THE_AGENT_ID","phoneNumberId":"THE_NUMBER_ID"}}'
```

**To capture fields,** add them as data collection items on the agent. They come back with each conversation.

Docs: https://elevenlabs.io/docs/eleven-agents
