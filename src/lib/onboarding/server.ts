// Server-only data layer for partner onboarding. Everything goes through
// the Supabase service-role client (tables are RLS-locked). Secrets are
// encrypted on write and decrypted only for authenticated back-office reads.

import { getServiceSupabase } from "@/lib/supabase";
import { encryptSecret, decryptSecret } from "@/lib/onboarding/crypto";
import type {
  OnboardingPartner,
  OnboardingStep,
  StepProgress,
  PartnerCredential,
  PublicPartnerView,
  PartnerDetail,
  PartnerListItem,
  PublicStepSubmission,
  StepAudience,
} from "@/lib/onboarding/types";

const PARTNER_COLS = "id, token, name, handle, email, status, created_at, updated_at";

// ---------------------------------------------------------------------------
// Steps (checklist template)
// ---------------------------------------------------------------------------

export async function getSteps(audience?: StepAudience): Promise<OnboardingStep[]> {
  const db = getServiceSupabase();
  let q = db.from("onboarding_steps").select("*").eq("active", true);
  if (audience) q = q.eq("audience", audience);
  const { data, error } = await q.order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OnboardingStep[];
}

export async function getAllSteps(): Promise<OnboardingStep[]> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("onboarding_steps")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OnboardingStep[];
}

export async function createStep(
  input: Partial<OnboardingStep> & { title: string }
): Promise<OnboardingStep> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("onboarding_steps")
    .insert({
      title: input.title,
      description: input.description ?? null,
      audience: input.audience ?? "client",
      kind: input.kind ?? "task",
      sort_order: input.sort_order ?? 999,
      sop_slug: input.sop_slug ?? null,
      sop_url: input.sop_url ?? null,
      meta: input.meta ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as OnboardingStep;
}

export async function updateStep(
  id: string,
  patch: Partial<OnboardingStep>
): Promise<void> {
  const db = getServiceSupabase();
  const allowed: Record<string, unknown> = {};
  for (const k of [
    "title",
    "description",
    "audience",
    "kind",
    "sort_order",
    "sop_slug",
    "sop_url",
    "meta",
    "active",
  ] as const) {
    if (k in patch) allowed[k] = (patch as Record<string, unknown>)[k];
  }
  const { error } = await db.from("onboarding_steps").update(allowed).eq("id", id);
  if (error) throw error;
}

export async function deleteStep(id: string): Promise<void> {
  const db = getServiceSupabase();
  // Soft-delete: deactivate so existing partner progress/history is kept.
  const { error } = await db
    .from("onboarding_steps")
    .update({ active: false })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export async function createPartner(input: {
  name: string;
  handle?: string | null;
  email?: string | null;
}): Promise<OnboardingPartner> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("onboarding_partners")
    .insert({
      name: input.name,
      handle: input.handle ?? null,
      email: input.email ?? null,
    })
    .select(PARTNER_COLS)
    .single();
  if (error) throw error;
  return data as OnboardingPartner;
}

export async function listPartners(): Promise<PartnerListItem[]> {
  const db = getServiceSupabase();
  const [{ data: partners, error: pErr }, steps, { data: progress, error: prErr }] =
    await Promise.all([
      db.from("onboarding_partners").select(PARTNER_COLS).order("created_at", {
        ascending: false,
      }),
      getAllSteps(),
      db.from("onboarding_step_progress").select("partner_id, step_id, completed"),
    ]);
  if (pErr) throw pErr;
  if (prErr) throw prErr;

  const stepAudience = new Map(steps.filter((s) => s.active).map((s) => [s.id, s.audience]));
  const clientTotal = steps.filter((s) => s.active && s.audience === "client").length;
  const internalTotal = steps.filter((s) => s.active && s.audience === "internal").length;

  return (partners ?? []).map((p) => {
    const rows = (progress ?? []).filter((r) => r.partner_id === p.id && r.completed);
    let clientDone = 0;
    let internalDone = 0;
    for (const r of rows) {
      const aud = stepAudience.get(r.step_id);
      if (aud === "client") clientDone++;
      else if (aud === "internal") internalDone++;
    }
    return {
      ...(p as OnboardingPartner),
      clientStepsTotal: clientTotal,
      clientStepsDone: clientDone,
      internalStepsTotal: internalTotal,
      internalStepsDone: internalDone,
    };
  });
}

async function getPartnerByToken(token: string): Promise<OnboardingPartner | null> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("onboarding_partners")
    .select(PARTNER_COLS)
    .eq("token", token)
    .maybeSingle();
  return (data as OnboardingPartner) ?? null;
}

async function getProgress(partnerId: string): Promise<StepProgress[]> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("onboarding_step_progress")
    .select("step_id, completed, value, completed_at")
    .eq("partner_id", partnerId);
  return (data ?? []) as StepProgress[];
}

// ---------------------------------------------------------------------------
// Public welcome page
// ---------------------------------------------------------------------------

