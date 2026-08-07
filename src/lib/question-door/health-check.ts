// ─────────────────────────────────────────────────────────────────────────
// health_check: is the money actually able to leave the building right now?
//
// THIS IS THE ONE TEMPLATE ALLOWED A LIVE EXTERNAL READ, and the reason is the
// whole point of the question: a campaign stuck in review burns nothing, so it
// writes NO rows. Every other question in this door answers from stored facts
// because stored facts are reproducible. This one cannot, because the failure
// it exists to catch is invisible in the store by construction. A warehouse
// that says "no spend yesterday" cannot tell you whether that is a paused
// campaign, a rejected ad, or a dead token, and those need different responses.
//
// The constraints that keep a live read from becoming a liability:
//
//   * ONE creator failing must not sink the other. Each is fetched and judged
//     in isolation and reports its own outcome.
//   * A wall-clock budget per creator, and exactly one retry. A slow Graph API
//     must never hold the door open.
//   * A rate limit (Meta code 17) means STOP. Not retry, not poll: fall back to
//     the stored picture immediately. Hammering an API that just asked us to
//     back off is how a read-only question earns an account restriction.
//   * On any failure, fall back to the stored picture, mark the live source
//     with no write time so the receipt flags it, and SAY in a caveat that this
//     is the stored picture rather than a live one. A stale answer that looks
//     live is worse than an honest "I could not reach Meta".
//   * A five-minute in-process cache, so an agent asking repeatedly costs one
//     round trip rather than one per ask.
//
// TOKENS ARE NEVER LOGGED, never echoed, and never returned. A failed auth is
// reported as a finding ("this creator's token did not authenticate"), which is
// itself a no-go, without any part of the credential appearing anywhere.
//
// AND NOTHING HERE EXECUTES. Not even to unstick something obviously stuck.
// ─────────────────────────────────────────────────────────────────────────

import { CREATORS_BY_KEY, firstEnv, normalizeAdAccountId } from "@/lib/creators";
import { convertCentsToUsd, creatorCurrency, loadUsdRateMap } from "@/lib/fx/rates";
import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { rejectUnknown, requireAccount } from "./params";
import { loadSignedDefinitions } from "./rulesets";
import type { AsOf, Db, QuestionEntry, TemplateContext } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** The live source's name, so the answer, the freshness list and the receipt
 *  all spell it the same way. */
export const META_LIVE_SOURCE = "meta_graph_live";

/** Per-creator wall-clock budget for the whole live read. */
const LIVE_BUDGET_MS = 8_000;
/** How long a successful live read is reused. */
const CACHE_MS = 5 * 60_000;

type Row = Record<string, unknown>;

interface MetaEntity {
  id: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
  campaign_id?: string;
  adset_id?: string;
  daily_budget?: string;
  issues_info?: Array<{ error_summary?: string; error_message?: string; level?: string }>;
  ad_review_feedback?: Record<string, unknown>;
}

export interface LiveRead {
  ok: boolean;
  campaigns: MetaEntity[];
  adsets: MetaEntity[];
  ads: MetaEntity[];
  /** Set when the live read failed. Plain English, never containing a token. */
  error: string | null;
  /** True when Meta asked us to back off (code 17). We stop rather than poll. */
  rateLimited: boolean;
  /** True when the failure was authentication, which is itself a finding. */
  authFailed: boolean;
  readAt: string;
}

const cache = new Map<string, { at: number; value: LiveRead }>();

/** Only the tests want a cold cache; production never does on purpose. */
export function resetHealthCache(): void {
  cache.clear();
}

/**
 * The Graph fetcher, injectable so the tests can mock Meta being down, rate
 * limiting us, or holding a campaign in review, without touching the network.
 */
export type GraphFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
let graphFetch: GraphFetch = (url, init) => fetch(url, { ...init, cache: "no-store" });

export function setGraphFetch(fn: GraphFetch | null): void {
  graphFetch = fn ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
}

interface GraphError {
  message: string;
  code: number;
  auth: boolean;
}

