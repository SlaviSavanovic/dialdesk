# Setting up Bland AI

The shortest path to a real test call. The API key is all it needs.

**Key:** `BLAND_API_KEY`, added by the user in the wizard.

**Settings:** none required. Calls go out from Bland's pool of US numbers when `fromNumber` isn't set. A caller ID that changes per call looks spammy, so anyone calling real leads should buy a number and set it:

```bash
npm run api -- bland GET /v1/inbound
```

Then save it:

```bash
curl -X PUT localhost:3000/api/provider -H "Content-Type: application/json" -d '{"name":"bland","config":{"fromNumber":"+14155550100"}}'
```

**Check the account has credit:**

```bash
npm run api -- bland GET /v1/me
```

**Watch out:** international calls need a completed purchase on the account.

Docs: https://docs.bland.ai
