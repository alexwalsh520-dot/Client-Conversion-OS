// Thin wrapper around the Resend SDK.
//
// CCOS hadn't shipped transactional email before this — all manager
// notifications went via Slack. The weekly check-in digest is the
// first email-only notification. Keep this helper minimal: one
// function, fails gracefully when RESEND_API_KEY is not set so dev
// + preview environments don't blow up on missing config.
//
// Sender: Resend's default onboarding@resend.dev works without
// domain verification — fine for an internal manager-only digest.
// Switch to a verified custom domain when we want the email to look
// branded.

import { Resend } from "resend";

const FROM_DEFAULT = "CCOS Weekly Digest <onboarding@resend.dev>";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Override the From header. Default: CCOS Weekly Digest <onboarding@resend.dev>. */
  from?: string;
  /** Plain-text fallback. If omitted, recipients without HTML rendering
   *  see "(HTML email)". Most modern clients render HTML so this is rare. */
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Send an email via Resend. Returns a result object — does NOT throw on
 * provider errors so the caller can decide whether to retry or log.
 *
 * Returns ok: false with error: "RESEND_API_KEY not configured" when the
 * env var is missing so local development doesn't crash on a missing
 * secret.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email/resend] RESEND_API_KEY not set; email not sent.");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: params.from ?? FROM_DEFAULT,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? "(HTML email)",
    });
    if (result.error) {
      console.error("[email/resend] send failed:", result.error);
      return { ok: false, error: JSON.stringify(result.error) };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email/resend] send threw:", msg);
    return { ok: false, error: msg };
  }
}
