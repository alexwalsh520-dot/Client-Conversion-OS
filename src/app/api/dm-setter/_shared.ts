import { NextRequest, NextResponse } from "next/server";

export function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function firstString(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asString(body[key]);
    if (value) return value;
  }
  return undefined;
}

export function hasValidManychatSecret(req: NextRequest) {
  const expected = [
    process.env.MANYCHAT_WEBHOOK_SECRET?.trim(),
    process.env.WEBHOOK_SHARED_SECRET?.trim(),
  ].filter(Boolean);

  if (expected.length === 0) return false;

  const authorization = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const provided = [
    req.headers.get("x-manychat-secret")?.trim(),
    req.headers.get("x-webhook-secret")?.trim(),
    req.headers.get("x-forge-secret")?.trim(),
    authorization,
  ].filter(Boolean);

  return provided.some((value) => expected.includes(value));
}

export async function readManychatJson(req: NextRequest) {
  if (!hasValidManychatSecret(req)) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      body: null,
    };
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    return { body, error: null };
  } catch {
    return {
      error: NextResponse.json({ error: "invalid json" }, { status: 400 }),
      body: null,
    };
  }
}

export function parseDmSetterBody(body: Record<string, unknown>) {
  const subscriberId = firstString(body, [
    "subscriber_id",
    "contact_id",
    "manychat_user_id",
    "manychat_subscriber_id",
    "user_id",
  ]);

  return {
    client: firstString(body, ["client", "client_key", "account", "closer"]) || "tyson_sonnek",
    subscriberId: subscriberId || "",
    firstName: firstString(body, ["first_name", "firstName"]),
    lastName: firstString(body, ["last_name", "lastName"]),
    fullName: firstString(body, ["name", "full_name", "lead_name"]),
    email: firstString(body, ["email"]),
    instagramHandle: firstString(body, ["instagram_handle", "instagram_username", "username"]),
    tagName: firstString(body, ["tag_name", "tag", "tagName"]),
    setterName: firstString(body, ["setter_name", "setter", "setterName"]),
    source: firstString(body, ["source", "opportunity_source"]),
    clientName: firstString(body, ["client_name", "clientName", "client_full_name"]),
    manychatInboxUrl: firstString(body, [
      "manychat_inbox_url",
      "manychat_chat_url",
      "inbox_url",
      "chat_url",
    ]),
    instagramProfileUrl: firstString(body, [
      "instagram_profile_url",
      "ig_profile_url",
      "profile_url",
    ]),
    metaBusinessSuiteUrl: firstString(body, [
      "meta_business_suite_url",
      "meta_inbox_url",
      "business_suite_url",
    ]),
    metaThreadId: firstString(body, [
      "meta_thread_id",
      "meta_selected_item_id",
      "selected_item_id",
      "business_suite_thread_id",
      "thread_id",
    ]),
    metaAssetId: firstString(body, [
      "meta_asset_id",
      "meta_page_id",
      "asset_id",
      "page_id",
    ]),
    metaMailboxId: firstString(body, ["meta_mailbox_id", "mailbox_id"]),
    metaBusinessId: firstString(body, ["meta_business_id", "business_id"]),
    eventAt: firstString(body, ["event_at", "timestamp", "created_at"]),
  };
}
