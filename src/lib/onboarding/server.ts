// Server-only data layer for partner onboarding. Everything goes through
// the Supabase service-role client (tables are RLS-locked). Secrets are
// encrypted on write and decrypted only for authenticated back-office reads.

import { getServiceSupabase } from "@/lib/supabase";
import { encryptSecret, decryptSecret } from "@/lib/onboarding/crypto";
import { clearRegistryCache, slugifyClientName } from "@/lib/registry";
import { buildInstagramSetupToken } from "@/lib/instagram-connections";
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
  const partner = data as OnboardingPartner;

  // Reserve their registry slot right away (status "onboarding" — hidden from
  // tabs) so their client key / IG-connect slug is stable from day one.
  await upsertRegistryClient(partner, "onboarding");

  return partner;
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
  const [steps, progress, { data: creds }, igConnect] = await Promise.all([
    getSteps("client"),
    getProgress(partner.id),
    db
      .from("onboarding_credentials")
      .select("platform")
      .eq("partner_id", partner.id),
    getPartnerIgConnect(partner),
  ]);
  return {
    name: partner.name,
    status: partner.status,
    steps,
    progress,
    savedCredentialPlatforms: (creds ?? []).map((c) => c.platform as string),
    igConnect,
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
        await upsertCredential(partner.id, step.id, platform, {
          username: sub.username,
          secret: sub.secret,
          twofa: sub.twofa,
          notes: sub.notes,
        });
        await markProgress(partner.id, step.id, true, null);
      }
    } else if (step.kind === "meta_token") {
      // Meta (Facebook) API access. Three parts map onto the credential slots:
      //   App ID        -> username (not itself secret)
      //   App Secret    -> secret_encrypted
      //   Access token  -> twofa_encrypted
      const platform =
        (step.meta?.platform as string | undefined) || step.title;
      const hasData =
        (sub.appId && sub.appId.trim()) ||
        (sub.appSecret && sub.appSecret.trim()) ||
        (sub.token && sub.token.trim());
      if (hasData) {
        await upsertCredential(partner.id, step.id, platform, {
          username: sub.appId,
          secret: sub.appSecret,
          twofa: sub.token,
          notes: sub.notes,
        });
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

  // A finished form makes them a live client everywhere.
  if (newStatus === "submitted") {
    await activateClientFromPartner({ ...partner, status: newStatus });
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Client registry propagation — a finished onboarding becomes a live client
// ---------------------------------------------------------------------------

/**
 * Merge an onboarded partner into the ccos_clients registry so they appear
 * across every tab (Sales Hub, Setter Response Time, Ads pickers, …).
 *
 * Runs when the client finishes their welcome form (status → submitted) and
 * when an admin flips status to submitted/complete. Idempotent: re-activates
 * and refreshes contact info on repeat calls. Best-effort — if the registry
 * table doesn't exist yet (migration 052 not applied) this is a silent no-op
 * so onboarding itself never breaks.
 */
/**
 * The registry key this partner uses. Keys follow the existing convention:
 * short key = first name ("tyson"); if another client already owns it, the
 * full slug ("antwan-rarcus"). An existing registry row for this partner
 * always wins so the key stays stable. Works without the registry table too
 * (pure derivation) — needed for IG-connect links pre-migration.
 */
export async function resolvePartnerClientKey(
  partner: Pick<OnboardingPartner, "id" | "name">,
): Promise<{ key: string; manychatKey: string } | null> {
  const slugs = slugifyClientName(partner.name);
  if (!slugs) return null;

  let key = slugs.shortKey;
  try {
    const db = getServiceSupabase();
    const { data: byPartner } = await db
      .from("ccos_clients")
      .select("key, manychat_key")
      .eq("onboarding_partner_id", partner.id)
      .maybeSingle();
    if (byPartner?.key) {
      return {
        key: byPartner.key as string,
        manychatKey: (byPartner.manychat_key as string) || slugs.manychatKey,
      };
    }

    const { data: existing } = await db
      .from("ccos_clients")
      .select("key, onboarding_partner_id")
      .eq("key", key)
      .maybeSingle();
    if (existing && existing.onboarding_partner_id !== partner.id && slugs.fullKey !== key) {
      key = slugs.fullKey;
    }
  } catch {
    // registry table missing — derived keys are still deterministic
  }
  return { key, manychatKey: slugs.manychatKey };
}

/**
 * Upsert this partner into the client registry with the given status.
 * Best-effort — if the registry table doesn't exist yet (migration 052 not
 * applied) this is a silent no-op so onboarding itself never breaks.
 */
async function upsertRegistryClient(
  partner: OnboardingPartner,
  status: "active" | "onboarding",
): Promise<void> {
  try {
    const resolved = await resolvePartnerClientKey(partner);
    if (!resolved) return;
    const db = getServiceSupabase();
    const { error } = await db.from("ccos_clients").upsert(
      {
        key: resolved.key,
        name: partner.name,
        manychat_key: resolved.manychatKey,
        ig_handle: partner.handle,
        email: partner.email,
        status,
        onboarding_partner_id: partner.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw error;
    clearRegistryCache();
  } catch (err) {
    console.error("[onboarding] client registry merge skipped:", err);
  }
}

export async function activateClientFromPartner(partner: OnboardingPartner): Promise<void> {
  await upsertRegistryClient(partner, "active");
}

/**
 * The partner's personal Instagram-connect info: their tokenized setup link
 * (same flow as the Tyson/Antwan links) + live connection status. Null only
 * if the name can't be slugged or the signing secret is missing.
 */
export async function getPartnerIgConnect(
  partner: Pick<OnboardingPartner, "id" | "name">,
): Promise<{ url: string; connected: boolean; username: string | null } | null> {
  try {
    const resolved = await resolvePartnerClientKey(partner);
    if (!resolved) return null;
    const token = buildInstagramSetupToken({ client: resolved.key, daysValid: 60 });
    const url = `/connect/instagram/${resolved.key}?token=${encodeURIComponent(token)}`;

    let connected = false;
    let username: string | null = null;
    try {
      const db = getServiceSupabase();
      const { data } = await db
        .from("instagram_connections")
        .select("status, instagram_username, instagram_user_id")
        .eq("client_slug", resolved.key)
        .limit(1);
      const row = data?.[0];
      connected = row?.status === "connected" && Boolean(row?.instagram_user_id);
      username = (row?.instagram_username as string) ?? null;
    } catch {
      // connections table unreachable — link still works
    }
    return { url, connected, username };
  } catch (err) {
    console.error("[onboarding] IG connect link unavailable:", err);
    return null;
  }
}

/**
 * Clean up the registry entry when its onboarding record is deleted:
 * a client who was live gets retired (history stays labelled); a stub that
 * never got past onboarding is removed entirely.
 */
async function retireClientForPartner(partnerId: string): Promise<void> {
  try {
    const db = getServiceSupabase();
    await db
      .from("ccos_clients")
      .delete()
      .eq("onboarding_partner_id", partnerId)
      .eq("status", "onboarding");
    await db
      .from("ccos_clients")
      .update({ status: "retired", updated_at: new Date().toISOString() })
      .eq("onboarding_partner_id", partnerId);
    clearRegistryCache();
  } catch {
    // Registry table missing — nothing to retire.
  }
}

/**
 * Save a credential for (partner, platform), merging with anything already on
 * file. Empty incoming fields are LEFT ALONE rather than overwritten with null.
 *
 * This is what makes background auto-save safe: the partner's secret/token
 * fields come back blank after they navigate to another step (we never send
 * secrets back to the browser), so a later auto-save could otherwise wipe a
 * value they already saved. Merging means only the fields they actually typed
 * get written.
 */
async function upsertCredential(
  partnerId: string,
  stepId: string,
  platform: string,
  incoming: {
    username?: string;
    secret?: string;
    twofa?: string;
    notes?: string;
  }
): Promise<void> {
  const db = getServiceSupabase();
  const { data: existing } = await db
    .from("onboarding_credentials")
    .select("username, secret_encrypted, twofa_encrypted, notes")
    .eq("partner_id", partnerId)
    .eq("platform", platform)
    .maybeSingle();

  const username = incoming.username?.trim();
  const secret = incoming.secret?.trim();
  const twofa = incoming.twofa?.trim();
  const notes = incoming.notes?.trim();

  await db.from("onboarding_credentials").upsert(
    {
      partner_id: partnerId,
      step_id: stepId,
      platform,
      username: username || (existing?.username as string | null) || null,
      secret_encrypted: secret
        ? encryptSecret(secret)
        : (existing?.secret_encrypted as string | null) ?? null,
      twofa_encrypted: twofa
        ? encryptSecret(twofa)
        : (existing?.twofa_encrypted as string | null) ?? null,
      notes: notes || (existing?.notes as string | null) || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "partner_id,platform" }
  );
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

  const [progress, { data: credRows }, igConnect] = await Promise.all([
    getProgress(id),
    db
      .from("onboarding_credentials")
      .select("id, step_id, platform, username, secret_encrypted, twofa_encrypted, notes")
      .eq("partner_id", id),
    getPartnerIgConnect(partner as OnboardingPartner),
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

  return { ...(partner as OnboardingPartner), progress, credentials, igConnect };
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

  // Admin moving them to submitted/complete also makes them a live client.
  if (patch.status === "submitted" || patch.status === "complete") {
    const { data } = await db
      .from("onboarding_partners")
      .select(PARTNER_COLS)
      .eq("id", id)
      .maybeSingle();
    if (data) await activateClientFromPartner(data as OnboardingPartner);
  }
}

export async function deletePartner(id: string): Promise<void> {
  const db = getServiceSupabase();
  const { error } = await db.from("onboarding_partners").delete().eq("id", id);
  if (error) throw error;
  await retireClientForPartner(id);
}
