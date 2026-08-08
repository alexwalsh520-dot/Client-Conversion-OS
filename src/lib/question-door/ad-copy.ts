// ─────────────────────────────────────────────────────────────────────────
// ad_copy: EVERYTHING AN AD SAYS, from the field that actually holds it.
//
// This is baseline capability. The CMO cannot judge a creative, write its
// successor, or explain why one ad beat another without knowing what each one
// said. Until this question existed that was true for still images only, and
// every video ad in the account — Jake's entire test fleet, Tyson's LOADED —
// answered "no copy" when the truth was "nobody had looked".
//
// THE LAW THIS QUESTION ENFORCES, signed as creative_truth v1 and cited on
// every answer: never characterise an ad from a proxy field. Each field is
// returned under its own label, saying what it is AND what it is not:
//
//   words_on_the_image        still ads. OCR of the image. EMPTY for a video,
//                             and that emptiness is not evidence of no copy.
//   words_spoken_in_the_video video ads. The audio, transcribed.
//   words_printed_on_the_video video ads. Frames sampled across the whole
//                             video, OCR'd. For a silent b-roll ad this is the
//                             entire message.
//   caption_above_the_creative EVERY ad. The primary text. It is NEVER
//                             reported as the words on the image and NEVER as
//                             the words in the video. Reading it as the
//                             on-image copy is the exact 1 July mistake.
//
// BATCH MODE answers the question behind the question: how much of what we are
// spending do we actually know the content of. Coverage is reported BY SPEND,
// because an unknown ad running at $200 a day is a different problem from an
// unknown ad that spent four dollars in June, and the unknown ones are listed
// by name rather than summarised away.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor, type Leaf } from "./leaves";
import { optionalText, rejectUnknown, requireClient, requireRange } from "./params";
import { BadParams, type AsOf, type QuestionEntry, type TemplateContext } from "./types";

/** How far back batch coverage looks when the caller does not say. Long enough
 *  to hold a creator's whole live fleet and the recent bench, short enough that
 *  coverage means something operationally. */
const DEFAULT_WINDOW_DAYS = 90;

export interface CopyRow {
  ad_id: string;
  client_key: string | null;
  on_image_text: string | null;
  primary_text: string | null;
  extracted_at: string | null;
}

export interface TranscriptRow {
  ad_id: string;
  transcript_text: string | null;
  on_screen_text: string | null;
  audio_status: string | null;
  on_screen_status: string | null;
  status: string | null;
  failure_reason: string | null;
  duration_s: number | null;
  frames_read: number | null;
  transcribed_at: string | null;
  model: string | null;
  on_screen_model: string | null;
}

export async function copyRowsFor(ctx: TemplateContext, adIds: string[]): Promise<Map<string, CopyRow>> {
  const map = new Map<string, CopyRow>();
  if (!adIds.length) return map;
  for (let i = 0; i < adIds.length; i += 200) {
    const { data, error } = await ctx.db
      .from("ad_creative_copy")
      .select("ad_id, client_key, on_image_text, primary_text, extracted_at")
      .in("ad_id", adIds.slice(i, i + 200));
    if (error) throw new Error(`could not read the stored ad copy: ${error.message}`);
    for (const r of (data || []) as CopyRow[]) map.set(String(r.ad_id), r);
  }
  return map;
}

export async function transcriptRowsFor(ctx: TemplateContext, adIds: string[]): Promise<Map<string, TranscriptRow>> {
  const map = new Map<string, TranscriptRow>();
  if (!adIds.length) return map;
  for (let i = 0; i < adIds.length; i += 200) {
    const { data, error } = await ctx.db
      .from("ad_creative_transcripts")
      .select(
        "ad_id, transcript_text, on_screen_text, audio_status, on_screen_status, status, failure_reason, duration_s, frames_read, transcribed_at, model, on_screen_model",
      )
      .in("ad_id", adIds.slice(i, i + 200));
    if (error) throw new Error(`could not read the stored video transcripts: ${error.message}`);
    for (const r of (data || []) as TranscriptRow[]) map.set(String(r.ad_id), r);
  }
  return map;
}

