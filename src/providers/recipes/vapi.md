# Setting up Vapi

**Key:** `VAPI_API_KEY`, the private key, added by the user in the wizard.

**Needs a phone number that can dial out.** Free Vapi numbers only take incoming calls, so a number has to be imported from Twilio, Telnyx or Vonage. See `twilio.md` for getting one.

**1. See what's already there:**

```bash
npm run api -- vapi GET /phone-number
```

**2. If no number is imported, import one from Twilio.** The token is filled in for you, so you never see it. Confirm the fields against the docs first:

```bash
npm run api -- vapi POST /phone-number --data '{"provider":"twilio","number":"+14155550100","twilioAccountSid":"{{env:TWILIO_ACCOUNT_SID}}","twilioAuthToken":"{{env:TWILIO_AUTH_TOKEN}}"}'
```

**3. Save the number's `id`:**

```bash
curl -X PUT localhost:3000/api/provider -H "Content-Type: application/json" -d '{"name":"vapi","config":{"phoneNumberId":"THE_ID"}}'
```

**Optional:** `model` sets the OpenAI model, which defaults to `gpt-4o-mini`. There's no need to create an assistant, because dialdesk sends the full script with each call.

**To change the voice or transcriber** (Deepgram, for example), edit `assistant` in `src/providers/vapi.ts`, since that's what gets sent on each call. Check the docs for the current fields.

Docs: https://docs.vapi.ai
