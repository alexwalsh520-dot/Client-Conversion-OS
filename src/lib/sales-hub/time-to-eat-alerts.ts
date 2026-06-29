// Slack alerts for the Time to Eat queue. These fire when a lead crosses a
// non-response threshold (see the cron-driven detection in the time-to-eat API
// route). All post to the private #time-to-eat channel via the Sales Manager
// bot (postToSlack uses SLACK_BOT_TOKEN). Setters are @-mentioned by Slack
// member ID — a mention only NOTIFIES a setter who is also a member of the
// (private) channel, so each setter must be added to #time-to-eat.

import { postToSlack } from "@/lib/slack";
import { normalizeSetterKey } from "@/lib/ghl-dm-sync";

const CHANNEL = process.env.SLACK_CHANNEL_TIME_TO_EAT || "C0B9AMSRZEX";

// setterKey -> Slack member ID, PER CLIENT — each creator has their own setters,
// so a "go hunt" rally only tags the setters who actually work that client.
// (Looked up from the Client Conversion Slack workspace.) Update when the roster
// changes. A setter who works multiple clients appears under each.
const SETTER_SLACK_IDS_BY_CLIENT: Record<string, Record<string, string>> = {
  tyson_sonnek: {
    amara: "U08JJ25GPBN",
    erin: "U0B997M2AMB",
    kelechi: "U0957LBTUV9",
    gideon: "U0946H0PD7V",
    debbie: "U09F2KQT52A",
  },
  antwan_rarcus: {
    erin: "U0B997M2AMB",
    amara: "U08JJ25GPBN",
  },
};

const SETTER_DISPLAY: Record<string, string> = {
  amara: "Amara",
  erin: "Erin",
  kelechi: "Kelechi",
  gideon: "Gideon",
  debbie: "Debbie",
};

function setterKey(name?: string | null): string {
  const key = normalizeSetterKey(name) || "";
  return key === "kelz" ? "kelechi" : key;
}

function rosterFor(client: string): Record<string, string> {
  return SETTER_SLACK_IDS_BY_CLIENT[client] || {};
}

// "<@ID>" if we have the owner's Slack ID for this client, otherwise their plain
// name so the alert is still readable.
function ownerMention(client: string, owner?: string | null): string {
  const key = setterKey(owner);
  const roster = rosterFor(client);
  if (roster[key]) return `<@${roster[key]}>`;
  return SETTER_DISPLAY[key] || (owner?.trim() ? owner.trim() : "Unassigned");
}

// Every setter on this client EXCEPT the owner — the ones invited to go steal it.
function otherSetterMentions(client: string, owner?: string | null): string {
  const ownerK = setterKey(owner);
  return Object.entries(rosterFor(client))
    .filter(([key]) => key !== ownerK)
    .map(([, id]) => `<@${id}>`)
    .join(" ");
}

function prospect(leadName?: string | null): string {
  return leadName?.trim() || "Unknown";
}

/** Proactive nudge at 4 working min — the owner is about to miss the 5-min target. */
export function postResponseTargetAlert(client: string, leadName: string | null, owner: string | null) {
  const text =
    `You're about to miss your response time target of 5 minutes ${ownerMention(client, owner)}!\n` +
    `Go respond to ${prospect(leadName)}`;
  return postToSlack(CHANNEL, text);
}

/** A lead just landed in Time to Eat — rally every other setter to go hunt it. */
export function postTimeToEatAlert(client: string, leadName: string | null, owner: string | null) {
  const others = otherSetterMentions(client, owner);
  const text =
    `TIME TO EAT! ${others} GO HUNT!\n` +
    `Prospect: ${prospect(leadName)}\n` +
    `Current Owner: ${ownerMention(client, owner)}`;
  return postToSlack(CHANNEL, text);
}

/** A lead just landed in Dead Meat. */
export function postDeadMeatAlert(client: string, leadName: string | null, owner: string | null) {
  const text =
    `Are you allergic to money?! 😕🚨\n` +
    `NEW DEAD MEAT LEAD!\n` +
    `Prospect: ${prospect(leadName)}\n` +
    `Current Owner: ${ownerMention(client, owner)}`;
  return postToSlack(CHANNEL, text);
}

/** Early nudge — the owner has left a reply hanging for 15 working minutes. */
export function postAnswerLeadAlert(client: string, leadName: string | null, owner: string | null) {
  const text =
    `Do you want to lose a lead?! ANSWER LEAD!\n` +
    `${prospect(leadName)} has gone unresponded to for 15 minutes!\n` +
    `Current Owner: ${ownerMention(client, owner)}`;
  return postToSlack(CHANNEL, text);
}
