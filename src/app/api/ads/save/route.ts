import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Save a creative's text blocks and record edits
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { creativeId, textBlocks, editType, beforeState, afterState } = body;
    const sb = getServiceSupabase();

    // Update the creative
    const { error: updateError } = await sb
      .from("ad_creatives")
      .update({
        text_blocks: textBlocks,
        status: "edited",
        updated_at: new Date().toISOString(),
      })
      .eq("id", creativeId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Record the edit for learning
    if (editType && beforeState && afterState) {
      await sb.from("ad_edit_history").insert({
        creative_id: creativeId,
        edit_type: editType,
        before_state: beforeState,
        after_state: afterState,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save error:", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
