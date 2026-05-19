/**
 * POST /api/testimonials/lead — public lead capture endpoint.
 *
 * This is the ONLY CCOS API route that accepts unauthenticated POSTs from
 * the public internet. Hardening:
 *   1. Honeypot field: a hidden `website` field in the form. Real users
 *      can't see it; bots fill everything. Non-empty value -> silent 200
 *      drop (don't tip off the bot).
 *   2. Rate limit: max 3 submissions per IP per rolling 1 hour window.
 *      Enforced via a DB count, not in-memory (Vercel functions are stateless).
 *   3. Required-field + email-shape validation.
 *
 * On success: inserts the lead, fires-and-forgets a Slack DM to the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { notifyAdminOfNewLead } from "@/lib/testimonials/notify";
import type { TestimonialLead } from "@/lib/testimonials/types";

export const runtime = "nodejs";
export const maxDuration = 10;

const MAX_PER_IP_PER_HOUR = 3;

interface PostBody {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  /** Honeypot field — should always be empty for real users. */
  website?: string;
}

function getClientIp(req: NextRequest): string | null {
  // Vercel sets x-forwarded-for. Take the first IP in the chain.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

function isValidEmail(s: string): boolean {
  // Liberal email check — the user will get a confirmation, no need to
  // be strict beyond "looks like an email"
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Honeypot: if the bot filled the hidden field, drop silently with
  // 200 so the bot believes it succeeded and moves on.
  if (body.website && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const phone = body.phone?.trim();
  const message = body.message?.trim() || null;

  if (!name || name.length < 2) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (!phone || phone.length < 6) {
    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  }
  if (name.length > 200 || email.length > 200 || phone.length > 50) {
    return NextResponse.json({ error: "Field too long." }, { status: 400 });
  }
  if (message && message.length > 4000) {
    return NextResponse.json({ error: "Message too long." }, { status: 400 });
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;

  const db = getServiceSupabase();

  // Rate limit by IP (DB-backed since serverless is stateless)
  if (ip) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await db
      .from("testimonial_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gt("submitted_at", oneHourAgo);
    if (countErr) {
      console.warn("[testimonials/lead] rate-limit lookup failed:", countErr.message);
      // Fall through — better to accept a lead than reject due to our DB issue
    } else if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) {
      // Match honeypot behavior: appear successful so the actor can't
      // easily probe the rate-limit threshold.
      return NextResponse.json({ ok: true });
    }
  }

  const { data: inserted, error } = await db
    .from("testimonial_leads")
    .insert({
      name,
      email,
      phone,
      message,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select("id, name, email, phone, message, status, submitted_at, status_changed_at, status_changed_by")
    .single();

  if (error || !inserted) {
    console.error("[testimonials/lead] insert failed:", error?.message);
    return NextResponse.json(
      { error: "Could not save your submission. Please try again." },
      { status: 500 }
    );
  }

  // Fire-and-forget Slack notification
  void notifyAdminOfNewLead(inserted as TestimonialLead).catch((err) => {
    console.warn("[testimonials/lead] Slack notify failed:", err);
  });

  return NextResponse.json({ ok: true });
}
