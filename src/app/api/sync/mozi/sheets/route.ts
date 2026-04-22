import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getSheetData, getAllSheetTabs } from "@/lib/mozi-sheets";

const SHEET_NAMES = [
  "coaching_feedback",
  "onboarding",
  "sales_closer",
  "sales_setter",
  "ads_daily",
] as const;

export async function POST(req: NextRequest) {
  const supabase = getServiceSupabase();
  try {
    // Validate CRON_SECRET
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret") ?? req.headers.get("x-cron-secret");
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create sync_log entry
    const { data: logEntry, error: logError } = await supabase
      .from("mozi_sync_log")
      .insert({ source: "sheets", status: "running" })
      .select("id")
      .single();

    if (logError || !logEntry) {
      throw new Error(`Failed to create sync_log: ${logError?.message}`);
    }
    const logId = logEntry.id;

    // Read sheet IDs from settings table
    const { data: settingsRow, error: settingsError } = await supabase
      .from("mozi_settings")
      .select("value")
      .eq("key", "sheet_ids")
      .single();

    if (settingsError || !settingsRow) {
      throw new Error(`Failed to read sheet_ids setting: ${settingsError?.message}`);
    }

    const sheetIds = settingsRow.value as Record<string, string>;
    let totalRecords = 0;

    for (const sheetName of SHEET_NAMES) {
      const sheetId = sheetIds[sheetName];
      if (!sheetId) {
        continue; // Skip unconfigured sheets
      }

      // Get all tabs in this spreadsheet
      const tabs = await getAllSheetTabs(sheetId);

      // Delete existing rows for this sheet_name (full replace)
      const { error: deleteError } = await supabase
        .from("mozi_sheet_data")
        .delete()
        .eq("sheet_name", sheetName);

      if (deleteError) {
        throw new Error(`Delete failed for ${sheetName}: ${deleteError.message}`);
      }

      // Process each tab
      for (const tabName of tabs) {
        const rows = await getSheetData(sheetId, tabName);
        if (rows.length < 2) continue; // Need at least header + 1 data row

        const headers = rows[0];
        const dataRows = rows.slice(1);
        const insertBatch: {
          sheet_name: string;
          sheet_id: string;
          tab_name: string;
          row_data: Record<string, string>;
          row_index: number;
          synced_at: string;
        }[] = [];

        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          // Build row_data object with column headers as keys
          const rowData: Record<string, string> = {};
          for (let col = 0; col < headers.length; col++) {
            const key = headers[col];
            if (key) {
              rowData[key] = row[col] ?? "";
            }
          }

          insertBatch.push({
            sheet_name: sheetName,
            sheet_id: sheetId,
            tab_name: tabName,
            row_data: rowData,
            row_index: i + 1, // 1-based index (excludes header)
            synced_at: new Date().toISOString(),
          });
        }

        // Insert in chunks to avoid request size limits
        const CHUNK_SIZE = 500;
        for (let i = 0; i < insertBatch.length; i += CHUNK_SIZE) {
          const chunk = insertBatch.slice(i, i + CHUNK_SIZE);
          const { error: insertError } = await supabase
            .from("mozi_sheet_data")
            .insert(chunk);

          if (insertError) {
            throw new Error(
              `Insert failed for ${sheetName}/${tabName}: ${insertError.message}`
            );
          }
        }

        totalRecords += insertBatch.length;
      }
    }

    // Update sync_log with success
    await supabase
      .from("mozi_sync_log")
      .update({
        status: "success",
        records_synced: totalRecords,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({
      ok: true,
      source: "sheets",
      records_synced: totalRecords,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      await supabase
        .from("mozi_sync_log")
        .update({
          status: "error",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("source", "sheets")
        .eq("status", "running");
    } catch {
      // ignore logging failure
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
