import { NextRequest, NextResponse } from "next/server";
import {
  searchDuplicateContact,
  createContact,
  addContactNote,
  createOpportunity,
  getAIOutreachPipeline,
} from "@/lib/ghl";

interface LeadInput {
  first_name: string;
  last_name?: string;
  email: string;
  instagram_username?: string;
  instagram_link?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const leads: LeadInput[] = body.leads || [];

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No leads provided" },
        { status: 400 }
      );
    }

    // Get pipeline info once
    const pipeline = await getAIOutreachPipeline();
    const newLeadStageId =
      pipeline.stages["New Lead"] || Object.values(pipeline.stages)[0];
    if (!newLeadStageId) {
      return NextResponse.json(
        { error: 'No "New Lead" stage found in pipeline' },
        { status: 500 }
      );
    }

    let success = 0;
    let failed = 0;
    let alreadyExisted = 0;
    const results: {
      email: string;
      status: string;
      contactId?: string;
      error?: string;
    }[] = [];
    const colddmsUsernames: string[] = [];

    for (const lead of leads) {
      try {
        if (!lead.email && !lead.instagram_username) {
          results.push({
            email: lead.email || "unknown",
            status: "skipped",
            error: "No email or instagram",
          });
          failed++;
          continue;
        }

        let contactId: string | null = null;
        let isNew = true;

        // Check for duplicate if email exists
        if (lead.email) {
          try {
            const dupCheck = await searchDuplicateContact(lead.email);
            const existing = dupCheck.contact;
            if (existing && existing.id) {
              contactId = existing.id;
              isNew = false;
              alreadyExisted++;
            }
          } catch {
            // Not found, will create new
          }
        }

        // Create new contact if not duplicate
        if (!contactId && lead.email) {
          const created = await createContact({
            firstName: lead.first_name,
            lastName: lead.last_name,
            email: lead.email,
          });
          contactId = created.contact?.id;
        }

        if (!contactId) {
          results.push({
            email: lead.email || "unknown",
            status: "failed",
            error: "Could not create or find contact",
          });
          failed++;
          continue;
        }

        // Add Instagram note if available
        const igUsername =
          lead.instagram_username ||
          (lead.instagram_link
            ? lead.instagram_link.split("/").filter(Boolean).pop()
            : null);
        const igLink =
          lead.instagram_link ||
          (igUsername ? `https://instagram.com/${igUsername}` : null);

        if (igUsername) {
          try {
            await addContactNote(
              contactId,
              `IG - @${igUsername}\nIG Link - ${igLink}`
            );
          } catch (e) {
            // Non-fatal: note failed but continue
            console.error("Failed to add IG note:", e);
          }
          colddmsUsernames.push(igUsername.replace(/^@/, ""));
        }

        // Create opportunity (only for new contacts)
        if (isNew) {
          try {
            await createOpportunity({
              pipelineId: pipeline.pipelineId,
              pipelineStageId: newLeadStageId,
              contactId,
              name: `${lead.first_name} ${lead.last_name || ""}`.trim(),
            });
          } catch (e) {
            console.error("Failed to create opportunity:", e);
          }
        }

        success++;
        results.push({
          email: lead.email,
          status: isNew ? "created" : "existing",
          contactId,
        });
      } catch (e: unknown) {
        failed++;
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({
          email: lead.email || "unknown",
          status: "failed",
          error: msg,
        });
      }
    }

    return NextResponse.json({
      success,
      failed,
      already_existed: alreadyExisted,
      total: leads.length,
      results,
      colddms_usernames: colddmsUsernames,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
