# Outreach Runs: Technical Breakdown

What every button does, what APIs it calls, and where the data goes.

---

## System Architecture

```
Browser (Dashboard)
    |
    |-- POST /api/outreach/import  --> GoHighLevel CRM
    |-- POST /api/outreach/run     --> GoHighLevel CRM + Smartlead
    |-- GET  /api/outreach/pipeline --> GoHighLevel CRM
    |-- GET  /api/outreach/stats    --> Smartlead
    |
    |-- localStorage (run history)
    |
    v
Two external systems receive the data:
  1. GoHighLevel (GHL) — CRM, pipeline, contacts
  2. Smartlead — cold email campaigns
```

All API keys live as Vercel environment variables. The browser never touches them directly — every external API call goes through a serverless function on the backend.

---

## Button-by-Button Breakdown

### 1. CSV Upload (Dropzone)

**What it does:** Reads a CSV file in the browser and parses it into structured lead data.

**Technical details:**
- Runs entirely client-side — no API call
- Uses `FileReader` to read the CSV as text
- Parses column headers with flexible matching:
  - `first_name`, `firstname`, `First Name`, `first` all map to first_name
  - `instagram_username`, `instagram`, `ig`, `username` all map to instagram
  - `email`, `emailaddress`, `Email Address` all map to email
- Auto-derives missing fields:
  - If instagram_username exists but no link: generates `https://instagram.com/{username}`
  - If instagram_link exists but no username: extracts username from URL
- Shows a preview table of first 5 rows for verification

**Data flow:** CSV file -> browser memory (React state) -> preview table

---

### 2. "Import to GHL" Button

**What it does:** Creates contacts and opportunities in GoHighLevel CRM for each lead in your CSV.

**API route:** `POST /api/outreach/import`

**For each lead, it runs this sequence:**

```
1. DUPLICATE CHECK
   GET https://services.leadconnectorhq.com/contacts/search/duplicate
     ?email={email}&locationId={locationId}

   -> If contact exists: use existing contactId, skip creation
   -> If not found: proceed to create

2. CREATE CONTACT (if new)
   POST https://services.leadconnectorhq.com/contacts/
   Body: {
     locationId: "Kk3jbbXFtku7dBdF5NAu",
     firstName: "Sarah",
     lastName: "Johnson",
     email: "sarah@example.com",
     source: "Dashboard Import"
   }

   -> Returns: { contact: { id: "abc123" } }

3. ADD INSTAGRAM NOTE
   POST https://services.leadconnectorhq.com/contacts/{contactId}/notes
   Body: {
     body: "IG - @sarahj_fitness\nIG Link - https://instagram.com/sarahj_fitness"
   }

   -> This is how Instagram data is stored in GHL (in contact notes)

4. CREATE OPPORTUNITY (if new contact)
   POST https://services.leadconnectorhq.com/opportunities/
   Body: {
     pipelineId: "{AI Outreach pipeline ID}",
     pipelineStageId: "{New Lead stage ID}",
     locationId: "Kk3jbbXFtku7dBdF5NAu",
     contactId: "abc123",
     name: "Sarah Johnson",
     status: "open",
     source: "Dashboard Import"
   }

   -> Places the lead in the "New Lead" column of the AI Outreach pipeline
```

**What gets returned to the browser:**
- Success count (new contacts created)
- Already-existed count (duplicates found)
- Failed count (errors)
- List of Instagram usernames collected

**Where the data ends up in GHL:**
- Contact created under Contacts
- Instagram info in contact's Notes
- Opportunity in AI Outreach pipeline -> "New Lead" stage

---

### 3. "Run Outreach" Button

**What it does:** Takes all leads sitting in "New Lead" stage, pushes their emails to Smartlead for automated cold email, collects Instagram usernames for ColdDMs, and moves them to "Contacted" stage.

**API route:** `POST /api/outreach/run`

**Sequence:**

```
1. FIND THE PIPELINE
   GET https://services.leadconnectorhq.com/opportunities/pipelines
     ?locationId={locationId}

   -> Finds "AI Outreach" pipeline
   -> Gets stage IDs for "New Lead" and "Contacted"

2. GET ALL NEW LEADS
   GET https://services.leadconnectorhq.com/opportunities/search
     ?location_id={locationId}
     &pipeline_id={pipelineId}
     &pipeline_stage_id={newLeadStageId}
     &limit=100

   -> Returns all opportunities in "New Lead" stage

3. FOR EACH OPPORTUNITY:

   a. GET CONTACT DETAILS
      GET https://services.leadconnectorhq.com/contacts/{contactId}
      -> Gets email, first name, last name

   b. GET CONTACT NOTES
      GET https://services.leadconnectorhq.com/contacts/{contactId}/notes
      -> Parses Instagram username from notes using regex:
         Pattern 1: IG - @username
         Pattern 2: instagram.com/username

   c. COLLECT FOR SMARTLEAD (if has email)
      Adds to batch list: { email, first_name }

   d. COLLECT FOR COLDDMS (if has Instagram)
      Adds username to ColdDMs list

   e. MOVE TO CONTACTED
      PUT https://services.leadconnectorhq.com/opportunities/{oppId}
      Body: { pipelineStageId: "{Contacted stage ID}" }

4. BATCH ADD TO SMARTLEAD
   POST https://server.smartlead.ai/api/v1/campaigns/{campaignId}/leads
     ?api_key={apiKey}
   Body: {
     lead_list: [
       {
         email: "sarah@example.com",
         first_name: "Sarah",
         custom_fields: {
           gamma_link: "https://gamma.app/docs/..."
         }
       },
       ...
     ]
   }

   -> All leads added to campaign in one batch call
   -> Smartlead handles the email sequence automatically from here
```

