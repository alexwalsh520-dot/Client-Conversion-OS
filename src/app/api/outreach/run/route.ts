import { NextRequest, NextResponse } from "next/server";
import {
  getAIOutreachPipeline,
  searchOpportunities,
  getContact,
  getContactNotes,
  updateOpportunity,
  findStageId,
  searchContactOpportunities,
} from "@/lib/ghl";
import { addLeadsToCampaign } from "@/lib/smartlead";
import {
  buildColdDmsCsv,
  buildColdDmsRow,
  ColdDmsRow,
  mergeColdDmsRows,
  normalizeInstagramUsername,
} from "@/lib/outreach-export";

export const maxDuration = 300;

const RUN_CONCURRENCY = 8;
const FALLBACK_CONTACT_LIMIT = 100;

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

function getOpportunityStageId(opp: {
  pipelineStageId?: string;
  pipelineStage?: { id?: string };
  stageId?: string;
}) {
  return opp.pipelineStageId || opp.pipelineStage?.id || opp.stageId || null;
}

function getOpportunityContactId(opp: {
  contact?: { id?: string };
  contactId?: string;
}) {
  return opp.contact?.id || opp.contactId || null;
}

function dedupeContactIds(contactIds: string[]) {
  return Array.from(
    new Set(contactIds.map((contactId) => contactId.trim()).filter(Boolean))
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

interface RunRequestBody {
  contactIds?: string[];
  limit?: number;
  pipeline?: {
    pipelineId?: string;
    stageMap?: Record<string, string>;
    newLeadStageId?: string | null;
    contactedStageId?: string | null;
  };
}

interface ProcessedContact {
  processed: boolean;
  error?: string;
  smartleadLead?: {
    email: string;
    first_name: string;
  };
  coldDmsRow?: ColdDmsRow | null;
}

export async function POST(req: NextRequest) {
  try {
    let body: RunRequestBody = {};
    try {
      body = await req.json();
    } catch {
      // Allow empty body for manual or legacy calls.
    }

    const pipeline =
      body.pipeline?.pipelineId && body.pipeline.stageMap
        ? {
            pipelineId: body.pipeline.pipelineId,
            stages: body.pipeline.stageMap,
          }
        : await getAIOutreachPipeline();
    const newLeadStageId =
      body.pipeline?.newLeadStageId ||
      findStageId(pipeline.stages, [
        "New Lead",
        "Lead",
        "Fresh Leads",
      ]);
    const contactedStageId =
      body.pipeline?.contactedStageId ||
      findStageId(pipeline.stages, [
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

    let contactIds = dedupeContactIds(body.contactIds || []);

    if (contactIds.length === 0) {
      const oppData = await searchOpportunities({
        pipelineId: pipeline.pipelineId,
        stageId: newLeadStageId,
        limit: body.limit || FALLBACK_CONTACT_LIMIT,
      });
      const opportunities = oppData.opportunities || [];
      contactIds = dedupeContactIds(
        opportunities
          .map(getOpportunityContactId)
          .filter(
            (contactId: string | null): contactId is string => Boolean(contactId)
          )
      );
    }

    if (contactIds.length === 0) {
      return NextResponse.json({
        processed: 0,
        smartlead_added: 0,
        dms_queued: 0,
        errors: [],
        colddms_usernames: [],
        colddms_csv: "",
        message: "No leads ready to run",
      });
    }

    const processedContacts = await mapWithConcurrency<string, ProcessedContact>(
      contactIds,
      RUN_CONCURRENCY,
      async (contactId) => {
        try {
          const contactData = await getContact(contactId);
          const contact = contactData.contact || contactData;
          const email = contact.email;
          const firstName = contact.firstName || contact.first_name || "";
          const lastName = contact.lastName || contact.last_name || "";

          let igUsername: string | null = null;
          try {
            const notesData = await getContactNotes(contactId);
            const notes = notesData.notes || [];
            igUsername = parseInstagramFromNotes(notes);
          } catch {
            // Non-fatal
          }

          const oppData = await searchContactOpportunities(
            contactId,
            pipeline.pipelineId
          );
          const opportunities = oppData.opportunities || [];
          if (opportunities.length === 0) {
            return {
              processed: false,
              error: `Contact ${contactId}: no AI Outreach opportunity found`,
            };
          }

          const newLeadOpportunity = opportunities.find(
            (opp: {
              pipelineStageId?: string;
              pipelineStage?: { id?: string };
              stageId?: string;
            }) => getOpportunityStageId(opp) === newLeadStageId
          );

          if (newLeadOpportunity) {
            await updateOpportunity(newLeadOpportunity.id, {
              pipelineStageId: contactedStageId,
            });
          }

          return {
            processed: true,
            smartleadLead: email
              ? {
                  email: email.trim(),
                  first_name: firstName,
                }
              : undefined,
            coldDmsRow: igUsername
              ? buildColdDmsRow({
                  username: normalizeInstagramUsername(igUsername),
                  firstName,
                  lastName,
                  email,
                })
              : null,
          };
        } catch (e) {
          return {
            processed: false,
            error: `Contact ${contactId}: ${e instanceof Error ? e.message : "unknown"}`,
          };
        }
      }
    );

    const errors: string[] = [];
    const smartleadLeads = new Map<
      string,
      {
        email: string;
        first_name: string;
      }
    >();
    const coldDmsRows: ColdDmsRow[] = [];
    let processed = 0;

    for (const processedContact of processedContacts) {
      if (processedContact.error) errors.push(processedContact.error);
      if (processedContact.processed) processed++;
      if (processedContact.smartleadLead) {
        smartleadLeads.set(
          processedContact.smartleadLead.email.trim().toLowerCase(),
          processedContact.smartleadLead
        );
      }
      if (processedContact.coldDmsRow) {
        coldDmsRows.push(processedContact.coldDmsRow);
      }
    }

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
