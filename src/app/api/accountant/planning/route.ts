import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

type PlanningAction =
  | "save_period"
  | "delete_period"
  | "create_obligation"
  | "update_obligation_status"
  | "delete_obligation";

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toPeriodStatus(value: unknown): "draft" | "ready" | "sent" | "paid" {
  return value === "ready" || value === "sent" || value === "paid" ? value : "draft";
}

function toObligationStatus(value: unknown): "owed" | "scheduled" | "paid" {
  return value === "scheduled" || value === "paid" ? value : "owed";
}

function formatDbError(error: unknown): string {
  const message =
    typeof error === "object" && error && "message" in error && typeof error.message === "string"
      ? error.message
      : "Database error";
  const code =
    typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : "";

  if (
    code === "42P01" ||
    message.toLowerCase().includes("does not exist") ||
    message.toLowerCase().includes("relation")
  ) {
    return "Finance planning tables are missing. Paste 015_accountant_finance_planning.sql into Supabase first.";
  }

  return message;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = body.action as PlanningAction | undefined;
  if (!action) {
    return NextResponse.json({ error: "Missing action." }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const nowIso = new Date().toISOString();

  try {
    if (action === "save_period") {
      const clientKey = toNullableText(body.client_key);
      const clientName = toNullableText(body.client_name);
      const periodStart = body.period_start;
      const periodEnd = body.period_end;

      if (!clientKey || !clientName || !isYmd(periodStart) || !isYmd(periodEnd)) {
        return NextResponse.json(
          { error: "client_key, client_name, period_start, and period_end are required." },
          { status: 400 },
        );
      }

      const { error } = await sb.from("accountant_client_periods").upsert(
        {
          client_key: clientKey,
          client_name: clientName,
          period_start: periodStart,
          period_end: periodEnd,
          status: toPeriodStatus(body.status),
          cash_collected_cents: toNullableInt(body.cash_collected_cents),
          net_cash_cents: toNullableInt(body.net_cash_cents),
          ad_spend_cents: toNullableInt(body.ad_spend_cents),
          sales_team_line_cents: toNullableInt(body.sales_team_line_cents),
          program_months_sold: toNullableInt(body.program_months_sold),
          coaching_line_cents: toNullableInt(body.coaching_line_cents),
          coaching_reserve_cents: toNullableInt(body.coaching_reserve_cents),
          forecast_fulfillment_cents: toNullableInt(body.forecast_fulfillment_cents),
          software_fee_cents: toNullableInt(body.software_fee_cents),
          profit_share_cents: toNullableInt(body.profit_share_cents),
          invoice_total_cents: toNullableInt(body.invoice_total_cents),
          notes: toNullableText(body.notes),
          updated_at: nowIso,
        },
        { onConflict: "client_key,period_start,period_end" },
      );

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "delete_period") {
      const clientKey = toNullableText(body.client_key);
      const periodStart = body.period_start;
      const periodEnd = body.period_end;

      if (!clientKey || !isYmd(periodStart) || !isYmd(periodEnd)) {
        return NextResponse.json(
          { error: "client_key, period_start, and period_end are required." },
          { status: 400 },
        );
      }

      const { error } = await sb
        .from("accountant_client_periods")
        .delete()
        .eq("client_key", clientKey)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "create_obligation") {
      const label = toNullableText(body.label);
      const dueDate = body.due_date;
      const amountCents = toNullableInt(body.amount_cents);

      if (!label || !isYmd(dueDate) || amountCents === null || amountCents <= 0) {
        return NextResponse.json(
          { error: "label, due_date, and a positive amount_cents are required." },
          { status: 400 },
        );
      }

      const { error } = await sb.from("accountant_manual_obligations").insert({
        label,
        obligation_type: toNullableText(body.obligation_type) ?? "other",
        payee_name: toNullableText(body.payee_name),
        client_name: toNullableText(body.client_name),
        due_date: dueDate,
        amount_cents: amountCents,
        status: toObligationStatus(body.status),
        notes: toNullableText(body.notes),
        updated_at: nowIso,
      });

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "update_obligation_status") {
      const id = toNullableText(body.id);
      if (!id) {
        return NextResponse.json({ error: "id is required." }, { status: 400 });
      }

      const { error } = await sb
        .from("accountant_manual_obligations")
        .update({
          status: toObligationStatus(body.status),
          updated_at: nowIso,
        })
        .eq("id", id);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "delete_obligation") {
      const id = toNullableText(body.id);
      if (!id) {
        return NextResponse.json({ error: "id is required." }, { status: 400 });
      }

      const { error } = await sb
        .from("accountant_manual_obligations")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: formatDbError(error) }, { status: 500 });
  }
}
