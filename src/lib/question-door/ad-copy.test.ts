// ─────────────────────────────────────────────────────────────────────────
// BRICK 7 (c): THE LABELS, pinned against a constructed fixture.
//
// This is the one part of creative truth that must be provable WITHOUT a
// database, because it is not a number, it is a promise about wording: the
// caption is never returned as the words on the image and never as the words in
// the video. Reading primary_text as on-image copy is a mistake this system has
// already made once, on 1 July 2026, and it was expensive precisely because the
// output looked correct.
//
// The fixtures are deliberately adversarial. Every text is a distinct sentinel
// string, so if any field is ever plumbed into the wrong block the assertion
// fails on the VALUE rather than on a label that happens to read plausibly.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeAdCopy, type CopyRow, type TranscriptRow } from "./ad-copy";

const CAPTION = "SENTINEL-CAPTION: the primary text that sits above the creative in the feed";
const ON_IMAGE = "SENTINEL-ON-IMAGE: the words printed on the still";
const SPOKEN = "SENTINEL-SPOKEN: the words said out loud in the video";
const PRINTED = "SENTINEL-PRINTED: the words burned onto the video frames";

function copyRow(over: Partial<CopyRow> = {}): CopyRow {
  return {
    ad_id: "ad_1",
    client_key: "tyson",
    on_image_text: null,
    primary_text: CAPTION,
    extracted_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function transcriptRow(over: Partial<TranscriptRow> = {}): TranscriptRow {
  return {
    ad_id: "ad_1",
    transcript_text: null,
    on_screen_text: null,
    audio_status: "ok",
    on_screen_status: "ok",
    status: "ok",
    failure_reason: null,
    duration_s: 17,
    frames_read: 6,
    transcribed_at: "2026-08-08T00:00:00.000Z",
    model: "whisper-large-v3",
    on_screen_model: "claude-sonnet-4-6",
    ...over,
  };
}

/** Every block this answer returns that claims to be the creative's OWN words. */
function creativeBlocks(a: ReturnType<typeof shapeAdCopy>) {
  return a.what_the_ad_says;
}

// ─────────────────────────────────────────────────────────────────────────
// (c) THE CAPTION IS NEVER RETURNED AS THE CREATIVE'S OWN WORDS.
// ─────────────────────────────────────────────────────────────────────────

test("(c) a still ad never reports its caption as the words on the image", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "loaded",
    adName: "LOADED",
    client: "tyson",
    deliveryState: "active",
    spendUsdCents: 1000,
    isVideo: false,
    copy: copyRow({ on_image_text: ON_IMAGE }),
    transcript: undefined,
  });

  assert.equal(a.creative_type, "still");
  // The caption's text appears in exactly one place, and that place is labelled
  // as the caption.
  assert.equal(a.caption.label, "caption_above_the_creative");
  assert.equal(a.caption.text, CAPTION);
  for (const block of creativeBlocks(a)) {
    assert.notEqual(
      block.text,
      CAPTION,
      `the caption was returned under the label "${block.label}", which is the 1 July mistake`,
    );
  }
  const onImage = creativeBlocks(a).find((b) => b.label === "words_on_the_image");
  assert.equal(onImage?.text, ON_IMAGE);
  assert.equal(onImage?.source_field, "ad_creative_copy.on_image_text");
  assert.equal(a.content_known, true);
});

test("(c) a video ad never reports its caption as spoken or as printed words", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "loaded",
    adName: "LOADED",
    client: "tyson",
    deliveryState: "not_active",
    spendUsdCents: 232386,
    isVideo: true,
    copy: copyRow(),
    transcript: transcriptRow({ transcript_text: SPOKEN, on_screen_text: PRINTED }),
  });

  assert.equal(a.creative_type, "video");
  assert.equal(a.caption.text, CAPTION);
  for (const block of creativeBlocks(a)) {
    assert.notEqual(block.text, CAPTION, `the caption was returned as "${block.label}"`);
  }
  const spoken = creativeBlocks(a).find((b) => b.label === "words_spoken_in_the_video");
  const printed = creativeBlocks(a).find((b) => b.label === "words_printed_on_the_video");
  assert.equal(spoken?.text, SPOKEN);
  assert.equal(printed?.text, PRINTED);
  // The two halves are never swapped for each other either.
  assert.notEqual(spoken?.text, PRINTED);
  assert.notEqual(printed?.text, SPOKEN);
});

