import { NextRequest, NextResponse } from "next/server";
import {
  searchDuplicateContact,
  createContact,
  addContactTags,
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
import {
  buildSegmentTag,
  getSegmentLabel,
  normalizeSegmentKey,
  summarizeSegments,
} from "@/lib/outreach-segments";

export const maxDuration = 300;

const IMPORT_CONCURRENCY = 6;

interface LeadInput {
  first_name: string;
  last_name?: string;
  email?: string;
  instagram_username?: string;
  instagram_link?: string;
  segment?: string;
}

interface PipelineInput {
  pipelineId?: string;
  stageMap?: Record<string, string>;
  newLeadStageId?: string | null;
}

interface ImportLeadResult {
  email: string;
  status: string;
  contactId?: string;
  error?: string;
}

interface ContactRoute {
  contactId: string;
  segment: string;
  segment_key: string;
  segment_tag: string;
}

interface ProcessedLead {
  success: boolean;
  failed: boolean;
  alreadyExisted: boolean;
  result: ImportLeadResult;
  colddmsRow: ColdDmsRow | null;
  contactId: string | null;
  contactRoute: ContactRoute | null;
  warnings: string[];
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
    const pipelineInput: PipelineInput | undefined = body.pipeline;

    if (leads.length === 0) {
      return NextResponse.json(
        { error: "No leads provided" },
        { status: 400 }
      );
    }

    const pipeline =
      pipelineInput?.pipelineId && pipelineInput.stageMap
        ? {
            pipelineId: pipelineInput.pipelineId,
            stages: pipelineInput.stageMap,
          }
        : await getAIOutreachPipeline();
    const newLeadStageId =
      pipelineInput?.newLeadStageId ||
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
          const segment = getSegmentLabel(lead.segment);
          const segmentKey = normalizeSegmentKey(segment) || "unmapped";
          const segmentTag = buildSegmentTag(segment);

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
              contactRoute: null,
              warnings: [],
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
              tags: [segmentTag],
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
              contactRoute: null,
              warnings: [],
            };
          }

          const warnings: string[] = [];
          if (!isNew) {
            try {
              await addContactTags(contactId, [segmentTag]);
            } catch (e) {
              warnings.push(
                `Contact ${contactId}: GHL segment tag "${segmentTag}" failed: ${
                  e instanceof Error ? e.message : "unknown"
                }`
              );
            }
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
                contactRoute: null,
                warnings,
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
            contactRoute: {
              contactId,
              segment,
              segment_key: segmentKey,
              segment_tag: segmentTag,
            },
            warnings,
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
            contactRoute: null,
            warnings: [],
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
    const contactRoutes = new Map<string, ContactRoute>();
    const warnings: string[] = [];

    for (const processedLead of processedLeads) {
      if (processedLead.success) success++;
      if (processedLead.failed) failed++;
      if (processedLead.alreadyExisted) alreadyExisted++;
      if (processedLead.colddmsRow) colddmsRows.push(processedLead.colddmsRow);
      if (processedLead.contactId) contactIds.add(processedLead.contactId);
      if (processedLead.contactRoute) {
        contactRoutes.set(
          processedLead.contactRoute.contactId,
          processedLead.contactRoute
        );
      }
      warnings.push(...processedLead.warnings);
      results.push(processedLead.result);
    }

    return NextResponse.json({
      success,
      failed,
      already_existed: alreadyExisted,
      total: leads.length,
      results,
      contact_ids: Array.from(contactIds),
      contact_routes: Array.from(contactRoutes.values()),
      segment_counts: summarizeSegments(leads, (lead) => lead.segment),
      warnings,
      colddms_usernames: colddmsRows.map((row) => row.username),
      colddms_rows: colddmsRows,
      colddms_csv: buildColdDmsCsv(colddmsRows),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
