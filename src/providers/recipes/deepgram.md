# Using Deepgram

dialdesk can't dial through Deepgram directly. Its voice agent needs your own public server bridging it to a phone line, and dialdesk runs on the user's computer with no public address.

The way to use it is inside a platform that supports it, as the speech recognition (or the voice). For example, Vapi takes a `transcriber` on the assistant, which `src/providers/vapi.ts` sends on every call. Check that platform's docs for the current fields, and whether it wants the Deepgram key saved on its side.

**Key:** `DEEPGRAM_API_KEY`, added by the user, only if they want to manage their Deepgram account from here:

```bash
npm run api -- deepgram GET /v1/projects
```

Docs: https://developers.deepgram.com
