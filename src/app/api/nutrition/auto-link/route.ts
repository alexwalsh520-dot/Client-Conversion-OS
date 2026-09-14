/**
 * POST /api/nutrition/auto-link
 *
 * Scans every unlinked nutrition intake form and links it to a roster client
 * when there is an UNAMBIGUOUS match (exact email or exact full-name, case-
 * insensitive, trimmed) — safe pairings coaches would otherwise link by hand
 * from the Unlinked Intake Forms section of the Nutrition tab.
 *
 * Rules:
 *  - Only forms with no existing client → nutrition_form_id link are eligible.
 *  - Only clients with a NULL nutrition_form_id are eligible targets.
 *  - A form → client pair is auto-linked only if it is the ONLY viable candidate
 *    for that form AND that client (no other unlinked form points to the same
 *    client). Anything ambiguous is skipped and returned in `ambiguous` so the
 *    coach can resolve it manually.
 *  - Nutrition status is set to 'pending' only when it was NULL/empty — never
 *    overwritten. Nothing else on the client row is touched, and the checklist
 *    booleans / completion timestamps are intentionally left alone (fresh
 *    intakes are still pending work, not "historically done").
 *
 * Distinct from the older /api/coaching/link-existing endpoint, which was a
 * one-shot historical backfill that force-marked everything done — that flow
 * is inappropriate for freshly-onboarded clients.
 *
 * Returns:
 *   { linked: [{ clientId, clientName, formId, formName, matchType }],
 *     ambiguous: [{ formId, formName, reason }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

interface UnlinkedForm {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface UnlinkedClient {
  id: number;
  name: string | null;
  email: string | null;
  nutrition_status: string | null;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const fullName = (f: UnlinkedForm) => norm(`${f.first_name ?? ""} ${f.last_name ?? ""}`);

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();

  const [formsRes, clientsRes] = await Promise.all([
    db.from("nutrition_intake_forms").select("id, first_name, last_name, email"),
    db.from("clients").select("id, name, email, nutrition_status, nutrition_form_id"),
  ]);

  if (formsRes.error) {
    return NextResponse.json({ error: formsRes.error.message }, { status: 500 });
  }
  if (clientsRes.error) {
    return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  }

  const linkedFormIds = new Set<number>(
    (clientsRes.data ?? [])
      .map((c) => c.nutrition_form_id as number | null)
      .filter((v): v is number => v != null),
  );

  const unlinkedForms: UnlinkedForm[] = (formsRes.data ?? [])
    .filter((f) => f.id != null && !linkedFormIds.has(f.id as number))
    .map((f) => ({
      id: f.id as number,
      first_name: (f.first_name as string | null) ?? null,
      last_name: (f.last_name as string | null) ?? null,
      email: (f.email as string | null) ?? null,
    }));

  const unlinkedClients: UnlinkedClient[] = (clientsRes.data ?? [])
    .filter((c) => c.nutrition_form_id == null)
    .map((c) => ({
      id: c.id as number,
      name: (c.name as string | null) ?? null,
      email: (c.email as string | null) ?? null,
      nutrition_status: (c.nutrition_status as string | null) ?? null,
    }));

  // Build a preliminary form → candidate-clients map.
  const proposals = new Map<
    number, // formId
    {
      form: UnlinkedForm;
      candidates: { client: UnlinkedClient; matchType: "email+name" | "email" | "name" }[];
    }
  >();

  for (const form of unlinkedForms) {
    const fEmail = norm(form.email);
    const fName = fullName(form);
    if (!fEmail && !fName) continue;

    const candidates: { client: UnlinkedClient; matchType: "email+name" | "email" | "name" }[] = [];
    for (const client of unlinkedClients) {
      const cEmail = norm(client.email);
      const cName = norm(client.name);
      const emailHit = fEmail.length > 0 && cEmail === fEmail;
      const nameHit = fName.length > 0 && cName === fName;
      if (emailHit && nameHit) candidates.push({ client, matchType: "email+name" });
      else if (emailHit) candidates.push({ client, matchType: "email" });
      else if (nameHit) candidates.push({ client, matchType: "name" });
    }

    if (candidates.length > 0) {
      proposals.set(form.id, { form, candidates });
    }
  }

  // Reverse map: which forms point at each candidate client? If two forms
  // both point at the same client, both are ambiguous and neither gets linked
  // automatically — the coach picks.
  const clientProposalCount = new Map<number, number>();
  for (const { candidates } of proposals.values()) {
    for (const c of candidates) {
      clientProposalCount.set(c.client.id, (clientProposalCount.get(c.client.id) ?? 0) + 1);
    }
  }

  const linked: {
    clientId: number;
    clientName: string;
    formId: number;
    formName: string;
    matchType: "email+name" | "email" | "name";
  }[] = [];
  const ambiguous: { formId: number; formName: string; reason: string }[] = [];

  for (const { form, candidates } of proposals.values()) {
    const formLabel = `${form.first_name ?? ""} ${form.last_name ?? ""}`.trim() || form.email || `#${form.id}`;

    if (candidates.length > 1) {
      ambiguous.push({
        formId: form.id,
        formName: formLabel,
        reason: `Matches ${candidates.length} roster clients (${candidates.map((c) => c.client.name ?? "?").join(", ")}). Link manually.`,
      });
      continue;
    }

    const { client, matchType } = candidates[0];
    const contendersForThisClient = clientProposalCount.get(client.id) ?? 0;
    if (contendersForThisClient > 1) {
      ambiguous.push({
        formId: form.id,
        formName: formLabel,
        reason: `Multiple unlinked forms want to link to ${client.name ?? "this client"}. Link manually.`,
      });
      continue;
    }

    // Safe to link.
    const patch: Record<string, unknown> = { nutrition_form_id: form.id };
    if (!client.nutrition_status || client.nutrition_status.trim() === "") {
      patch.nutrition_status = "pending";
    }

    const { error: updateErr } = await db
      .from("clients")
      .update(patch)
      .eq("id", client.id)
      .is("nutrition_form_id", null); // guard: don't clobber a race

    if (updateErr) {
      ambiguous.push({
        formId: form.id,
        formName: formLabel,
        reason: `Update failed: ${updateErr.message}`,
      });
      continue;
    }

    linked.push({
      clientId: client.id,
      clientName: client.name ?? "",
      formId: form.id,
      formName: formLabel,
      matchType,
    });
  }

  return NextResponse.json({ linked, ambiguous });
}
