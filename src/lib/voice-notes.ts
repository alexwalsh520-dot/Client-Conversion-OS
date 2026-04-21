export const DEFAULT_CREATOR_NAME = "Tyson Sonnek";
export const DEFAULT_CREATOR_SLUG = "tyson";
export const DEFAULT_CLIENT_KEY = "tyson_sonnek";

export const MAX_VOICE_FILES = 6;
export const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
export const MAX_SCRIPT_CHARS = 420;

export type VoiceNoteTemplate = "goal_clear" | "follow_up" | "custom";
export type VoiceNoteEnvironment = "car" | "walk" | "gym";

export interface CreatorVoiceProfile {
  id: string;
  slug: string;
  creator_name: string;
  client_key: string | null;
  elevenlabs_voice_id: string;
  status: "ready" | "pending_verification";
  sample_count: number;
  sample_filenames: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceNoteDraftInput {
  creatorName: string;
  template: VoiceNoteTemplate;
  prospectName?: string;
  instagramHandle?: string;
  goal?: string;
  painPoint?: string;
  currentSituation?: string;
  callToAction?: string;
  customScript?: string;
}

export const VOICE_NOTE_ENVIRONMENTS: Array<{
  value: VoiceNoteEnvironment;
  label: string;
  hint: string;
}> = [
  {
    value: "car",
    label: "In the car",
    hint: "Calm and casual.",
  },
  {
    value: "walk",
    label: "On a walk",
    hint: "Light and natural.",
  },
  {
    value: "gym",
    label: "At the gym",
    hint: "More energy and push.",
  },
];

export function slugifyVoiceProfile(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeVoiceNoteText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeInstagramUsername(value: string) {
  return normalizeVoiceNoteText(value).replace(/^@+/, "").toLowerCase();
}

export function buildVoiceNoteFileName(params: {
  creatorSlug: string;
  environment: VoiceNoteEnvironment;
  username?: string;
}) {
  const safeUsername = normalizeInstagramUsername(params.username || "lead")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lead";

  return `${params.creatorSlug}-${params.environment}-${safeUsername}-voice-note.mp3`;
}

export function getVoiceEnvironmentSettings(environment: VoiceNoteEnvironment) {
  switch (environment) {
    case "walk":
      return {
        stability: 0.42,
        similarity_boost: 0.88,
        style: 0.28,
        speed: 1.01,
        use_speaker_boost: true,
      };
    case "gym":
      return {
        stability: 0.36,
        similarity_boost: 0.84,
        style: 0.4,
        speed: 1.06,
        use_speaker_boost: true,
      };
    case "car":
    default:
      return {
        stability: 0.5,
        similarity_boost: 0.9,
        style: 0.2,
        speed: 0.98,
        use_speaker_boost: true,
      };
  }
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value.trim();
}

function sentence(value: string | undefined, prefix = "") {
  const cleaned = normalizeVoiceNoteText(value || "");
  if (!cleaned) return "";
  return `${prefix}${cleaned}${/[.!?]$/.test(cleaned) ? "" : "."}`;
}

export function buildVoiceNoteDraft(input: VoiceNoteDraftInput) {
  if (input.template === "custom") {
    return normalizeVoiceNoteText(input.customScript || "");
  }

  const creatorFirstName = firstName(input.creatorName || DEFAULT_CREATOR_NAME);
  const leadName = normalizeVoiceNoteText(input.prospectName || "");
  const handle = normalizeVoiceNoteText(input.instagramHandle || "").replace(/^@/, "");

  const opener = leadName
    ? `Hey ${leadName}, it's ${creatorFirstName} here.`
    : `Hey, it's ${creatorFirstName} here.`;

  if (input.template === "follow_up") {
    return normalizeVoiceNoteText(
      [
        opener,
        sentence(
          input.goal
            ? `Just circling back because your goal of ${input.goal} matters`
            : "Just circling back because I don't want this to get buried",
        ),
        sentence(
          input.currentSituation
            ? `From what you shared, ${input.currentSituation}`
            : "",
        ),
        sentence(
          input.callToAction ||
            `If you're still serious about this, reply${handle ? ` here or at @${handle}` : ""} and tell me where you're stuck right now`,
        ),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return normalizeVoiceNoteText(
    [
      opener,
      sentence(
        input.goal
          ? `I saw your message, and it sounds like your main goal right now is ${input.goal}`
          : "I saw your message and wanted to send this quick note",
      ),
      sentence(
        input.painPoint
          ? `The part I want to understand better is ${input.painPoint}`
          : "",
      ),
      sentence(
        input.currentSituation
          ? `From what you shared, ${input.currentSituation}`
          : "",
      ),
      sentence(
        input.callToAction ||
          "Shoot me a quick reply and tell me what you're doing right now, what's been the hardest part, and what result you want most over the next few months",
      ),
    ]
      .filter(Boolean)
      .join(" "),
  );
}
