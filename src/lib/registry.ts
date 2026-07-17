// ─────────────────────────────────────────────────────────────────────────
// Registry — the ONE place tabs ask "which clients do we work with?" and
// "who is on the team?".
//
// Backed by two Supabase tables (052_client_and_team_registry.sql):
//   * ccos_clients — creators/clients. Rows are added automatically when a
//     client-onboarding submission completes, or from the onboarding tab.
//   * team_members — closers/setters/coaches, added from Settings.
//
// Every read falls back to the static defaults below (today's roster) if the
// tables don't exist yet or the query fails, so nothing breaks before the
// migration is applied. Results are cached for 60s per server instance.
//
// Server-only (service-role Supabase). Client components go through
// /api/clients and /api/team-members instead.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS } from "@/lib/creators";

export interface RegistryClient {
  /** Short key used across the pipeline (e.g. "tyson"). */
  key: string;
  name: string;
  /** Long-form ManyChat/DM key (e.g. "tyson_sonnek"). */
  manychatKey: string;
  igHandle: string | null;
  email: string | null;
  timezone: string;
  status: "active" | "retired";
  /** The onboarding record that created this client, if any. */
  onboardingPartnerId: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  /** Lowercase spellings seen in sheets/ManyChat (e.g. kelchi → Kelechi). */
  aliases: string[];
  jobRole: "closer" | "setter" | "coach";
  email: string | null;
  clientKey: string;
  isActive: boolean;
}

// Long-form ManyChat keys for the static creators (mirrors ghl-dm-sync's
// CLIENT_LABELS) so the fallback matches what the DB seed contains.
const STATIC_MANYCHAT_KEYS: Record<string, string> = {
  tyson: "tyson_sonnek",
  keith: "keith_holland",
  lucy: "lucy_hubbard",
  antwan: "antwan_rarcus",
};

/** Today's active clients — used until ccos_clients exists. */
const FALLBACK_CLIENTS: RegistryClient[] = ACTIVE_CREATORS.map((c) => ({
  key: c.key,
  name: c.name,
  manychatKey: STATIC_MANYCHAT_KEYS[c.key] ?? c.key,
  igHandle: null,
  email: null,
  timezone: c.timezone,
  status: "active" as const,
  onboardingPartnerId: null,
}));

/** Today's team roster — used until team_members exists. */
const FALLBACK_TEAM: TeamMember[] = [
  { name: "Will", aliases: ["will", "rincan"], jobRole: "closer" },
  { name: "Jacob", aliases: ["jacob", "broz"], jobRole: "closer" },
  { name: "Austin", aliases: ["austin"], jobRole: "closer" },
  { name: "Amara", aliases: ["amara"], jobRole: "setter" },
  { name: "Kelechi", aliases: ["kelechi", "kelchi", "kelz"], jobRole: "setter" },
  { name: "Debbie", aliases: ["debbie", "debby", "chidiebere", "nwosu"], jobRole: "setter" },
  { name: "Gideon", aliases: ["gideon"], jobRole: "setter" },
  { name: "Erin", aliases: ["erin"], jobRole: "setter" },
].map((m, i) => ({
  id: `fallback-${i}`,
  email: null,
  clientKey: "tyson",
  isActive: true,
  ...m,
})) as TeamMember[];

const CACHE_TTL_MS = 60_000;
let clientsCache: { at: number; value: RegistryClient[] } | null = null;
let teamCache: { at: number; value: TeamMember[] } | null = null;

/** Test hook / post-write invalidation. */
export function clearRegistryCache(): void {
  clientsCache = null;
  teamCache = null;
}

/**
 * All registry clients (active + retired). Falls back to the static creator
 * list when the table is missing/unreachable.
 */
export async function getRegistryClients(): Promise<RegistryClient[]> {
  if (clientsCache && Date.now() - clientsCache.at < CACHE_TTL_MS) {
    return clientsCache.value;
  }
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("ccos_clients")
      .select("key, name, manychat_key, ig_handle, email, timezone, status, onboarding_partner_id")
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) return FALLBACK_CLIENTS;
    const value: RegistryClient[] = data.map((r) => ({
      key: r.key as string,
      name: r.name as string,
      manychatKey: (r.manychat_key as string) || (r.key as string),
      igHandle: (r.ig_handle as string) ?? null,
      email: (r.email as string) ?? null,
      timezone: (r.timezone as string) || "America/New_York",
      status: r.status === "retired" ? "retired" : "active",
      onboardingPartnerId: (r.onboarding_partner_id as string) ?? null,
    }));
    clientsCache = { at: Date.now(), value };
    return value;
  } catch {
    return FALLBACK_CLIENTS;
  }
}

/** Only the clients we currently work with — what tabs should show. */
export async function getActiveClients(): Promise<RegistryClient[]> {
  return (await getRegistryClients()).filter((c) => c.status === "active");
}

/**
 * Team directory (active members). Falls back to the static roster when the
 * table is missing/unreachable.
 */
export async function getTeamMembers(
  jobRole?: TeamMember["jobRole"],
): Promise<TeamMember[]> {
  let members: TeamMember[];
  if (teamCache && Date.now() - teamCache.at < CACHE_TTL_MS) {
    members = teamCache.value;
  } else {
    try {
      const sb = getServiceSupabase();
      const { data, error } = await sb
        .from("team_members")
        .select("id, name, aliases, job_role, email, client_key, is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (!data || data.length === 0) {
        members = FALLBACK_TEAM;
      } else {
        members = data.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          aliases: (r.aliases as string[]) ?? [],
          jobRole: r.job_role as TeamMember["jobRole"],
          email: (r.email as string) ?? null,
          clientKey: (r.client_key as string) || "tyson",
          isActive: r.is_active !== false,
        }));
        teamCache = { at: Date.now(), value: members };
      }
    } catch {
      members = FALLBACK_TEAM;
    }
  }
  return jobRole ? members.filter((m) => m.jobRole === jobRole) : members;
}

/**
 * alias → display-name map for setters (superset of the old hardcoded
 * SETTER_LABELS maps). Keys are lowercase.
 */
export async function getSetterLabelMap(): Promise<Record<string, string>> {
  const setters = await getTeamMembers("setter");
  const map: Record<string, string> = {};
  for (const s of setters) {
    map[s.name.toLowerCase()] = s.name;
    for (const alias of s.aliases) map[alias.toLowerCase()] = s.name;
  }
  return map;
}

/** Closer display names (e.g. for briefs and call review). */
export async function getCloserNames(): Promise<string[]> {
  return (await getTeamMembers("closer")).map((m) => m.name);
}

/** Setter display names. */
export async function getSetterNames(): Promise<string[]> {
  return (await getTeamMembers("setter")).map((m) => m.name);
}