**What gets returned to the browser:**
- Processed count
- Smartlead added count
- DMs queued count (Instagram usernames collected)
- Error list (any failures)
- ColdDMs username list
- ColdDMs CSV string

**What happens after this button:**
- Smartlead starts sending emails on its schedule (you don't need to do anything)
- You download the ColdDMs list and load it into the ColdDMs tool manually

---

### 4. "Run All" Button

**What it does:** Runs Import + Run Outreach back-to-back automatically.

**Sequence:**
1. Calls `POST /api/outreach/import` (same as "Import to GHL")
2. Waits for completion
3. Calls `POST /api/outreach/run` (same as "Run Outreach")
4. Shows combined results

**Progress indicator:** "Step 1/2: Importing leads to GHL..." then "Step 2/2: Running outreach..."

---

### 5. Download Buttons (after Run Outreach completes)

**"Download ColdDMs (.txt)"**
- Generates a text file in the browser
- One username per line, no @ prefix
- Example content:
  ```
  sarahj_fitness
  mikechen_fit
  fitwithanna
  ```
- Use this file with the ColdDMs tool

**"Download ColdDMs (.csv)"**
- Generates a CSV file in the browser
- Columns: username, firstName, name
- firstName and name may be empty if not available from the run data

**"Copy Usernames"**
- Copies all usernames to clipboard, one per line
- Button text changes to "Copied!" for 2 seconds as confirmation

---

### 6. Run History Table

**Storage:** Browser localStorage (key: `ccos_outreach_runs`)

**Each run record contains:**
- Run ID (e.g., `run_2026-03-04_001`)
- Timestamp
- Leads imported count
- Smartlead added count
- DMs queued count
- Error count + error details
- ColdDMs filename
- ColdDMs username list (so you can re-download anytime)
- Status: completed / partial / failed

**Row actions:**
- Click date to expand/collapse error details
- "Download" button re-generates the ColdDMs .txt file from stored usernames
- Trash icon deletes the run from history

**Important:** Run history is browser-local. Clearing browser data or switching browsers/computers loses the history. The actual data in GHL and Smartlead is unaffected.

---

## Outreach Tab (Live Dashboard)

### Pipeline Visualization

**API route:** `GET /api/outreach/pipeline`

**What it shows:** Real-time count of leads in each GHL pipeline stage:
- New Lead (blue) — imported but not yet contacted
- Contacted (light blue) — emails sent via Smartlead
- Follow Up Needed (teal)
- In Contact (green) — actively responding
- In Contact (Contacted) (green variant)
- In Contact (Follow Up Needed) (green variant)
- Lost (red) — bounced, unsubscribed, or disqualified

**How it works:** Queries each pipeline stage in GHL and counts opportunities.

Falls back to mock data if the API call fails (e.g., missing env vars).

### Campaign Stats

**API route:** `GET /api/outreach/stats`

**What it shows:** Live Smartlead campaign metrics:
- Total emails sent
- Open rate
- Reply rate
- Bounce rate
- Active sequences

**How it works:** Calls Smartlead's campaign statistics endpoint directly.

---

## Data Flow Summary

```
CSV File
  |
  v
[Import to GHL] ──> GHL Contacts (with IG notes)
  |                  GHL Pipeline: "New Lead" stage
  v
[Run Outreach] ───> Smartlead Campaign (email addresses)
  |                  GHL Pipeline: moved to "Contacted"
  |                  ColdDMs list (Instagram usernames)
  v
[Downloads] ──────> .txt file for ColdDMs tool
                    .csv file for records
                    Clipboard for quick paste
```

## Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `GHL_API_KEY` | All GHL API calls | Bearer token authentication |
| `GHL_LOCATION_ID` | All GHL API calls | Identifies the GHL sub-account |
| `SMARTLEAD_API_KEY` | Smartlead API calls | API authentication |
| `SMARTLEAD_CAMPAIGN_ID` | Smartlead API calls | Which email campaign to add leads to |
| `GAMMA_LINK` | Run Outreach | Custom field sent with each Smartlead lead |

All stored in Vercel environment variables. Never exposed to the browser.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Lead has no email | Skipped for Smartlead, still added to ColdDMs if has Instagram |
| Lead has no Instagram | Skipped for ColdDMs, still added to Smartlead if has email |
| Duplicate email in GHL | Uses existing contact, doesn't create a new one |
| Smartlead batch fails | Error logged, but ColdDMs list is still generated and pipeline moves happen |
| GHL API returns 401 | API key expired — update in Vercel env vars |
| GHL API returns 422 | Usually missing locationId — this is handled automatically |
| Single lead fails | Error logged, processing continues for remaining leads |