test("(c) a video ad never gets an on-image block, however full its caption is", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "badge",
    adName: "BADGE",
    client: "jake",
    deliveryState: "active",
    spendUsdCents: 98579,
    isVideo: true,
    // The exact 31 July shape: a video ad whose thumbnail OCR is empty and
    // whose caption is full. Before this brick that combination read as "this
    // ad has no copy" or, worse, as the caption being the copy.
    copy: copyRow({ on_image_text: "" }),
    transcript: transcriptRow({ on_screen_text: PRINTED }),
  });

  assert.equal(a.creative_type, "video");
  assert.equal(
    creativeBlocks(a).find((b) => b.label === "words_on_the_image"),
    undefined,
    "a video ad must never be described by an image OCR field that is empty by construction",
  );
  assert.equal(a.content_known, true, "printed on-screen words alone make a video ad's content known");
});

// ─────────────────────────────────────────────────────────────────────────
// KNOWN means the RIGHT field carries words, never a proxy field.
// ─────────────────────────────────────────────────────────────────────────

test("a video with neither spoken nor printed words is NOT known, however full its caption", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "silent",
    adName: "SILENT",
    client: "tyson",
    deliveryState: "not_active",
    spendUsdCents: 5000,
    isVideo: true,
    copy: copyRow(),
    transcript: transcriptRow({
      audio_status: "no_audio",
      on_screen_status: "no_text",
      status: "failed",
      failure_reason: "the video has no audio track | 6 frames were read and carried no printed words",
    }),
  });

  assert.equal(a.content_known, false, "a caption must never make a video's content count as known");
  assert.match(String(a.not_known_because), /no words were recovered/);
});

test("a still whose image carries no words is not known, and says the caption is separate", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "plain",
    adName: "PLAIN",
    client: "tyson",
    deliveryState: "active",
    spendUsdCents: 900,
    isVideo: false,
    copy: copyRow({ on_image_text: "" }),
    transcript: undefined,
  });

  assert.equal(a.content_known, false);
  assert.match(String(a.not_known_because), /never counted as the words on the image/);
});

test("a video ad that has never been read says so, rather than reading as wordless", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "fresh",
    adName: "FRESH",
    client: "jake",
    deliveryState: "active",
    spendUsdCents: 4000,
    isVideo: true,
    copy: copyRow(),
    transcript: undefined,
  });

  assert.equal(a.content_known, false);
  assert.match(String(a.not_known_because), /has not been read yet/);
  assert.equal(
    /no words were recovered/.test(String(a.not_known_because)),
    false,
    "never-read and no-words-found are different facts and must not share a sentence",
  );
});

test("an ad of unknown creative type refuses to let any field answer for it", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "mystery",
    adName: null,
    client: "tyson",
    deliveryState: "unknown",
    spendUsdCents: null,
    isVideo: false,
    copy: undefined,
    transcript: undefined,
  });

  assert.equal(a.creative_type, "unknown");
  assert.equal(a.content_known, false);
  assert.deepEqual(creativeBlocks(a), [], "no field is entitled to speak for an ad of unknown type");
  assert.equal(a.caption.text, null);
});

// ─────────────────────────────────────────────────────────────────────────
// The silent-video note is a FACT about the ad, not a failure message.
// ─────────────────────────────────────────────────────────────────────────

test("a silent video reports its silence as a fact about the ad", () => {
  const a = shapeAdCopy({
    adId: "ad_1",
    keyword: "loaded",
    adName: "LOADED",
    client: "tyson",
    deliveryState: "not_active",
    spendUsdCents: 232386,
    isVideo: true,
    copy: copyRow(),
    transcript: transcriptRow({
      audio_status: "no_audio",
      on_screen_text: PRINTED,
      failure_reason: "the video has no audio track: this ad says nothing out loud",
    }),
  });

  assert.equal(a.content_known, true);
  assert.match(String(a.video_read?.note), /not a gap in the record/);
  assert.equal(a.video_read?.audio_status, "no_audio");
});
