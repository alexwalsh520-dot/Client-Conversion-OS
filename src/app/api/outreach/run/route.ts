import { NextResponse } from "next/server";
import {
  getAIOutreachPipeline,
  searchOpportunities,
  getContact,
  getContactNotes,
  updateOpportunity,
  findStageId,
} from "@/lib/ghl";
import { addLeadsToCampaign } from "@/lib/smartlead";
import {
  buildColdDmsCsv,
  buildColdDmsRow,
  ColdDmsRow,
  mergeColdDmsRows,
  normalizeInstagramUsername,
} from "@/lib/outreach-export";

function parseInstagramFromNotes(
  notes: { body?: string }[]
): string | null {
  for (const note of notes) {
    if (!note.body) continue;
    // Try IG - @username pattern
    const igMatch = note.body.match(/IG\s*[-–—:]\s*@?(\w[\w.]+)/i);
    if (igMatch) return igMatch[1];
    // Try instagram.com/username pattern
    const linkMatch = note.body.match(
      /instagram\.com\/([A-Za-z0-9_.]+)/i
    );
    if (linkMatch) return linkMatch[1];
  }
  return null;
}

export async function POST() {
  try {
    const pipeline = await getAIOutreachPipeline();
    const newLeadStageId = findStageId(pipeline.stages, [
      "New Lead",
      "Lead",
      "Fresh Leads",
    ]);
    const contactedStageId = findStageId(pipeline.stages, [
      "Contacted",
      "In Contact (Contacted)",
      "In Contact",
    ]);

    if (!newLeadStageId) {
      return NextResponse.json(
        { error: 'No "New Lead" stage found' },
        { status: 500 }
      );
    }
    if (!contactedStageId) {
      return NextResponse.json(
        { error: 'No "Contacted" stage found' },
        { status: 500 }
      );
    }

    // Get all opportunities in New Lead stage
    const oppData = await searchOpportunities({
      pipelineId: pipeline.pipelineId,
      stageId: newLeadStageId,
    });
    const opportunities = oppData.opportunities || [];

    if (opportunities.length === 0) {
      return NextResponse.json({
        processed: 0,
        smartlead_added: 0,
        dms_queued: 0,
        errors: [],
        colddms_usernames: [],
        colddms_csv: "",
        message: "No leads in New Lead stage",
      });
    }

    const errors: string[] = [];
    const smartleadLeads = new Map<string, {
      email: string;
      first_name: string;
    }>();
    const coldDmsRows: ColdDmsRow[] = [];
    let processed = 0;

    for (const opp of opportunities) {
      try {
        const contactId = opp.contact?.id || opp.contactId;
        if (!contactId) {
          errors.push(`Opportunity ${opp.id}: no contact ID`);
          continue;
        }

        // Get contact details
        let contact;
        try {
          const contactData = await getContact(contactId);
          contact = contactData.contact || contactData;
        } catch (e) {
          errors.push(
            `Failed to get contact ${contactId}: ${e instanceof Error ? e.message : "unknown"}`
          );
          continue;
        }

        const email = contact.email;
        const firstName = contact.firstName || contact.first_name || "";
        const lastName = contact.lastName || contact.last_name || "";

        // Get Instagram from notes
        let igUsername: string | null = null;
        try {
          const notesData = await getContactNotes(contactId);
          const notes = notesData.notes || [];
          igUsername = parseInstagramFromNotes(notes);
        } catch {
          // Non-fatal
        }

        // Add to Smartlead if has email
        if (email) {
          smartleadLeads.set(email.trim().toLowerCase(), {
            email: email.trim(),
            first_name: firstName,
          });
        }

        // Add to ColdDMs if has IG
        if (igUsername) {
          const row = buildColdDmsRow({
            username: normalizeInstagramUsername(igUsername),
            firstName,
            lastName,
            email,
          });
          if (row) coldDmsRows.push(row);
        }

        // Move opportunity to Contacted
        try {
          await updateOpportunity(opp.id, {
            pipelineStageId: contactedStageId,
          });
        } catch (e) {
          errors.push(
            `Failed to move opp ${opp.id}: ${e instanceof Error ? e.message : "unknown"}`
          );
        }

        processed++;
      } catch (e) {
        errors.push(
          `Error processing opp ${opp.id}: ${e instanceof Error ? e.message : "unknown"}`
        );
      }
    }

    // Batch add to Smartlead
    let smartleadAdded = 0;
    const smartleadLeadList = Array.from(smartleadLeads.values());
    if (smartleadLeadList.length > 0) {
      try {
        await addLeadsToCampaign(smartleadLeadList);
        smartleadAdded = smartleadLeadList.length;
      } catch (e) {
        errors.push(
          `Smartlead batch add failed: ${e instanceof Error ? e.message : "unknown"}`
        );
        // Still return DMs list even if Smartlead fails
      }
    }

    const mergedColdDmsRows = mergeColdDmsRows(coldDmsRows);

    return NextResponse.json({
      processed,
      smartlead_added: smartleadAdded,
      dms_queued: mergedColdDmsRows.length,
      errors,
      colddms_usernames: mergedColdDmsRows.map((row) => row.username),
      colddms_rows: mergedColdDmsRows,
      colddms_csv: buildColdDmsCsv(mergedColdDmsRows),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
