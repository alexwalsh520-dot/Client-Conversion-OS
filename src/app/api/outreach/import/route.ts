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

export const maxDuration = 300;

const IMPORT_CONCURRENCY = 6;

interface LeadInput {
  first_name: string;
  last_name?: string;
  email?: string;
  instagram_username?: string;
  instagram_link?: string;
}

interface ImportLeadResult {
  email: string;
  status: string;
  contactId?: string;
  error?: string;
}

interface ProcessedLead {
  success: boolean;
  failed: boolean;
  alreadyExisted: boolean;
  result: ImportLeadResult;
  colddmsRow: ColdDmsRow | null;
  contactId: string | null;
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

    const processedLeads = await mapWithConcurrency<LeadInput, ProcessedLead>(
      leads,
      IMPORT_CONCURRENCY,
      async (lead) => {
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
            return {
              success: false,
              failed: true,
              alreadyExisted: false,
              result: {
                email: email || "unknown",
                status: "skipped",
                error: "No email or instagram",
              },
              colddmsRow: null,
              contactId: null,
            };
          }

          let contactId: string | null = null;
          let isNew = true;

          if (email) {
            try {
              const dupCheck = await searchDuplicateContact(email);
              const existing = dupCheck.contact;
              if (existing && existing.id) {
                contactId = existing.id;
                isNew = false;
              }
            } catch {
              // Not found, will create new
            }
          }

          const contactFirstName = firstName || igUsername || "Instagram Lead";

          if (!contactId) {
            const created = await createContact({
              firstName: contactFirstName,
              lastName,
              email: email || undefined,
            });
            contactId = created.contact?.id;
          }

          if (!contactId) {
            return {
              success: false,
              failed: true,
              alreadyExisted: false,
              result: {
                email: email || "unknown",
                status: "failed",
                error: "Could not create or find contact",
              },
              colddmsRow: null,
              contactId: null,
            };
          }

          let coldDmsRow: ColdDmsRow | null = null;
          if (igUsername) {
            try {
              await addContactNote(
                contactId,
                `IG - @${igUsername}\nIG Link - ${igLink}`
              );
            } catch (e) {
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
            hasOutreachOpportunity =
              (existingOpps.opportunities || []).length > 0;
          }

          if (!hasOutreachOpportunity) {
            try {
              await createOpportunity({
                pipelineId: pipeline.pipelineId,
                pipelineStageId: newLeadStageId,
                contactId,
                name:
                  `${firstName} ${lastName}`.trim() ||
                  igUsername ||
                  email ||
                  "Lead",
              });
            } catch (e) {
              return {
                success: false,
                failed: true,
                alreadyExisted: !isNew,
                result: {
                  email: email || "unknown",
                  status: "failed",
                  contactId,
                  error:
                    e instanceof Error
                      ? e.message
                      : "Failed to create outreach opportunity",
                },
                colddmsRow: null,
                contactId: null,
              };
            }
          }

          return {
            success: true,
            failed: false,
            alreadyExisted: !isNew,
            result: {
              email: email || "unknown",
              status: isNew
                ? "created"
                : hasOutreachOpportunity
                ? "existing"
                : "existing_added_to_pipeline",
              contactId,
            },
            colddmsRow: coldDmsRow,
            contactId,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          return {
            success: false,
            failed: true,
            alreadyExisted: false,
            result: {
              email: lead.email?.trim() || "unknown",
              status: "failed",
              error: msg,
            },
            colddmsRow: null,
            contactId: null,
          };
        }
      }
    );

    let success = 0;
    let failed = 0;
    let alreadyExisted = 0;
    const results: ImportLeadResult[] = [];
    const colddmsRows: ColdDmsRow[] = [];
    const contactIds = new Set<string>();

    for (const processedLead of processedLeads) {
      if (processedLead.success) success++;
      if (processedLead.failed) failed++;
      if (processedLead.alreadyExisted) alreadyExisted++;
      if (processedLead.colddmsRow) colddmsRows.push(processedLead.colddmsRow);
      if (processedLead.contactId) contactIds.add(processedLead.contactId);
      results.push(processedLead.result);
    }

    return NextResponse.json({
      success,
      failed,
      already_existed: alreadyExisted,
      total: leads.length,
      results,
      contact_ids: Array.from(contactIds),
      colddms_usernames: colddmsRows.map((row) => row.username),
      colddms_rows: colddmsRows,
      colddms_csv: buildColdDmsCsv(colddmsRows),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
