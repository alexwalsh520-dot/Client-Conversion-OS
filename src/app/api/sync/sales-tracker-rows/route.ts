import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchSheetData, getMonthTab, type SheetRow } from "@/lib/google-sheets";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizePersonName } from "@/lib/ads-tracker/normalize";

const DEFAULT_LOOKBACK_DAYS = 90;
const UPSERT_CHUNK_SIZE = 100;

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && (authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret)) {
    return true;
  }
  const session = await auth();
  return !!session?.user;
}

function cents(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function keyPart(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || "blank";
}

function sheetRowKey(row: SheetRow, index: number) {
  const callNumber = keyPart(row.callNumber);
  const callKey = callNumber === "blank" ? `idx-${index + 1}` : callNumber;
  return [row.date, callKey, keyPart(row.name), keyPart(row.offer)].join(":");
}

function rowPayload(row: SheetRow, index: number) {
  const date = new Date(`${row.date}T00:00:00`);
  return {
    source: "google_sheets",
    sheet_id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
    sheet_tab: Number.isNaN(date.getTime()) ? null : getMonthTab(date),
    sheet_row_key: sheetRowKey(row, index),
    date: row.date,
    call_number: row.callNumber || null,
    prospect_name: row.name || "",
    prospect_name_normalized: normalizePersonName(row.name),
    call_taken: row.callTaken,
    call_taken_status: row.callTakenStatus,
    call_length: row.callLength || null,
    recorded: row.recorded,
    outcome: row.outcome || null,
    closer: row.closer || null,
    objection: row.objection || null,
    program_length: row.programLength || null,
    contracted_revenue_cents: cents(row.revenue),
    collected_revenue_cents: cents(row.cashCollected),
    payment_method: row.method || null,
    setter: row.setter || null,
    call_notes: row.callNotes || null,
    recording_link: row.recordingLink || null,
    offer: row.offer || null,
    raw_payload: row,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function chunks<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function handler(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const dateTo =
    typeof body.dateTo === "string"
      ? body.dateTo
      : url.searchParams.get("dateTo") || todayIso();
  const dateFrom =
    typeof body.dateFrom === "string"
      ? body.dateFrom
      : url.searchParams.get("dateFrom") || shiftDate(dateTo, -DEFAULT_LOOKBACK_DAYS);

  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
    return NextResponse.json(
      { error: "Invalid dateFrom/dateTo. Use YYYY-MM-DD and dateFrom <= dateTo." },
      { status: 400 }
    );
  }

  const salesRows = await fetchSheetData(dateFrom, dateTo);
  const rows = salesRows
    .filter((row) => row.date && row.name)
    .map((row, index) => rowPayload(row, index));

  const db = getServiceSupabase();
  let upserted = 0;

  for (const chunk of chunks(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await db
      .from("sales_tracker_rows")
      .upsert(chunk, { onConflict: "source,sheet_row_key" });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          dateFrom,
          dateTo,
          rowsFetched: salesRows.length,
          rowsPrepared: rows.length,
          rowsUpserted: upserted,
          error: error.message,
        },
        { status: 500 }
      );
    }

    upserted += chunk.length;
  }

  return NextResponse.json({
    ok: true,
    dateFrom,
    dateTo,
    rowsFetched: salesRows.length,
    rowsPrepared: rows.length,
    rowsUpserted: upserted,
  });
}

export async function POST(req: NextRequest) {
  return handler(req);
}

export async function GET(req: NextRequest) {
  return handler(req);
}
