#!/usr/bin/env node
// Discover all tabs in each Google Sheet for CCOS
// Run: node scripts/discover-sheets.mjs

import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local
config({ path: resolve(process.cwd(), ".env.local") });

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = process.env.GOOGLE_PRIVATE_KEY;

if (!email || !key) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: email,
    private_key: key.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

const SHEETS = {
  "Product Health Tracker": "196qJOcCvx37GlRA1wJ8aCDCaXBJfqJ_nqdGaVi8TfEY",
  "Coaching Clients Tracker": "1XcQeG_ehg5BYCsSEJllelT0zVaJJwjRE1OZWf4gjeTo",
  "Sales Tracker": "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o",
  "Tyson Ads": "1r7UXESjrCvqg3Uf0sm0GGlzKuKlkpUR1Z5RjHbcYmAY",
  "Keith Ads": "1DomGcRLp4NBV-nlXVq-zfq9vg8jPPNa1Wq4aalVr_Xk",
};

async function discoverTabs(name, sheetId) {
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "sheets.properties",
    });

    const tabs = (res.data.sheets || []).map((s) => ({
      title: s.properties?.title || "",
      index: s.properties?.index || 0,
      rowCount: s.properties?.gridProperties?.rowCount || 0,
      colCount: s.properties?.gridProperties?.columnCount || 0,
    }));

    console.log(`\n📊 ${name} (${sheetId})`);
    console.log(`   ${tabs.length} tab(s):`);
    for (const tab of tabs) {
      console.log(`   - "${tab.title}" (${tab.rowCount} rows × ${tab.colCount} cols)`);
    }

    // For sheets with multiple tabs, peek at first row of each tab to see headers
    if (tabs.length > 1) {
      console.log(`   --- Headers preview ---`);
      for (const tab of tabs) {
        try {
          const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `'${tab.title}'!A1:Z1`,
          });
          const headers = headerRes.data.values?.[0] || [];
          console.log(`   "${tab.title}": ${headers.slice(0, 8).join(", ")}${headers.length > 8 ? "..." : ""}`);
        } catch (e) {
          console.log(`   "${tab.title}": (could not read headers)`);
        }
      }
    }

    // Also peek at first 3 data rows of the first tab for context
    console.log(`   --- First tab data sample ---`);
    try {
      const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tabs[0].title}'!A1:Z4`,
      });
      const rows = dataRes.data.values || [];
      for (let i = 0; i < Math.min(rows.length, 4); i++) {
        const preview = rows[i].slice(0, 8).join(" | ");
        console.log(`   Row ${i + 1}: ${preview}${rows[i].length > 8 ? " ..." : ""}`);
      }
    } catch (e) {
      console.log(`   (could not read data sample)`);
    }

    return tabs;
  } catch (e) {
    console.log(`\n❌ ${name}: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("🔍 Discovering all Google Sheet tabs for CCOS...");

  const allTabs = {};
  for (const [name, id] of Object.entries(SHEETS)) {
    allTabs[name] = await discoverTabs(name, id);
  }

  console.log("\n\n=== SUMMARY ===");
  for (const [name, tabs] of Object.entries(allTabs)) {
    console.log(`${name}: ${tabs.length} tab(s) — ${tabs.map((t) => `"${t.title}"`).join(", ")}`);
  }
}

main().catch(console.error);