export async function getPublicView(token: string): Promise<PublicPartnerView | null> {
  const partner = await getPartnerByToken(token);
  if (!partner) return null;
  const db = getServiceSupabase();
  const [steps, progress, { data: creds }] = await Promise.all([
    getSteps("client"),
    getProgress(partner.id),
    db
      .from("onboarding_credentials")
      .select("platform")
      .eq("partner_id", partner.id),
  ]);
  return {
    name: partner.name,
    status: partner.status,
    steps,
    progress,
    savedCredentialPlatforms: (creds ?? []).map((c) => c.platform as string),
  };
}

export async function submitPublic(
  token: string,
  submissions: PublicStepSubmission[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const partner = await getPartnerByToken(token);
  if (!partner) return { ok: false, error: "not_found" };

  const db = getServiceSupabase();
  const clientSteps = await getSteps("client");
  const stepById = new Map(clientSteps.map((s) => [s.id, s]));

  for (const sub of submissions) {
    const step = stepById.get(sub.stepId);
    if (!step) continue; // ignore unknown / non-client steps

    if (step.kind === "login" || step.kind === "twofa") {
      const platform =
        (step.meta?.platform as string | undefined) || step.title;
      const hasData =
        (sub.username && sub.username.trim()) ||
        (sub.secret && sub.secret.trim()) ||
        (sub.twofa && sub.twofa.trim());
      if (hasData) {
        await db.from("onboarding_credentials").upsert(
          {
            partner_id: partner.id,
            step_id: step.id,
            platform,
            username: sub.username?.trim() || null,
            secret_encrypted: encryptSecret(sub.secret),
            twofa_encrypted: encryptSecret(sub.twofa),
            notes: sub.notes?.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "partner_id,platform" }
        );
        await markProgress(partner.id, step.id, true, null);
      }
    } else if (step.kind === "link" || step.kind === "text") {
      const value = sub.value?.trim() || null;
      await markProgress(partner.id, step.id, !!value, value);
    } else {
      // bank / task — explicit completion toggle
      await markProgress(partner.id, step.id, !!sub.completed, null);
    }
  }

  // Move status forward once they've started / finished.
  const progress = await getProgress(partner.id);
  const doneClient = progress.filter((p) => p.completed).length;
  const totalClient = clientSteps.length;
  const newStatus =
    doneClient >= totalClient && totalClient > 0
      ? "submitted"
      : doneClient > 0
      ? "in_progress"
      : partner.status;
  await db
    .from("onboarding_partners")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", partner.id);

  return { ok: true };
}

async function markProgress(
  partnerId: string,
  stepId: string,
  completed: boolean,
  value: string | null
): Promise<void> {
  const db = getServiceSupabase();
  await db.from("onboarding_step_progress").upsert(
    {
      partner_id: partnerId,
      step_id: stepId,
      completed,
      value,
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "partner_id,step_id" }
  );
}

// ---------------------------------------------------------------------------
// Back office (admin) — full detail with decrypted credentials
// ---------------------------------------------------------------------------

export async function getPartnerDetail(id: string): Promise<PartnerDetail | null> {
  const db = getServiceSupabase();
  const { data: partner } = await db
    .from("onboarding_partners")
    .select(PARTNER_COLS)
    .eq("id", id)
    .maybeSingle();
  if (!partner) return null;

  const [progress, { data: credRows }] = await Promise.all([
    getProgress(id),
    db
      .from("onboarding_credentials")
      .select("id, step_id, platform, username, secret_encrypted, twofa_encrypted, notes")
      .eq("partner_id", id),
  ]);

  const credentials: PartnerCredential[] = (credRows ?? []).map((c) => ({
    id: c.id as string,
    step_id: (c.step_id as string) ?? null,
    platform: c.platform as string,
    username: (c.username as string) ?? null,
    secret: decryptSecret(c.secret_encrypted as string | null),
    twofa: decryptSecret(c.twofa_encrypted as string | null),
    notes: (c.notes as string) ?? null,
  }));

  return { ...(partner as OnboardingPartner), progress, credentials };
}

/** Admin toggles an internal checklist step for a partner. */
export async function setStepProgressAdmin(
  partnerId: string,
  stepId: string,
  completed: boolean
): Promise<void> {
  await markProgress(partnerId, stepId, completed, null);
}

export async function updatePartner(
  id: string,
  patch: { name?: string; handle?: string | null; email?: string | null; status?: string }
): Promise<void> {
  const db = getServiceSupabase();
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "handle", "email", "status"] as const) {
    if (k in patch) allowed[k] = patch[k];
  }
  const { error } = await db.from("onboarding_partners").update(allowed).eq("id", id);
  if (error) throw error;
}

export async function deletePartner(id: string): Promise<void> {
  const db = getServiceSupabase();
  const { error } = await db.from("onboarding_partners").delete().eq("id", id);
  if (error) throw error;
}
