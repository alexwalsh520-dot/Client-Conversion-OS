import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { searchContacts, getOpportunities, getPipelines } from "@/lib/mozi-ghl";

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
      .insert({ source: "ghl", status: "running" })
      .select("id")
      .single();

    if (logError || !logEntry) {
      throw new Error(`Failed to create sync_log: ${logError?.message}`);
    }
    const logId = logEntry.id;

    // Fetch all contacts (paginated automatically)
    const contacts = await searchContacts();

    // Upsert contacts into ghl_contacts
    let recordsSynced = 0;
    for (const contact of contacts) {
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;

      const { error: upsertError } = await supabase
        .from("mozi_ghl_contacts")
        .upsert(
          {
            ghl_id: contact.id,
            email: contact.email ?? null,
            name,
            tags: contact.tags ?? [],
            created_at: (contact as Record<string, unknown>).dateAdded
              ? new Date(String((contact as Record<string, unknown>).dateAdded)).toISOString()
              : null,
            updated_at: (contact as Record<string, unknown>).dateUpdated
              ? new Date(String((contact as Record<string, unknown>).dateUpdated)).toISOString()
              : null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "ghl_id" }
        );

      if (upsertError) {
        throw new Error(`Contact upsert failed for ${contact.id}: ${upsertError.message}`);
      }
      recordsSynced++;
    }

    // Fetch pipelines to build stage ID -> name map
    const pipelines = await getPipelines();
    const stageMap = new Map<string, { stageName: string; pipelineName: string }>();
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        stageMap.set(stage.id, { stageName: stage.name, pipelineName: pipeline.name });
      }
    }

    // Fetch all opportunities
    const opportunities = await getOpportunities();

    // Update contacts that have opportunities with stage and monetary_value
    for (const opp of opportunities) {
      const contactId = opp.contact?.id;
      if (!contactId) continue;

      const stageInfo = stageMap.get(opp.pipelineStageId);
      const updateData: Record<string, unknown> = {
        synced_at: new Date().toISOString(),
      };

      if (stageInfo) {
        updateData.stage = stageInfo.stageName;
        updateData.pipeline = stageInfo.pipelineName;
      }

      if (opp.monetaryValue != null) {
        // GHL monetary values are in dollars, convert to cents
        updateData.monetary_value = Math.round(opp.monetaryValue * 100);
      }

      await supabase
        .from("mozi_ghl_contacts")
        .update(updateData)
        .eq("ghl_id", contactId);
    }

    // Update sync_log with success
    await supabase
      .from("mozi_sync_log")
      .update({
        status: "success",
        records_synced: recordsSynced,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({
      ok: true,
      source: "ghl",
      records_synced: recordsSynced,
      opportunities_processed: opportunities.length,
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
        .eq("source", "ghl")
        .eq("status", "running");
    } catch {
      // ignore logging failure
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
