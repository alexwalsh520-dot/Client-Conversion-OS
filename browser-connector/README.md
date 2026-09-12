# CCOS Everfit browser connector

This connector provides the **Sync all coaches** button in CCOS. It runs only after an administrator clicks the button. Keep Chrome, the CCOS tab and the generated sync tab open while it works. It opens its own Everfit tab and closes that tab at the end.

## One-time installation

Load this directory as an unpacked extension in Chrome's extension manager after the user approves the installation. Refresh the CCOS tab after installing. No credentials, report files, terminal commands or API keys are needed for subsequent syncs. Distribution through the Chrome Web Store can replace this development installation later.

## Access and behavior

- Site access is restricted to `https://app.everfit.io/*` and `https://client-conversion-os.vercel.app/*`.
- Reads rendered roster, profile, inbox and recent-activity UI using the existing Everfit login. It does not read cookies, export authentication tokens, send messages or edit client profiles.
- Sends captures to the authenticated CCOS sync endpoint. CCOS uses its existing AI connection to summarize evidence and stores captures and reports in Supabase.
- Only CCOS administrators can start runs. Reports retain existing coach access controls. Unknown Everfit owners are explicitly labeled Unmapped and remain management-only.
- One active sync per administrator; each saved client is checkpointed. Resuming retries unfinished clients. Stopping saves a clearly labeled partial report; resuming retries the unfinished clients. Previous reports remain available.
- Messages are selected only after verifying coach and client identity. Unavailable conversations are failures, not empty conversations. Relative dates, untranscribed attachments and incomplete history remain visible evidence gaps.
- No fixed schedule, background polling of Everfit, remote executable code, or independent cloud browser subscription.

## Verification

Run `node --test browser-connector/collector.test.cjs` from the repository. These are synthetic DOM tests; installation and an authenticated live end-to-end sync are still required before claiming the integration works.
