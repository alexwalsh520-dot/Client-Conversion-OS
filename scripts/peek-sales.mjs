#!/usr/bin/env node
import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });
const SALES_ID = "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o";

async function main() {
  // Check current month tab (FEBRUARY or MARCH)
  for (const tab of ["FEBRUARY", "MARCH"]) {
    console.log(`\n=== ${tab} ===`);
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SALES_ID,
        range: `'${tab}'!A1:Z30`,
      });
      const rows = res.data.values || [];
      for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const preview = rows[i].slice(0, 10).map(c => String(c || "").substring(0, 25)).join(" | ");
        console.log(`Row ${i + 1}: ${preview}`);
      }
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }

  // Also check Tyson Ads current month tab for daily data
  const TYSON_ID = "1r7UXESjrCvqg3Uf0sm0GGlzKuKlkpUR1Z5RjHbcYmAY";
  console.log("\n=== Tyson Ads - (Current) Jan ===");
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TYSON_ID,
      range: `'(Current) Jan'!A1:Z5`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const preview = rows[i].slice(0, 10).map(c => String(c || "").substring(0, 20)).join(" | ");
      console.log(`Row ${i + 1}: ${preview}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check Feb tab for daily data
  console.log("\n=== Tyson Ads - Feb ===");
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TYSON_ID,
      range: `'Feb'!A1:Z5`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const preview = rows[i].slice(0, 10).map(c => String(c || "").substring(0, 20)).join(" | ");
      console.log(`Row ${i + 1}: ${preview}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  // Check onboarding data more closely
  const ONBOARDING_ID = "1XcQeG_ehg5BYCsSEJllelT0zVaJJwjRE1OZWf4gjeTo";
  console.log("\n=== Onboarding Backlog ===");
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ONBOARDING_ID,
      range: `'Onboarding Backlog'!A1:K10`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const preview = rows[i].slice(0, 10).map(c => String(c || "").substring(0, 25)).join(" | ");
      console.log(`Row ${i + 1}: ${preview}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

main().catch(console.error);
