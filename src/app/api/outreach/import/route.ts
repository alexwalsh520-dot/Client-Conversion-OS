import { NextRequest, NextResponse } from "next/server";
import {
  searchDuplicateContact,
  createContact,
  addContactNote,
  createOpportunity,
  getAIOutreachPipeline,
  searchContactOpportunities,
  findStageId,
} from "@/lib/ghl";
import {
  buildColdDmsCsv,
  buildColdDmsRow,
  ColdDmsRow,
  normalizeInstagramUsername,
} from "@/lib/outreach-export";

interface LeadInput {
  first_name: string;
  last_name?: string;
  email?: string;
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
      findStageId(pipeline.stages, ["New Lead", "Lead", "Fresh Leads"]) ||
      Object.values(pipeline.stages)[0];
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
    const colddmsRows: ColdDmsRow[] = [];

    for (const lead of leads) {
      try {
        const email = lead.email?.trim() || "";
        const firstName = lead.first_name?.trim() || "";
        const lastName = lead.last_name?.trim() || "";
        const igUsername = normalizeInstagramUsername(
          lead.instagram_username ||
            (lead.instagram_link
              ? lead.instagram_link.split("/").filter(Boolean).pop()
              : null)
        );
        const igLink =
          lead.instagram_link?.trim() ||
          (igUsername ? `https://instagram.com/${igUsername}` : "");

        if (!email && !igUsername) {
          results.push({
            email: email || "unknown",
            status: "skipped",
            error: "No email or instagram",
          });
          failed++;
          continue;
        }

        let contactId: string | null = null;
        let isNew = true;

        // Check for duplicate if email exists
        if (email) {
          try {
            const dupCheck = await searchDuplicateContact(email);
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

        const contactFirstName = firstName || igUsername || "Instagram Lead";

        // Create new contact if not duplicate
        if (!contactId) {
          const created = await createContact({
            firstName: contactFirstName,
            lastName,
            email: email || undefined,
          });
          contactId = created.contact?.id;
        }

        if (!contactId) {
          results.push({
            email: email || "unknown",
            status: "failed",
            error: "Could not create or find contact",
          });
          failed++;
          continue;
        }

        // Add Instagram note if available
        let coldDmsRow: ColdDmsRow | null = null;
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
          coldDmsRow = buildColdDmsRow({
            username: igUsername,
            firstName: contactFirstName,
            lastName,
            email,
            instagramLink: igLink,
          });
        }

        let hasOutreachOpportunity = false;
        if (!isNew) {
          const existingOpps = await searchContactOpportunities(
            contactId,
            pipeline.pipelineId
          );
          hasOutreachOpportunity = (existingOpps.opportunities || []).length > 0;
        }

        if (!hasOutreachOpportunity) {
          try {
            await createOpportunity({
              pipelineId: pipeline.pipelineId,
              pipelineStageId: newLeadStageId,
              contactId,
              name: `${firstName} ${lastName}`.trim() || igUsername || email || "Lead",
            });
          } catch (e) {
            failed++;
            results.push({
              email: email || "unknown",
              status: "failed",
              contactId,
              error:
                e instanceof Error
                  ? e.message
                  : "Failed to create outreach opportunity",
            });
            continue;
          }
        }

        success++;
        if (coldDmsRow) colddmsRows.push(coldDmsRow);
        results.push({
          email: email || "unknown",
          status: isNew ? "created" : hasOutreachOpportunity ? "existing" : "existing_added_to_pipeline",
          contactId,
        });
      } catch (e: unknown) {
        failed++;
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({
          email: lead.email?.trim() || "unknown",
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
      colddms_usernames: colddmsRows.map((row) => row.username),
      colddms_rows: colddmsRows,
      colddms_csv: buildColdDmsCsv(colddmsRows),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