async function graphPage(path: string, fields: string, token: string, signal: AbortSignal): Promise<MetaEntity[]> {
  const out: MetaEntity[] = [];
  let url: string | undefined = `${GRAPH}/${path}?fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`;
  for (let page = 0; page < 10 && url; page++) {
    const res = await graphFetch(url, { signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let code = 0;
      let message = `Meta returned ${res.status}`;
      try {
        const parsed = JSON.parse(body) as { error?: { code?: number; message?: string; type?: string } };
        code = Number(parsed.error?.code) || 0;
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // A non-JSON error body is reported by status alone. It is never echoed
        // back verbatim, because a Graph error body can repeat the request URL,
        // and the request URL carries the access token.
      }
      const err: GraphError = {
        message,
        code,
        auth: res.status === 401 || code === 190 || code === 102,
      };
      throw err;
    }
    const json = (await res.json()) as { data?: MetaEntity[]; paging?: { next?: string } };
    out.push(...(json.data || []));
    url = json.paging?.next;
  }
  return out;
}

function isGraphError(e: unknown): e is GraphError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

/**
 * One creator's live picture, with its own budget, one retry, and hard-stop on
 * a rate limit. Never throws: a creator that could not be read comes back with
 * ok:false so the OTHER creator's answer is unaffected.
 */
export async function readLive(client: string, now: Date): Promise<LiveRead> {
  const hit = cache.get(client);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;

  const creator = CREATORS_BY_KEY[client as keyof typeof CREATORS_BY_KEY];
  const empty = (error: string | null, opts: { rateLimited?: boolean; authFailed?: boolean } = {}): LiveRead => ({
    ok: false,
    campaigns: [],
    adsets: [],
    ads: [],
    error,
    rateLimited: Boolean(opts.rateLimited),
    authFailed: Boolean(opts.authFailed),
    readAt: now.toISOString(),
  });
  if (!creator) return empty(`${client} is not a creator this build has Meta credentials plumbing for.`);

  const token = firstEnv(creator.tokenEnv);
  const accountRaw = firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId;
  if (!token || !accountRaw) {
    return empty(
      `no Meta ${!token ? "access token" : "ad account id"} is configured for ${client} in this environment, so the live check could not run for them.`,
    );
  }
  const account = normalizeAdAccountId(accountRaw);

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_BUDGET_MS);
    try {
      const [campaigns, adsets, ads] = await Promise.all([
        graphPage(`${account}/campaigns`, "id,name,effective_status,configured_status,issues_info", token, controller.signal),
        graphPage(
          `${account}/adsets`,
          "id,name,effective_status,configured_status,campaign_id,daily_budget,issues_info",
          token,
          controller.signal,
        ),
        graphPage(
          `${account}/ads`,
          "id,name,effective_status,configured_status,adset_id,campaign_id,ad_review_feedback",
          token,
          controller.signal,
        ),
      ]);
      const value: LiveRead = {
        ok: true,
        campaigns,
        adsets,
        ads,
        error: null,
        rateLimited: false,
        authFailed: false,
        readAt: now.toISOString(),
      };
      cache.set(client, { at: now.getTime(), value });
      return value;
    } catch (e) {
      if (isGraphError(e) && e.code === 17) {
        // BACKPRESSURE. Meta asked us to stop. We stop: no retry, no poll, and
        // the stored picture answers instead. A read-only question is not worth
        // an account restriction.
        return empty(
          "Meta rate-limited this read (code 17). The live check stopped immediately rather than retrying, and the stored picture is being reported instead.",
          { rateLimited: true },
        );
      }
      if (isGraphError(e) && e.auth) {
        return empty(
          `Meta did not accept ${client}'s access token. This is itself a finding: while it holds, nothing can be read or changed for this creator.`,
          { authFailed: true },
        );
      }
      if (attempt === 1) {
        const msg = isGraphError(e) ? e.message : e instanceof Error ? e.message : String(e);
        return empty(`the live Meta read failed twice for ${client}: ${msg}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return empty(`the live Meta read did not complete for ${client}.`);
}

// ─────────────────────────────────────────────────────────────────────────
// THE STORED FALLBACK.
// ─────────────────────────────────────────────────────────────────────────

interface StoredPicture {
  campaignStatus: Map<string, { status: string | null; name: string | null }>;
  adStatus: Map<string, { status: string | null; campaign_id: string | null; adset_id: string | null }>;
  asOfDay: string | null;
}

async function storedPicture(db: Db, clients: readonly string[], to: string): Promise<StoredPicture> {
  const { data, error } = await db
    .from("ads_meta_insights_daily")
    .select("campaign_id, campaign_name, campaign_effective_status, ad_id, ad_effective_status, adset_id, date")
    .in("client_key", [...clients])
    .gte("date", shiftDay(to, -7))
    .lte("date", to)
    .order("date", { ascending: true });
  if (error) throw new Error(`could not read the stored status picture: ${error.message}`);
  const campaignStatus = new Map<string, { status: string | null; name: string | null }>();
  const adStatus = new Map<string, { status: string | null; campaign_id: string | null; adset_id: string | null }>();
  let asOfDay: string | null = null;
  for (const r of (data || []) as Row[]) {
    // Ordered oldest first, so the last write for an id wins: the newest one.
    const day = String(r.date);
    if (!asOfDay || day > asOfDay) asOfDay = day;
    if (r.campaign_id) {
      campaignStatus.set(String(r.campaign_id), {
        status: (r.campaign_effective_status as string) ?? null,
        name: (r.campaign_name as string) ?? null,
      });
    }
    if (r.ad_id) {
      adStatus.set(String(r.ad_id), {
        status: (r.ad_effective_status as string) ?? null,
        campaign_id: (r.campaign_id as string) ?? null,
        adset_id: (r.adset_id as string) ?? null,
      });
    }
  }
  return { campaignStatus, adStatus, asOfDay };
}

// ─────────────────────────────────────────────────────────────────────────
// JUDGING ONE CREATOR.
// ─────────────────────────────────────────────────────────────────────────

function bucketOf(status: string | null | undefined): string {
  const s = (status || "").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "PAUSED" || s === "ADSET_PAUSED" || s === "CAMPAIGN_PAUSED") return "paused";
  if (s === "PENDING_REVIEW" || s === "IN_REVIEW" || s === "PENDING_BILLING_INFO") return "in_review";
  if (s === "DISAPPROVED" || s === "REJECTED") return "rejected";
  if (s === "WITH_ISSUES" || s === "RESTRICTED" || s === "CAMPAIGN_GROUP_PAUSED") return "restricted";
  return "other";
}

interface CampaignVerdict {
  campaign_id: string;
  campaign_name_verbatim: string | null;
  go_no_go: "go" | "no_go";
  reasons: string[];
  counts: Record<string, number>;
}

export const health_check: QuestionEntry = {
  key: "health_check",
  description:
    "Whether each active creator's ads can actually deliver right now: a live read of Meta's own campaign, ad set and ad statuses, with a go or no-go per campaign and the reason, the live budget dials and their daily total, and yesterday's real spend against what those dials expected. This is the one question that reads Meta directly, because a campaign stuck in review burns nothing and therefore writes no rows for the warehouse to see.",
  params: "client (tyson, jake, or all). Nothing else.",
  sources: [META_LIVE_SOURCE, "ads_meta_insights_daily", "adsv2_budget_snapshots"],
  freshnessSources: [META_LIVE_SOURCE, "adsv2_budget_snapshots"],
  budgetMs: 45_000,
  // Version 1. Delivery health touches no sale row at all, so its coverage is
  // null with a note rather than an empty block pretending to be a measurement.
  receipt: {
    version: 1,
    windowKind: null,
    money: false,
    usesDataVersion: false,
    exclusions: [
      {
        what: "any statement about performance",
        count: 0,
        why:
          "this question answers whether the ads can DELIVER, not whether they are working. A campaign can be perfectly healthy and losing money, and this answer would call it a go. Ask kill_scale_read for the money.",
      },
    ],
    definitionsCited: ["touch_floor_72h", "structure_rules"],
  },
  async run(ctx: TemplateContext, params) {
    rejectUnknown(params, ["client", "account"]);
    const account = await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];
    const yesterday = shiftDay(todayEt(ctx.now), -1);

    const defs = await loadSignedDefinitions(ctx.db, ["touch_floor_72h", "structure_rules"]);
    const touch = defs.get("touch_floor_72h");

    // EVERYTHING IS SCOPED PER CREATOR, including the stored reads.
    //
    // The first version of this asked for all creators at once and then tried
    // to split the rows afterwards, which was wrong in a way that looked right:
    // adsv2_budget_asof does not return a client key, so both creators were
    // handed the SAME eight dials and the same $681/day total, and Jake's
    // stored fallback listed Tyson's campaigns as if they were his. A health
    // check that attributes one creator's campaigns to another is worse than
    // no health check, so each creator gets its own reads and its own answer.
    const perClient = new Map<
      string,
      {
        budgets: Row[];
        stored: StoredPicture;
        spentByAdset: Map<string, number>;
        spentByCampaign: Map<string, number>;
      }
    >();
    // adsv2_budget_snapshots stores dials in USD cents; ads_meta_insights_daily
    // stores spend in the AD ACCOUNT's own currency. Jake's account bills in
    // AUD, so comparing his raw spend against his USD dial reported him ~35%
    // short every single day: three fabricated shortfalls on the first live
    // run of this question. The rates are loaded once and applied per day, the
    // same way budget-sync and the leaf aggregation do it.
    const rateMap = await loadUsdRateMap(
      ctx.db as never,
      clients.map((c) => creatorCurrency(c)),
      yesterday,
      yesterday,
    );

    for (const c of clients) {
      const ccy = creatorCurrency(c);
      const [{ data: budgetData, error: budgetErr }, stored, { data: spendData, error: spendErr }] =
        await Promise.all([
          ctx.db.rpc("adsv2_budget_asof", { p_clients: [c], p_to: yesterday }),
          storedPicture(ctx.db, [c], yesterday),
          ctx.db
            .from("ads_meta_insights_daily")
            .select("adset_id, campaign_id, spend_cents")
            .eq("client_key", c)
            .eq("date", yesterday),
        ]);
      if (budgetErr) throw new Error(`adsv2_budget_asof failed for ${c}: ${budgetErr.message}`);
      if (spendErr) throw new Error(`could not read yesterday's spend for ${c}: ${spendErr.message}`);
      const spentByAdset = new Map<string, number>();
      const spentByCampaign = new Map<string, number>();
      for (const r of (spendData || []) as Row[]) {
        const cents = convertCentsToUsd(Number(r.spend_cents) || 0, ccy, yesterday, rateMap);
        if (r.adset_id) spentByAdset.set(String(r.adset_id), (spentByAdset.get(String(r.adset_id)) || 0) + cents);
        if (r.campaign_id) {
          spentByCampaign.set(String(r.campaign_id), (spentByCampaign.get(String(r.campaign_id)) || 0) + cents);
        }
      }
      perClient.set(c, {
        budgets: ((budgetData || []) as Row[]).filter(
          (b) => Boolean(b.holds) && String(b.effective_status || "").toUpperCase() === "ACTIVE",
        ),
        stored,
        spentByAdset,
        spentByCampaign,
      });
    }

    // Per-creator isolation: each is read on its own, and one failing leaves the
    // other's answer completely intact.
    const lives = await Promise.all(clients.map((c) => readLive(c, ctx.now)));

    const creators = clients.map((client, i) => {
      const live = lives[i];
      const scoped = perClient.get(client)!;
      const stored = scoped.stored;
      const counts: Record<string, number> = { active: 0, paused: 0, in_review: 0, rejected: 0, restricted: 0, other: 0 };
      const campaigns: CampaignVerdict[] = [];

      if (live.ok) {
        const adsByCampaign = new Map<string, MetaEntity[]>();
        for (const ad of live.ads) {
          const cid = ad.campaign_id || "(unknown)";
          const list = adsByCampaign.get(cid) || [];
          list.push(ad);
          adsByCampaign.set(cid, list);
          counts[bucketOf(ad.effective_status)] += 1;
        }
        for (const c of live.campaigns) {
          const kids = adsByCampaign.get(c.id) || [];
          const reasons: string[] = [];
          const cBucket = bucketOf(c.effective_status);
          const kidCounts: Record<string, number> = {};
          for (const k of kids) {
            const b = bucketOf(k.effective_status);
            kidCounts[b] = (kidCounts[b] || 0) + 1;
          }
          if (cBucket === "in_review") reasons.push(`the campaign itself is ${c.effective_status}: it is sitting in review and cannot deliver.`);
          if (cBucket === "rejected") reasons.push(`the campaign is ${c.effective_status}: Meta has rejected it.`);
          if (cBucket === "restricted") reasons.push(`the campaign is ${c.effective_status}: it is restricted and delivery is blocked.`);
          for (const issue of c.issues_info || []) {
            if (issue.error_summary) reasons.push(`Meta reports an issue on this campaign: ${issue.error_summary}`);
          }
          if (cBucket === "active") {
            if ((kidCounts.active || 0) === 0 && kids.length > 0) {
              reasons.push(
                `the campaign is ACTIVE but not one of its ${kids.length} ads is: ${Object.entries(kidCounts).map(([k, v]) => `${v} ${k}`).join(", ")}. An active campaign with no deliverable ad spends nothing while looking healthy in the tab.`,
              );
            }
            if (kidCounts.rejected) reasons.push(`${kidCounts.rejected} ad${kidCounts.rejected === 1 ? " is" : "s are"} rejected inside an otherwise active campaign.`);
            if (kidCounts.in_review) reasons.push(`${kidCounts.in_review} ad${kidCounts.in_review === 1 ? " is" : "s are"} still in review inside an otherwise active campaign.`);
            if (kidCounts.restricted) reasons.push(`${kidCounts.restricted} ad${kidCounts.restricted === 1 ? " is" : "s are"} restricted inside an otherwise active campaign.`);
          }
          // Only campaigns that are meant to be running are judged. A campaign
          // the owner deliberately paused is not a fault, and reporting it as
          // one would bury the real breakage in noise.
          if (cBucket === "paused") continue;
          campaigns.push({
            campaign_id: c.id,
            campaign_name_verbatim: c.name ?? null,
            go_no_go: reasons.length ? "no_go" : "go",
            reasons: reasons.length ? reasons : ["everything Meta reports for this campaign is deliverable."],
            counts: kidCounts,
          });
        }
      } else {
        // FALLBACK. The stored picture, judged the same way, and labelled.
        for (const [adId, s] of stored.adStatus) {
          void adId;
          counts[bucketOf(s.status)] += 1;
        }
        for (const [cid, c] of stored.campaignStatus) {
          const b = bucketOf(c.status);
          if (b === "paused") continue;
          const reasons: string[] = [];
          if (b !== "active") reasons.push(`the last stored status for this campaign was ${c.status ?? "unknown"}.`);
          if (live.authFailed) {
            reasons.push(
              "Meta did not accept this creator's access token, so nothing live could be read. A creator whose token is dead cannot be checked or changed, which is itself a no-go.",
            );
          }
          campaigns.push({
            campaign_id: cid,
            campaign_name_verbatim: c.name,
            go_no_go: reasons.length ? "no_go" : "go",
            reasons: reasons.length
              ? reasons
              : [`the last stored status for this campaign was ACTIVE, as of ${stored.asOfDay ?? "an unknown day"}. This is the STORED picture, not a live one.`],
            counts: {},
          });
        }
      }

      // The dials and yesterday's real spend against them, both already scoped
      // to THIS creator by the per-client reads above.
      const dials = scoped.budgets.map((b) => {
        const eid = String(b.entity_id);
        const level = String(b.entity_level);
        const daily = b.daily_usd_cents == null ? null : Number(b.daily_usd_cents);
        const spent = (level === "adset" ? scoped.spentByAdset.get(eid) : scoped.spentByCampaign.get(eid)) || 0;
        const pct = daily ? Math.round((spent / daily) * 1000) / 10 : null;
        return {
          level,
          entity_id: eid,
          campaign_id: b.campaign_id ? String(b.campaign_id) : null,
          daily_usd_cents: daily,
          yesterday_spend_usd_cents: spent,
          pct_of_dial: pct,
          // Meta's own daily flex is roughly 25%, so a shortfall bigger than
          // that on something that is supposed to be running is a real finding
          // rather than ordinary pacing.
          shortfall_flagged: pct !== null && pct < 75,
        };
      });

      const noGo = campaigns.filter((c) => c.go_no_go === "no_go");

      // THE OUTCOME, and the reason it has three values rather than two.
      //
      // A creator whose live read failed has NOT been checked. The first
      // version of this reported "go" for exactly that case, because every
      // stored campaign status still read ACTIVE, and a caveat further down
      // asked the reader not to believe it. That is the wrong shape: the field
      // a machine reads said all-clear while the prose said otherwise, and the
      // machine wins. "unchecked" is a distinct outcome so nothing downstream
      // can mistake "we could not look" for "we looked and it was fine".
      const overall: "go" | "no_go" | "unchecked" = !live.ok
        ? noGo.length > 0
          ? "no_go"
          : "unchecked"
        : noGo.length > 0
          ? "no_go"
          : "go";

      // Token state is reported as a state, not a boolean. "Not configured in
      // this environment" and "Meta rejected it" are different problems with
      // different fixes, and a true/false field cannot tell them apart.
      const tokenState: "ok" | "rejected" | "not_configured" | "unknown" = live.ok
        ? "ok"
        : live.authFailed
          ? "rejected"
          : /no Meta access token is configured/.test(live.error || "")
            ? "not_configured"
            : "unknown";

      return {
        client,
        source: live.ok ? ("live_meta" as const) : ("stored_fallback" as const),
        live_read_at: live.ok ? live.readAt : null,
        stored_as_of_day: live.ok ? null : stored.asOfDay,
        token_state: tokenState,
        rate_limited: live.rateLimited,
        live_error: live.error,
        overall,
        counts,
        campaigns,
        budget_dials: dials,
        budget_dials_total_daily_usd_cents: dials.reduce((s, d) => s + (d.daily_usd_cents || 0), 0),
        shortfalls: dials.filter((d) => d.shortfall_flagged).length,
      };
    });

    const anyFallback = creators.some((c) => c.source === "stored_fallback");
    const asOf: AsOf[] = [
      {
        source: META_LIVE_SOURCE,
        // A fallback answer reports NO live write time at all, which is what
        // makes the receipt flag it. A stale answer that looks live is the one
        // outcome this question must never produce.
        last_written_at: anyFallback ? null : creators[0]?.live_read_at ?? null,
        note: anyFallback
          ? "at least one creator's live Meta read did not succeed, so their picture is the stored one and its freshness is unknown"
          : "read live from the Meta Graph API at the moment this answer was given",
      },
      {
        source: "adsv2_budget_snapshots",
        last_written_at: null,
        note: "the daily budget photos, read as of yesterday Eastern",
      },
    ];

    const exclusions = anyFallback
      ? [
          {
            what: "the live delivery picture for any creator whose Meta read failed",
            count: creators.filter((c) => c.source === "stored_fallback").length,
            why:
              "Meta could not be reached for them inside this answer's budget, so their section is the STORED picture: the last statuses the sync wrote. A campaign that went into review since that write would not appear here, which is exactly the failure this question exists to catch. Treat those creators as unchecked, not as healthy.",
          },
        ]
      : [];

    return {
      answers: {
        account,
        checked_at: ctx.now.toISOString(),
        yesterday_et: yesterday,
        creators,
        // The roster-wide outcome takes the WORST of the three, and "unchecked"
        // never rounds up to "go". If any creator could not be looked at, the
        // honest headline is that the roster was not fully checked.
        overall: creators.some((c) => c.overall === "no_go")
          ? "no_go"
          : creators.some((c) => c.overall === "unchecked")
            ? "unchecked"
            : "go",
        outcome_key: {
          go: "read live from Meta, and nothing is blocking delivery.",
          no_go: "something is blocking delivery, with the reason on the campaign.",
          unchecked:
            "Meta could not be read for this creator, so nothing was verified. This is NOT a clean bill of health: the stored statuses shown are the last ones the sync wrote, and the failure this question exists to catch (a campaign that went into review since then) is invisible to them.",
        },
        standing_note:
          `Anything this answer finds is BREAKAGE, not a performance signal, so it is the one exception to touch_floor_72h v${touch?.version ?? 1}: a campaign stuck in review, an ad rejected, a restricted account or a dead token is acted on immediately rather than waiting for a 72-hour sustained signal. That exception is written into the signed definition itself.`,
        what_this_is_not:
          "This says whether the ads CAN deliver, never whether they SHOULD. A campaign can be entirely healthy and losing money and this answer will call it a go.",
        source_key: {
          live_meta: "read from the Meta Graph API during this answer.",
          stored_fallback:
            "Meta could not be reached, so this is the last stored status picture. It cannot show a campaign that went into review since the last sync.",
        },
      },
      asOf,
      usedParams: { client: account },
      exclusions,
      note:
        anyFallback
          ? "At least one creator's picture in this answer is the STORED one, not a live read, and is labelled as such per creator. A creator on the stored fallback has not been checked; do not read their 'go' as a live all-clear."
          : "Every creator in this answer was read live from Meta at the time it was given. Nothing was changed: this question only looks.",
    };
  },
};
