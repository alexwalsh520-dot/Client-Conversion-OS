import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { externalKeyOk } from "@/lib/external/auth";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentPlaybook } from "@/lib/buyer-dna/playbook";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The external worker publishes a new playbook version. It lands as the next content_playbooks
// version (origin 'external'), which the internal staleness logic already treats as fresh — so CCOS
// won't regenerate over it. PlaybookView renders the new sections (buyer language, filming concepts)
// and maps hooks/actions onto the existing sections; old-shape versions are untouched.
// Auth: X-External-Key ONLY.
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.filter(Boolean) : []);

export async function POST(req: NextRequest) {
  if (!externalKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const sections = (body?.sections || {}) as Record<string, unknown>;

  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown or inactive creator" }, { status: 400 });
  }

  const playbook = {
    origin: "external",
    hooks: arr(sections.hooks),
    actions: arr(sections.actions),
    buyer_language: arr(sections.buyer_language),
    filming_concepts: arr(sections.filming_concepts),
  };
  if (!playbook.hooks.length && !playbook.actions.length && !playbook.buyer_language.length && !playbook.filming_concepts.length) {
    return NextResponse.json({ error: "No sections provided" }, { status: 422 });
  }

  const sb = getServiceSupabase();
  const [current, icpRow] = await Promise.all([getCurrentPlaybook(sb, creator), getCurrentIcp(sb, creator)]);
  const version = current ? Number(current.version) + 1 : 1;
  const icpVersion = icpRow ? Number((icpRow as { version: number }).version) : null;

  const { error } = await sb.from("content_playbooks").insert({
    client_key: creator,
    version,
    icp_version: icpVersion,
    trend_version: null,
    playbook,
    model: "external",
    generated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creator, version });
}
