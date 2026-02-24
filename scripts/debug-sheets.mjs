#!/usr/bin/env node
// Debug Google Sheets API access
import { google } from "googleapis";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const key = process.env.GOOGLE_PRIVATE_KEY;

console.log("Service account email:", email);
console.log("Private key starts with:", key?.substring(0, 40));
console.log("Private key length:", key?.length);

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: email,
    private_key: key.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Test each sheet with full error details
const SHEETS = {
  "Coaching Feedback": "196qWb-P3GvBYmDwmmex8MlnBIFUCe8ckJxdsIY5cl60",
  "Onboarding Tracker": "1XceSeCjJSuWlKyxgR3UOdNUFyD0Gd2MlV3R4P1K5q1E",
  "Sales Tracker": "1890Z-1T1eSQQ8oQcNShb-x3yVu5lRJ96cVJMz78CqXg",
  "Tyson Ads": "1r7UBYpB9CdNPojTc1sDeVtfUJYLxpBbPl8FRMKUVqFk",
  "Keith Ads": "1DomD8y7mewsDWOlh9aFMm0bqQjj0m5Z8WJdZQSNwDkk",
};

async function main() {
  // First test auth by getting an access token
  try {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    console.log("\n✅ Auth successful! Token obtained:", token.token?.substring(0, 30) + "...");
  } catch (e) {
    console.log("\n❌ Auth failed:", e.message);
    return;
  }

  for (const [name, id] of Object.entries(SHEETS)) {
    console.log(`\nTesting "${name}" (${id})...`);
    try {
      const res = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: "spreadsheetId,properties.title,sheets.properties.title",
      });
      console.log(`  ✅ Title: "${res.data.properties?.title}"`);
      const tabs = res.data.sheets?.map(s => s.properties?.title) || [];
      console.log(`  Tabs: ${tabs.join(", ")}`);
    } catch (e) {
      console.log(`  ❌ Error ${e.code}: ${e.message}`);
      if (e.response?.data) {
        console.log(`  Details:`, JSON.stringify(e.response.data.error, null, 2));
      }
    }
  }
}

main().catch(console.error);
