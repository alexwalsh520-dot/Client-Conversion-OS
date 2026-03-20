// GET /api/debug-sheets — Inspect actual Google Sheets structure
// Returns tab names + first 3 rows from each tab for column mapping
// TEMPORARY: Remove after fixing sync

import { NextResponse } from "next/server";
import { google } from "googleapis";

const SHEET_IDS: Record<string, string> = {
  coachingFeedback: "196qJOcCvx37GlRA1wJ8aCDCaXBJfqJ_nqdGaVi8TfEY",
  onboarding: "1XcQeG_ehg5BYCsSEJllelT0zVaJJwjRE1OZWf4gjeTo",
  sales: "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o",
  tysonAds: "1r7UXESjrCvqg3Uf0sm0GGlzKuKlkpUR1Z5RjHbcYmAY",
  keithAds: "1DomGcRLp4NBV-nlXVq-zfq9vg8jPPNa1Wq4aalVr_Xk",
};

function getAuth() {
  const email = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(`Missing env: email=${!!email}, key=${!!key}`);
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET() {
  const results: Record<string, unknown> = {};

  for (const [name, sheetId] of Object.entries(SHEET_IDS)) {
    try {
      const sheets = google.sheets({ version: "v4", auth: getAuth() });

      // Get all tab names
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: "sheets.properties.title,sheets.properties.gridProperties",
      });

      const tabs = (meta.data.sheets || []).map((s) => ({
        title: s.properties?.title || "",
        rows: s.properties?.gridProperties?.rowCount || 0,
        cols: s.properties?.gridProperties?.columnCount || 0,
      }));

      // Read first 3 rows from each tab to see headers + sample data
      const tabDetails: Record<string, unknown> = {};
      for (const tab of tabs) {
        try {
          const res = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `'${tab.title}'!A1:Z5`,
          });
          tabDetails[tab.title] = {
            rows: tab.rows,
            cols: tab.cols,
            sampleRows: res.data.values || [],
          };
        } catch (e) {
          tabDetails[tab.title] = {
            rows: tab.rows,
            cols: tab.cols,
            error: (e as Error).message?.substring(0, 200),
          };
        }
      }

      results[name] = { sheetId, tabs: tabDetails };
    } catch (e) {
      results[name] = { sheetId, error: (e as Error).message?.substring(0, 300) };
    }
  }

  return NextResponse.json(results, { status: 200 });
}
