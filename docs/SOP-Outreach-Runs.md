# SOP: Running Outreach via the Dashboard

**Replaces:** Manual Python scripts in terminal
**Where:** https://client-conversion-os.vercel.app/outreach-runs
**Who can run this:** Anyone with authorized Google login access to CCOS

---

## Before You Start

You need a CSV file of leads. The CSV must have these columns (column names are flexible — spaces, underscores, capitalization all work):

| Required        | Optional           |
|-----------------|--------------------|
| `first_name`    | `last_name`        |
| `email`         | `instagram_link`   |
| `instagram_username` (or `instagram`, `ig`, `username`) | |

**Example CSV:**
```
first_name,last_name,email,instagram_username
Sarah,Johnson,sarah@fitfluencer.com,sarahj_fitness
Mike,Chen,mike@example.com,mikechen_fit
```

If a lead has no email, they'll skip Smartlead but still go to the ColdDMs list.
If a lead has no Instagram, they'll skip ColdDMs but still go to Smartlead.

---

## Option A: Step-by-Step (Recommended for First Time)

### Step 1: Upload Your CSV

1. Open https://client-conversion-os.vercel.app/outreach-runs
2. In the **"Run Outreach"** panel, find the **upload dropzone** (dashed border area)
3. Either:
   - **Drag and drop** your CSV file onto the dropzone, OR
   - **Click** the dropzone to open a file picker and select your CSV
4. Wait for the preview to load — you'll see:
   - The filename and lead count (e.g., "leads.csv — 86 leads ready to import")
   - A preview table showing the first 5 rows
   - Verify the names, emails, and Instagram handles look correct
5. If the preview looks wrong, click the dropzone again to upload a different file

### Step 2: Import to GHL

1. Click the **"Import to GHL"** button (gold button)
2. Wait — a spinner will appear while leads are being created in GoHighLevel
3. This creates a contact, adds an Instagram note, and creates an opportunity in the "New Lead" pipeline stage for each lead
4. When done, you'll see a green success message:
   - "86 leads imported to GHL — 82 new contacts, 4 already existed"
5. If any leads fail, the count will show (e.g., "3 failed") — these are usually duplicates or missing data

### Step 3: Run Outreach

1. Click the **"Run Outreach"** button (now enabled after import)
2. Wait — this step:
   - Pulls all "New Lead" opportunities from the GHL pipeline
   - Pushes their emails to the Smartlead campaign
   - Collects all Instagram usernames for ColdDMs
   - Moves each opportunity to the "Contacted" stage
3. When done, you'll see:
   - "82 leads added to Smartlead email campaign"
   - "86 Instagram usernames ready for ColdDMs"
   - Three download/copy buttons appear

### Step 4: Get Your ColdDMs List

1. Click **"Download ColdDMs (.txt)"** — downloads a text file with one username per line (use this for ColdDMs tool)
2. OR click **"Download ColdDMs (.csv)"** — downloads a CSV with username, firstName, name columns
3. OR click **"Copy Usernames"** — copies all usernames to your clipboard

### Step 5: Load Into ColdDMs

1. Open the ColdDMs tool
2. Upload the .txt file you just downloaded (or paste from clipboard)
3. Run your DM campaign as usual

---

## Option B: One-Click Run All

If you've done this before and trust your CSV:

1. Upload your CSV (Step 1 above)
2. Click **"Run All (Import + Outreach)"** at the bottom of the panel
3. It will automatically:
   - Step 1/2: Import leads to GHL
   - Step 2/2: Run outreach (Smartlead + ColdDMs)
4. Download your ColdDMs file when complete

---

## After the Run

### Check Run History
- Scroll down to the **"Run History"** table
- Every run is logged with: date, leads imported, emails sent, DMs queued, errors, status
- Click the **date** on any row to expand and see error details
- Click **"Download"** on any past run to re-download that run's ColdDMs file

### Check Quick Stats
- At the top of the page, four cards show all-time totals:
  - Total Leads Imported
  - Total Emails Sent
  - Total DMs Queued
  - Last Run date

### Check the Outreach Tab
- Navigate to **Outreach** in the sidebar (under Main)
- This shows the live pipeline: how many leads are in each stage (New Lead, Contacted, Follow Up, In Contact, Lost)
- Also shows Smartlead campaign stats (emails sent, open rate, reply rate)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Import to GHL" fails | Check that the CSV has valid emails. Leads without emails can still be imported if they have Instagram. |
| "Run Outreach" shows 0 processed | There are no leads in "New Lead" stage — they may have already been moved to "Contacted" from a previous run. |
| Smartlead errors but DMs still work | Smartlead failures don't block the ColdDMs list. Download your DMs file and check Smartlead separately. |
| A lead already existed | Not an error — the system detected a duplicate email in GHL and skipped creating a new contact. The lead still gets added to the pipeline. |
| ColdDMs file is empty | None of your leads had Instagram usernames. Check your CSV column names. |
| Run history is gone | History is stored in your browser's local storage. If you cleared browser data or switched browsers, history resets. The actual leads in GHL and Smartlead are unaffected. |

---

## Daily Workflow Summary

```
1. Get CSV of new leads (from Lead Gen tab, VA, or manual list)
2. Open Outreach Runs tab
3. Upload CSV
4. Click "Run All"
5. Download ColdDMs .txt file
6. Load into ColdDMs tool
7. Done — emails go out automatically via Smartlead
```

Total time: ~2 minutes per batch (vs. 10-15 min with terminal scripts)
