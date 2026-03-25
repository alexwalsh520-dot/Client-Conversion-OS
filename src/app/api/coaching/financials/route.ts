// API route to live-fetch financial data from two Google Sheets:
// 1. Cancellations & Refunds sheet
// 2. Sales Tracker - Flagship Retention Payments (monthly tabs)

import { google } from "googleapis";
import { NextResponse } from "next/server";

const REFUNDS_SHEET_ID = "1DjsLzXyAs23TezCVlHbr2N6Mjha76IYGU3OkXenDVoY";
const SALES_TRACKER_ID = "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o";

const MONTH_TABS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function getAuth() {
  const email = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Missing Google service account credentials");
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function parseMoney(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Month param: 0-11 (default to current month)
    const monthParam = searchParams.get("month");
    const monthIndex = monthParam !== null ? parseInt(monthParam, 10) : new Date().getMonth();
    const monthTab = MONTH_TABS[monthIndex];

    if (!monthTab) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });

    // Fetch both sheets in parallel
    const [refundsRes, retentionRes] = await Promise.all([
      // Refunds sheet: "Flagship C&Rs" tab, columns A-H, skip header row 1
      sheets.spreadsheets.values.get({
        spreadsheetId: REFUNDS_SHEET_ID,
        range: "A2:H500",
      }).catch((err) => {
        console.error("Refunds sheet fetch error:", err.message);
        return null;
      }),

      // Sales Tracker: Retention payments in columns AQ-AX on the monthly tab
      // Row 4 has headers (Date, Name, Payment Total, Coach, New?, Offer, Months Sold)
      // Data starts at row 5
      sheets.spreadsheets.values.get({
        spreadsheetId: SALES_TRACKER_ID,
        range: `'${monthTab}'!AQ5:AX100`,
      }).catch((err) => {
        console.error("Retention sheet fetch error:", err.message);
        return null;
      }),
    ]);

    // Parse refunds
    const refunds: Array<{
      clientName: string;
      date: string;
      type: string;
      amount: number;
      fault: string;
      reason: string;
      salesPerson: string;
      disputed: string;
    }> = [];

    if (refundsRes?.data?.values) {
      for (const row of refundsRes.data.values) {
        const clientName = (row[0] || "").trim();
        if (!clientName) continue;
        refunds.push({
          clientName,
          date: (row[1] || "").trim(),
          type: (row[2] || "").trim(),
          amount: parseMoney(row[3]),
          fault: (row[4] || "").trim(),
          reason: (row[5] || "").trim(),
          salesPerson: (row[6] || "").trim(),
          disputed: (row[7] || "").trim(),
        });
      }
    }

    // Parse retention payments
    const retentions: Array<{
      callNumber: string;
      date: string;
      clientName: string;
      paymentTotal: number;
      coach: string;
      isNew: string;
      offer: string;
      monthsSold: number;
    }> = [];

    if (retentionRes?.data?.values) {
      for (const row of retentionRes.data.values) {
        const clientName = (row[2] || "").trim();
        if (!clientName) continue;
        retentions.push({
          callNumber: (row[0] || "").trim(),
          date: (row[1] || "").trim(),
          clientName,
          paymentTotal: parseMoney(row[3]),
          coach: (row[4] || "").trim(),
          isNew: (row[5] || "").trim(),
          offer: (row[6] || "").trim(),
          monthsSold: parseInt(row[7] || "0", 10) || 0,
        });
      }
    }

    // Filter refunds by selected month
    const refundsForMonth = refunds.filter((r) => {
      if (!r.date) return false;
      try {
        const d = new Date(r.date);
        return d.getMonth() === monthIndex;
      } catch {
        return false;
      }
    });

    return NextResponse.json({
      month: monthTab,
      monthIndex,
      refunds: refundsForMonth,
      allRefunds: refunds,
      retentions,
    });
  } catch (err) {
    console.error("Financials API error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