/**
 * How fresh the two creative stores are FOR THIS CREATOR, from the real write
 * times of their own rows.
 *
 * These are computed here rather than added to question_door_freshness on
 * purpose. That function is shared by every question and by two other bricks
 * being built alongside this one; a template that can tell the truth about its
 * own sources without editing shared machinery should.
 */
export async function creativeFreshness(ctx: TemplateContext, client: string): Promise<AsOf[]> {
  const read = async (
    table: string,
    column: string,
    note: string,
  ): Promise<AsOf> => {
    try {
      const { data, error } = await ctx.db
        .from(table)
        .select(column)
        .eq("client_key", client)
        .order(column, { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const row = ((data || []) as unknown[])[0] as Record<string, unknown> | undefined;
      const at = row ? (row[column] as string | null) : null;
      return {
        source: table,
        last_written_at: at ?? null,
        note: at ? note : `${note} This creator has no rows here yet, so there is no write time to report.`,
      };
    } catch {
      return {
        source: table,
        last_written_at: null,
        note: `${note} The write time could not be read, so freshness is unknown rather than assumed.`,
      };
    }
  };

  return Promise.all([
    read("ad_creative_copy", "extracted_at", "When this creator's newest still-image OCR and caption were stored."),
    read(
      "ad_creative_transcripts",
      "updated_at",
      "When this creator's newest video read was stored. Video reads are kept current by the two-hourly creative cron.",
    ),
  ]);
}

/** Which ad ids are video ads, from the media sync's own flag. */
export async function videoAdIds(ctx: TemplateContext, adIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!adIds.length) return out;
  for (let i = 0; i < adIds.length; i += 200) {
    const { data, error } = await ctx.db
      .from("ad_creative_image")
      .select("ad_id, is_video")
      .in("ad_id", adIds.slice(i, i + 200));
    if (error) throw new Error(`could not read the creative types: ${error.message}`);
    for (const r of (data || []) as Array<{ ad_id: string; is_video: boolean | null }>) {
      if (r.is_video) out.add(String(r.ad_id));
    }
  }
  return out;
}

export type CreativeType = "video" | "still" | "unknown";

/** A labelled block of text. The label is part of the ANSWER, not decoration:
 *  it is what stops a caption being read as on-image copy. */
interface TextBlock {
  label: string;
  is_not: string;
  text: string | null;
  source_field: string;
}

export interface AdCopyAnswer {
  ad_id: string;
  keyword: string | null;
  ad_name_verbatim: string | null;
  client: string;
  delivery_state: "active" | "not_active" | "unknown";
  creative_type: CreativeType;
  spend_usd_cents: number | null;
  /** True when the field appropriate to this ad's OWN creative type carries
   *  words. Never true because a proxy field does. */
  content_known: boolean;
  what_the_ad_says: TextBlock[];
  caption: TextBlock;
  video_read: {
    audio_status: string | null;
    on_screen_status: string | null;
    duration_s: number | null;
    frames_read: number | null;
    transcribed_at: string | null;
    models: { spoken: string | null; printed: string | null };
    note: string;
  } | null;
  not_known_because: string | null;
}

const CAPTION_LABEL = "caption_above_the_creative";
const CAPTION_IS_NOT =
  "NOT the words on the image and NOT the words in the video. This is the primary text that sits above the creative in the feed.";

function captionBlock(copy: CopyRow | undefined): TextBlock {
  return {
    label: CAPTION_LABEL,
    is_not: CAPTION_IS_NOT,
    text: copy?.primary_text?.trim() || null,
    source_field: "ad_creative_copy.primary_text",
  };
}

/** Assemble one ad's answer from the stored rows. Pure, so the tests can pin
 *  the labelling without a database. */
export function shapeAdCopy(input: {
  adId: string;
  keyword: string | null;
  adName: string | null;
  client: string;
  deliveryState: AdCopyAnswer["delivery_state"];
  spendUsdCents: number | null;
  isVideo: boolean;
  copy: CopyRow | undefined;
  transcript: TranscriptRow | undefined;
}): AdCopyAnswer {
  const { copy, transcript } = input;
  const caption = captionBlock(copy);

  // The creative type decides which field is allowed to answer "what does it
  // say". A transcript row is itself proof the ad is a video.
  const creativeType: CreativeType =
    input.isVideo || transcript ? "video" : copy && copy.extracted_at ? "still" : "unknown";

  const blocks: TextBlock[] = [];
  let known = false;
  let why: string | null = null;

  if (creativeType === "video") {
    const spoken = transcript?.transcript_text?.trim() || null;
    const printed = transcript?.on_screen_text?.trim() || null;
    blocks.push({
      label: "words_spoken_in_the_video",
      is_not: "NOT the caption and NOT the printed on-screen text.",
      text: spoken,
      source_field: "ad_creative_transcripts.transcript_text",
    });
    blocks.push({
      label: "words_printed_on_the_video",
      is_not:
        "NOT the caption and NOT the cover thumbnail alone. Read from frames sampled across the whole video, which is why it finds copy the thumbnail OCR never could.",
      text: printed,
      source_field: "ad_creative_transcripts.on_screen_text",
    });
    known = Boolean(spoken || printed);
    if (!known) {
      why = transcript
        ? `the video was read and no words were recovered: ${transcript.failure_reason || "no reason recorded"}`
        : "this video ad has not been read yet, so its words are unknown. It is queued for the creative cron.";
    }
  } else if (creativeType === "still") {
    const onImage = copy?.on_image_text?.trim() || null;
    blocks.push({
      label: "words_on_the_image",
      is_not: "NOT the caption. These are the words printed on the still creative itself.",
      text: onImage,
      source_field: "ad_creative_copy.on_image_text",
    });
    known = Boolean(onImage);
    if (!known) {
      why =
        "the image was read and carried no printed words. The ad may still say something in its caption, which is reported separately and is never counted as the words on the image.";
    }
  } else {
    why =
      "nothing in the creative stores names this ad's creative type, so no field is entitled to answer for it. It is neither a read still nor a read video.";
  }

  return {
    ad_id: input.adId,
    keyword: input.keyword,
    ad_name_verbatim: input.adName,
    client: input.client,
    delivery_state: input.deliveryState,
    creative_type: creativeType,
    spend_usd_cents: input.spendUsdCents,
    content_known: known,
    what_the_ad_says: blocks,
    caption,
    video_read:
      creativeType === "video"
        ? {
            audio_status: transcript?.audio_status ?? null,
            on_screen_status: transcript?.on_screen_status ?? null,
            duration_s: transcript?.duration_s ?? null,
            frames_read: transcript?.frames_read ?? null,
            transcribed_at: transcript?.transcribed_at ?? null,
            models: { spoken: transcript?.model ?? null, printed: transcript?.on_screen_model ?? null },
            note:
              transcript?.audio_status === "no_audio"
                ? "This video has no audio track. That is a fact about the ad, not a gap in the record: it says nothing out loud and everything it says is printed on it."
                : "Spoken words come from the video's audio; printed words come from frames sampled across its whole length.",
          }
        : null,
    not_known_because: why,
  };
}

const SPEND_FLOOR_FOR_UNKNOWN_LIST = 0;

export const ad_copy: QuestionEntry = {
  key: "ad_copy",
  description:
    "Everything one ad says, taken from the field that actually holds it: for a still, the words on the image; for a video, the words spoken in it and the words printed on it; and for either, the caption above it, labelled as the caption and never as the creative's own copy. Asked for a whole creator instead, it returns how much of that creator's spend runs on ads whose content is known, and names every ad where it is not.",
  params:
    "client (tyson or jake). Optionally ONE of ad_id (the exact Meta ad id) or keyword (the ad's keyword, matched exactly) to read one ad. With neither, it answers for the whole creator and reports copy coverage by spend. date_from and date_to (YYYY-MM-DD) set the window coverage is measured over; they default to the trailing 90 days ending yesterday Eastern.",
  sources: ["ad_creative_copy", "ad_creative_transcripts", "ad_creative_image", "ads_meta_insights_daily"],
  freshnessSources: ["ad_creative_copy", "ad_creative_transcripts"],
  budgetMs: 45_000,
  // Version 1. Reports what ads SAY and what share of SPEND is known. It
  // touches no sale row, so it carries no coverage block: there is no cash
  // here whose completeness could be overstated. Spend is context, not a
  // money claim about revenue.
  receipt: {
    version: 1,
    windowKind: "explicit_range",
    money: false,
    usesDataVersion: false,
    exclusions: [
      {
        what: "ads that carried no keyword in the window",
        count: 0,
        why: "spend is read through the same certified keyword-grain aggregation the Ads v2 tab paints from, so an ad that never carried a keyword has no spend row here to report against.",
      },
      {
        what: "what an ad's images or video SHOW, as opposed to what they SAY",
        count: 0,
        why: "this question reports words only. Nothing here describes a person, a setting or a visual style, because a vision model asked to describe an ad will compose copy that appears nowhere in the account.",
      },
    ],
    definitionsCited: ["creative_truth"],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "ad_id", "keyword", "date_from", "date_to"]);
    const client = await requireClient(ctx, params);
    const adId = optionalText(params, "ad_id");
    const keyword = optionalText(params, "keyword");
    if (adId && keyword) {
      throw new BadParams("give ad_id or keyword, not both. Two different ways of naming one ad can disagree.");
    }

    let window: { from: string; to: string };
    if (params.date_from !== undefined || params.date_to !== undefined) {
      window = requireRange(params);
    } else {
      const yesterday = shiftDay(todayEt(ctx.now), -1);
      window = { from: shiftDay(yesterday, -(DEFAULT_WINDOW_DAYS - 1)), to: yesterday };
    }

    const leaves = await leavesFor(ctx.db, [client], window.from, window.to);
    const wanted: Leaf[] = adId
      ? leaves.filter((l) => l.ad_id === adId)
      : keyword
        ? leaves.filter((l) => l.keyword.toLowerCase() === keyword.toLowerCase())
        : leaves;

    // A named ad that never spent in the window still has copy worth reading,
    // so it is answered from the creative stores alone rather than refused.
    const namedButUnspent = (adId || keyword) && wanted.length === 0;
    const ids = namedButUnspent && adId ? [adId] : wanted.map((l) => l.ad_id).filter(Boolean);
    const uniqueIds = [...new Set(ids)];

    const [copy, transcripts, videos] = await Promise.all([
      copyRowsFor(ctx, uniqueIds),
      transcriptRowsFor(ctx, uniqueIds),
      videoAdIds(ctx, uniqueIds),
    ]);

    const byAd = new Map<string, Leaf>();
    for (const l of wanted) if (!byAd.has(l.ad_id)) byAd.set(l.ad_id, l);

    const ads: AdCopyAnswer[] = uniqueIds.map((id) => {
      const l = byAd.get(id);
      return shapeAdCopy({
        adId: id,
        keyword: l?.keyword ?? null,
        adName: l?.ad_name ?? null,
        client,
        deliveryState: l ? ((l.ad_status || "").toUpperCase() === "ACTIVE" ? "active" : "not_active") : "unknown",
        spendUsdCents: l ? l.spend_cents : null,
        isVideo: videos.has(id),
        copy: copy.get(id),
        transcript: transcripts.get(id),
      });
    });
    ads.sort((a, b) => (b.spend_usd_cents ?? 0) - (a.spend_usd_cents ?? 0));

    const asOf: AsOf[] = await creativeFreshness(ctx, client);
    const singleMode = Boolean(adId || keyword);

    if (singleMode) {
      if (!ads.length) {
        throw new BadParams(
          `nothing in ${client}'s record names ${adId ? `ad_id ${adId}` : `the keyword "${keyword}"`}. Nothing was guessed at and no near match was substituted.`,
        );
      }
      return {
        answers: {
          client,
          looked_up_by: adId ? "ad_id" : "keyword",
          window,
          found: ads.length,
          ads,
          field_law:
            "Each block above says what it IS and what it is NOT. The caption is returned separately from what the creative itself says, always, because reading the caption as the on-image copy is a mistake this system has already made once and paid for.",
          note:
            ads.length > 1
              ? "This keyword ran as more than one ad. Every one is listed with its own copy; they do not necessarily say the same thing."
              : undefined,
        },
        asOf,
        usedParams: { client, ad_id: adId, keyword, date_from: window.from, date_to: window.to },
        window,
        registryDefinitionsCited: ["creative_truth"],
      };
    }

    // ── BATCH: how much of this creator's spend runs on known content ──────
    const totalSpend = ads.reduce((s, a) => s + (a.spend_usd_cents ?? 0), 0);
    const knownSpend = ads.reduce((s, a) => s + (a.content_known ? (a.spend_usd_cents ?? 0) : 0), 0);
    const unknown = ads.filter((a) => !a.content_known && (a.spend_usd_cents ?? 0) >= SPEND_FLOOR_FOR_UNKNOWN_LIST);

    const byType = (t: CreativeType) => ads.filter((a) => a.creative_type === t);
    const spendOf = (list: AdCopyAnswer[]) => list.reduce((s, a) => s + (a.spend_usd_cents ?? 0), 0);

    // An empty denominator reads as PERFECT, never as zero. Nothing to know is
    // not the same as nothing known, and a 0% on a creator who spent nothing
    // would be a false alarm every time.
    const pct = (part: number, whole: number) => (whole === 0 ? 100 : Math.round((part / whole) * 1000) / 10);

    const freshest = [...transcripts.values()]
      .map((t) => t.transcribed_at)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;

    return {
      answers: {
        client,
        window,
        units: "Money is in USD CENTS.",
        copy_coverage: {
          ads_in_window: ads.length,
          spend_usd_cents: totalSpend,
          known_ads: ads.filter((a) => a.content_known).length,
          known_spend_usd_cents: knownSpend,
          coverage_pct_by_spend: pct(knownSpend, totalSpend),
          coverage_pct_by_ad_count: pct(ads.filter((a) => a.content_known).length, ads.length),
          empty_denominator_note:
            totalSpend === 0
              ? "This creator spent nothing in this window, so there is nothing to know and coverage reads 100%. Read it alongside ads_in_window, which is the volume line."
              : null,
        },
        by_creative_type: (["video", "still", "unknown"] as CreativeType[]).map((t) => {
          const list = byType(t);
          const knownList = list.filter((a) => a.content_known);
          return {
            creative_type: t,
            ads: list.length,
            spend_usd_cents: spendOf(list),
            known_ads: knownList.length,
            known_spend_usd_cents: spendOf(knownList),
            coverage_pct_by_spend: pct(spendOf(knownList), spendOf(list)),
          };
        }),
        unknown_content: unknown.map((a) => ({
          ad_id: a.ad_id,
          keyword: a.keyword,
          ad_name_verbatim: a.ad_name_verbatim,
          creative_type: a.creative_type,
          delivery_state: a.delivery_state,
          spend_usd_cents: a.spend_usd_cents,
          why: a.not_known_because,
        })),
        transcription_freshness: {
          newest_transcript_at: freshest,
          videos_with_a_read: [...transcripts.values()].filter((t) => t.status === "ok").length,
          videos_read_and_failed: [...transcripts.values()].filter((t) => t.status === "failed").length,
          note:
            "Transcripts are kept current by the two-hourly creative cron. A video ad with no row has never been read; a row with status failed WAS read and could not be recovered, and its reason is on the row. The two are different facts and are counted separately.",
        },
        ads,
        field_law:
          "Every text block says what it IS and what it is NOT. A caption is never returned as the words on an image or in a video, and a video's empty image OCR is never reported as an absence of copy.",
      },
      asOf,
      usedParams: { client, date_from: window.from, date_to: window.to },
      window,
      registryDefinitionsCited: ["creative_truth"],
      note:
        "Coverage is BY SPEND on purpose. An unknown ad running at two hundred dollars a day is a different problem from an unknown ad that spent four dollars in June, and only one of them is worth anyone's Monday.",
    };
  },
};
