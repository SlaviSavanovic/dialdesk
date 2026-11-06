# Getting a phone number from Twilio

Twilio isn't a voice platform here. It's where the number comes from, for Vapi, ElevenLabs, or Retell if you bring your own. dialdesk never dials through it, and `npm run api` refuses Twilio's call endpoint.

**Keys:** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, added by the user in the wizard.

**See what they already own:**

```bash
npm run api -- twilio GET /2010-04-01/Accounts/THE_SID/IncomingPhoneNumbers.json
```

The SID starts with AC and is safe for the user to tell you. It's the auth token that stays secret.

**Search for a number to buy:**

```bash
npm run api -- twilio GET "/2010-04-01/Accounts/THE_SID/AvailablePhoneNumbers/US/Local.json?AreaCode=415&Limit=5"
```

**Buy one.** This costs money, so show the user the number and get a clear yes first:

```bash
npm run api -- twilio POST /2010-04-01/Accounts/THE_SID/IncomingPhoneNumbers.json --form PhoneNumber=+14155550100
```

Then import it using the recipe for their platform.

**Watch out:** trial Twilio accounts can only call numbers verified on the account. That's fine for the user's own test call, but won't reach real leads. US numbers making many calls may also need business registration, which Twilio walks through in its console.

Docs: https://www.twilio.com/docs/voice
