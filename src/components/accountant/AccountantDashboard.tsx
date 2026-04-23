"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AccountantDashboardData,
  ClientPeriodPlan,
  FinanceLegendItem,
  ManualClientPeriodEntry,
  ManualPeriodStatus,
  UpcomingPayoutRow,
  formatCents,
} from "@/lib/accountant-types";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  PiggyBank,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

type Props = AccountantDashboardData & {
  onRefreshData?: () => Promise<void>;
};

type PeriodDraft = {
  status: ManualPeriodStatus;
  cash_collected: string;
  net_cash: string;
  ad_spend: string;
  sales_team_line: string;
  program_months_sold: string;
  coaching_line: string;
  coaching_reserve: string;
  forecast_fulfillment: string;
  software_fee: string;
  profit_share: string;
  invoice_total: string;
  notes: string;
};

type ObligationDraft = {
  label: string;
  amount: string;
  due_date: string;
  payee_name: string;
  client_name: string;
  obligation_type: string;
  notes: string;
};

const BLANK_PERIOD_DRAFT: PeriodDraft = {
  status: "draft",
  cash_collected: "",
  net_cash: "",
  ad_spend: "",
  sales_team_line: "",
  program_months_sold: "",
  coaching_line: "",
  coaching_reserve: "",
  forecast_fulfillment: "",
  software_fee: "",
  profit_share: "",
  invoice_total: "",
  notes: "",
};

function centsToInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Number((value / 100).toFixed(2)));
}

function numberToInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
}

function parseMoneyInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function parseCountInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPeriodDraft(entry?: ManualClientPeriodEntry): PeriodDraft {
  if (!entry) return { ...BLANK_PERIOD_DRAFT };
  return {
    status: entry.status,
    cash_collected: centsToInput(entry.cash_collected_cents),
    net_cash: centsToInput(entry.net_cash_cents),
    ad_spend: centsToInput(entry.ad_spend_cents),
    sales_team_line: centsToInput(entry.sales_team_line_cents),
    program_months_sold: numberToInput(entry.program_months_sold),
    coaching_line: centsToInput(entry.coaching_line_cents),
    coaching_reserve: centsToInput(entry.coaching_reserve_cents),
    forecast_fulfillment: centsToInput(entry.forecast_fulfillment_cents),
    software_fee: centsToInput(entry.software_fee_cents),
    profit_share: centsToInput(entry.profit_share_cents),
    invoice_total: centsToInput(entry.invoice_total_cents),
    notes: entry.notes ?? "",
  };
}

function buildPeriodDrafts(
  clients: ClientPeriodPlan[],
  entries: ManualClientPeriodEntry[],
): Record<string, PeriodDraft> {
  const entryMap = new Map(entries.map((entry) => [entry.client_key, entry]));
  return clients.reduce<Record<string, PeriodDraft>>((acc, client) => {
    acc[client.client_key] = buildPeriodDraft(entryMap.get(client.client_key));
    return acc;
  }, {});
}

function buildEmptyObligationDraft(defaultDueDate: string): ObligationDraft {
  return {
    label: "",
    amount: "",
    due_date: defaultDueDate,
    payee_name: "",
    client_name: "",
    obligation_type: "other",
    notes: "",
  };
}

function formatTrendLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export default function AccountantDashboard({
  balances,
  currentMonth,
  trend,
  storedReports,
  finance,
  onRefreshData,
}: Props) {
  const [kindFilter, setKindFilter] = useState<"all" | "income" | "expense">("all");
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [savingClientKey, setSavingClientKey] = useState<string | null>(null);
  const [periodDrafts, setPeriodDrafts] = useState<Record<string, PeriodDraft>>({});
  const [obligationDraft, setObligationDraft] = useState<ObligationDraft>(
    buildEmptyObligationDraft(finance.focus_period.period.billing_date),
  );
  const [savingObligation, setSavingObligation] = useState(false);
  const [workingObligationId, setWorkingObligationId] = useState<string | null>(null);

  const manualEntriesByClient = useMemo(
    () =>
      new Map(finance.planning.current_period_entries.map((entry) => [entry.client_key, entry])),
    [finance.planning.current_period_entries],
  );

  useEffect(() => {
    setPeriodDrafts(
      buildPeriodDrafts(
        finance.focus_period.clients,
        finance.planning.current_period_entries,
      ),
    );
    setObligationDraft(buildEmptyObligationDraft(finance.focus_period.period.billing_date));
  }, [
    finance.focus_period.clients,
    finance.focus_period.period.billing_date,
    finance.planning.current_period_entries,
  ]);

  const filteredTxs = useMemo(() => {
    return currentMonth.transactions.filter((tx) => {
      if (kindFilter !== "all" && tx.kind !== kindFilter) return false;
      return true;
    });
  }, [currentMonth.transactions, kindFilter]);

  const categoryTransactions = useMemo(() => {
    const grouped = new Map<string, typeof currentMonth.transactions>();
    for (const tx of currentMonth.transactions) {
      const bucket = grouped.get(tx.category) ?? [];
      bucket.push(tx);
      grouped.set(tx.category, bucket);
    }
    return grouped;
  }, [currentMonth.transactions]);

  const totalBalance = balances.reduce((sum, balance) => sum + balance.balance, 0);
  const maxTrendValue = Math.max(...trend.map((m) => Math.max(m.income, m.expenses)), 1);
  const clientRows = finance.client_profit;
  const bestClient = clientRows[0] ?? null;
  const worstClient =
    clientRows.length > 0
      ? [...clientRows].sort((a, b) => a.estimated_company_keep - b.estimated_company_keep)[0]
      : null;

  const refreshData = async () => {
    if (onRefreshData) {
      await onRefreshData();
      return;
    }
    window.location.reload();
  };

  const postPlanning = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/accountant/planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
  };

  const handleSync = async () => {
    setActionError(null);
    setActionNote(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/accountant/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refreshData();
      setActionNote("Mercury synced.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleBackfill = async () => {
    setActionError(null);
    setActionNote(null);
    setBackfilling(true);
    try {
      const res = await fetch("/api/accountant/backfill", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refreshData();
      setActionNote("Backfill finished.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Backfill failed.");
    } finally {
      setBackfilling(false);
    }
  };

  const setPeriodField = (clientKey: string, field: keyof PeriodDraft, value: string) => {
    setPeriodDrafts((current) => ({
      ...current,
      [clientKey]: {
        ...(current[clientKey] ?? { ...BLANK_PERIOD_DRAFT }),
        [field]: value,
      },
    }));
  };

  const handleSavePeriod = async (client: ClientPeriodPlan) => {
    const draft =
      periodDrafts[client.client_key] ??
      buildPeriodDraft(manualEntriesByClient.get(client.client_key));

    setActionError(null);
    setActionNote(null);
    setSavingClientKey(client.client_key);

    try {
      await postPlanning({
        action: "save_period",
        client_key: client.client_key,
        client_name: client.client_name,
        period_start: finance.focus_period.period.start,
        period_end: finance.focus_period.period.end,
        status: draft.status,
        cash_collected_cents: parseMoneyInput(draft.cash_collected),
        net_cash_cents: parseMoneyInput(draft.net_cash),
        ad_spend_cents: parseMoneyInput(draft.ad_spend),
        sales_team_line_cents: parseMoneyInput(draft.sales_team_line),
        program_months_sold: parseCountInput(draft.program_months_sold),
        coaching_line_cents: parseMoneyInput(draft.coaching_line),
        coaching_reserve_cents: parseMoneyInput(draft.coaching_reserve),
        forecast_fulfillment_cents: parseMoneyInput(draft.forecast_fulfillment),
        software_fee_cents: parseMoneyInput(draft.software_fee),
        profit_share_cents: parseMoneyInput(draft.profit_share),
        invoice_total_cents: parseMoneyInput(draft.invoice_total),
        notes: draft.notes.trim() || null,
      });
      await refreshData();
      setActionNote(`${client.client_name} saved.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingClientKey(null);
    }
  };

  const handleClearPeriod = async (client: ClientPeriodPlan) => {
    const savedEntry = manualEntriesByClient.get(client.client_key);

    setActionError(null);
    setActionNote(null);

    if (!savedEntry) {
      setPeriodDrafts((current) => ({
        ...current,
        [client.client_key]: { ...BLANK_PERIOD_DRAFT },
      }));
      setActionNote(`${client.client_name} cleared.`);
      return;
    }

    setSavingClientKey(client.client_key);
    try {
      await postPlanning({
        action: "delete_period",
        client_key: client.client_key,
        period_start: finance.focus_period.period.start,
        period_end: finance.focus_period.period.end,
      });
      await refreshData();
      setActionNote(`${client.client_name} reset to auto.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Clear failed.");
    } finally {
      setSavingClientKey(null);
    }
  };

  const handleAddObligation = async () => {
    const amountCents = parseMoneyInput(obligationDraft.amount);
    if (
      !obligationDraft.label.trim() ||
      !obligationDraft.due_date ||
      amountCents === null ||
      amountCents <= 0
    ) {
      setActionError("Add a label, due date, and amount first.");
      setActionNote(null);
      return;
    }

    setActionError(null);
    setActionNote(null);
    setSavingObligation(true);

    try {
      await postPlanning({
        action: "create_obligation",
        label: obligationDraft.label,
        amount_cents: amountCents,
        due_date: obligationDraft.due_date,
        payee_name: obligationDraft.payee_name || null,
        client_name: obligationDraft.client_name || null,
        obligation_type: obligationDraft.obligation_type,
        notes: obligationDraft.notes || null,
      });
      await refreshData();
      setObligationDraft(buildEmptyObligationDraft(finance.focus_period.period.billing_date));
      setActionNote("Manual item added.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Add failed.");
    } finally {
      setSavingObligation(false);
    }
  };

  const handleObligationAction = async (
    id: string,
    action: "update_obligation_status" | "delete_obligation",
  ) => {
    setActionError(null);
    setActionNote(null);
    setWorkingObligationId(id);
    try {
      await postPlanning(
        action === "update_obligation_status"
          ? { action, id, status: "paid" }
          : { action, id },
      );
      await refreshData();
      setActionNote(
        action === "delete_obligation"
          ? "Manual item deleted."
          : "Manual item marked paid.",
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setWorkingObligationId(null);
    }
  };

  return (
    <div style={{ padding: "24px 24px 40px", maxWidth: 1260, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Accountant
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0, maxWidth: 620 }}>
            The simple owner view. Cash, payouts, profit, and what needs attention.
          </p>
        </div>
      </div>

      {actionError && <MessageBox tone="error">{actionError}</MessageBox>}
      {actionNote && <MessageBox tone="success">{actionNote}</MessageBox>}

      <Section title="Overview" description="The few numbers to watch first.">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <StatCard
            label="Cash in Bank"
            value={formatCents(totalBalance)}
            icon={<Wallet size={16} />}
            sub={balances[0]?.snapshot_date ? `As of ${balances[0].snapshot_date}` : "CoreShift Mercury total"}
          />
          <StatCard
            label="Safe Cash"
            value={formatCents(finance.safe_cash)}
            icon={<Shield size={16} />}
            sub="Cash after unpaid commissions and manual items"
            color={finance.safe_cash >= 0 ? "var(--text-primary)" : "var(--danger, #ef4444)"}
          />
          <StatCard
            label="Next Invoice Total"
            value={formatCents(finance.focus_period.totals.invoice_total)}
            icon={<FileText size={16} />}
            sub={`${finance.focus_period.period.label} · Bills ${finance.focus_period.period.billing_date}`}
          />
          <StatCard
            label="Upcoming Payouts"
            value={formatCents(finance.payouts.due_next_30d)}
            icon={<Landmark size={16} />}
            sub="Due in the next 30 days"
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            label="Company Keep"
            value={formatCents(finance.focus_period.totals.estimated_company_keep)}
            icon={<TrendingUp size={16} />}
            sub={finance.focus_period.period.label}
            color={
              finance.focus_period.totals.estimated_company_keep >= 0
                ? "var(--success, #10b981)"
                : "var(--danger, #ef4444)"
            }
          />
          <StatCard
            label="Coaching Cost / Client"
            value={formatCents(finance.coaching_budget.cost_per_active_client)}
            icon={<PiggyBank size={16} />}
            sub={`Goal ${formatCents(finance.coaching_budget.hard_cap_cost_per_active_client)} · Ceiling ${formatCents(finance.coaching_budget.target_cost_per_active_client)}`}
            color={coachingStatusColor(finance.coaching_budget.status)}
          />
          <StatCard
            label="Best Client"
            value={bestClient?.client_name ?? "—"}
            icon={<Users size={16} />}
            sub={bestClient ? `Keep ${formatCents(bestClient.estimated_company_keep)}` : "No client rows yet"}
            color={bestClient ? "var(--success, #10b981)" : undefined}
          />
          <StatCard
            label="Worst Client"
            value={worstClient?.client_name ?? "—"}
            icon={<TrendingDown size={16} />}
            sub={worstClient ? `Keep ${formatCents(worstClient.estimated_company_keep)}` : "No client rows yet"}
            color={
              worstClient
                ? worstClient.estimated_company_keep >= 0
                  ? "var(--text-primary)"
                  : "var(--danger, #ef4444)"
                : undefined
            }
          />
        </div>
      </Section>

      <Section
        title="Clients"
        description="Which clients are helping and which ones need attention."
      >
        <TableWrap>
          {clientRows.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              text="Client profit will show here once the billing period has data."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Client</Th>
                  <Th align="right">Invoice</Th>
                  <Th align="right">Keep</Th>
                  <Th align="right">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row) => (
                  <tr key={row.client_key} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>{row.client_name}</Td>
                    <Td align="right">{formatCents(row.invoice_total)}</Td>
                    <Td
                      align="right"
                      color={
                        row.estimated_company_keep >= 0
                          ? "var(--success, #10b981)"
                          : "var(--danger, #ef4444)"
                      }
                    >
                      {formatCents(row.estimated_company_keep)}
                    </Td>
                    <Td align="right">
                      {row.margin_pct === null ? "—" : `${row.margin_pct}%`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <Section
        title="Upcoming Payouts"
        description="What money is going out next, and to who."
      >
        <TableWrap>
          {finance.payouts.rows.length === 0 ? (
            <EmptyState
              icon={<Landmark size={18} />}
              text="No unpaid payout rows are showing right now."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Due</Th>
                  <Th>Payee</Th>
                  <Th>Client</Th>
                  <Th>Type</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {finance.payouts.rows.map((row) => (
                  <tr key={payoutKey(row)} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>{row.due_date}</Td>
                    <Td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>{row.payee}</span>
                        {row.notes.length > 0 && <InlineMeta>{row.notes.join(" ")}</InlineMeta>}
                      </div>
                    </Td>
                    <Td>{row.client_name ?? "—"}</Td>
                    <Td>{row.category.replace("_", " ")}</Td>
                    <Td align="right">{formatCents(row.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <Section
        title="Alerts"
        description="The short list of things that need your attention."
      >
        <TableWrap>
          {finance.recommendations.length === 0 ? (
            <EmptyState
              icon={<Shield size={18} />}
              text="No alerts are showing right now."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Priority</Th>
                  <Th>Alert</Th>
                  <Th>Why It Matters</Th>
                </tr>
              </thead>
              <tbody>
                {finance.recommendations.map((item) => (
                  <tr key={item.title} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td color={priorityColor(item.priority)}>
                      {item.priority}
                    </Td>
                    <Td>{item.title}</Td>
                    <Td>{item.body}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <DetailsPanel
        title="Advanced"
        description="Manual edits, sync controls, transactions, reports, and the full legend."
        defaultOpen={false}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Panel
            title="Controls"
            sub="Use these when you need to refresh Mercury or fill older history."
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ActionButton
                onClick={handleSync}
                disabled={syncing || backfilling}
                variant="secondary"
                icon={<RefreshCw size={14} className={syncing ? "spin" : ""} />}
              >
                {syncing ? "Syncing…" : "Sync Now"}
              </ActionButton>
              <ActionButton
                onClick={handleBackfill}
                disabled={backfilling || syncing}
                variant="secondary"
                icon={<Calculator size={14} />}
              >
                {backfilling ? "Backfilling…" : "Backfill 12M"}
              </ActionButton>
            </div>
          </Panel>

          <Panel
            title="Manual Billing Overrides"
            sub="Only open this if the auto invoice math needs help."
          >
            {finance.focus_period.clients.length === 0 ? (
              <EmptyState
                icon={<FileText size={18} />}
                text="No client rows yet for this billing window."
              />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {finance.focus_period.clients.map((client) => {
                  const draft =
                    periodDrafts[client.client_key] ??
                    buildPeriodDraft(manualEntriesByClient.get(client.client_key));
                  const savedEntry = manualEntriesByClient.get(client.client_key);
                  const busy = savingClientKey === client.client_key;

                  return (
                    <details
                      key={client.client_key}
                      style={{
                        border: "1px solid var(--border-primary)",
                        borderRadius: 12,
                        background: "var(--bg-primary)",
                        overflow: "hidden",
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          listStyle: "none",
                          padding: "14px 16px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ display: "grid", gap: 4 }}>
                            <strong style={{ color: "var(--text-primary)" }}>
                              {client.client_name}
                            </strong>
                            <InlineMeta>
                              Auto invoice {formatCents(client.invoice_total)} · Keep{" "}
                              {formatCents(client.estimated_company_keep)}
                            </InlineMeta>
                          </div>
                          <SourceBadge
                            source={savedEntry ? "manual" : client.invoice_source}
                          />
                        </div>
                      </summary>

                      <div
                        style={{
                          padding: "0 16px 16px",
                          display: "grid",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: 10,
                          }}
                        >
                          <FormField
                            label="Net cash"
                            hint={`Auto ${formatCents(client.estimated_net_cash)}`}
                          >
                            <TextInput
                              value={draft.net_cash}
                              onChange={(value) =>
                                setPeriodField(client.client_key, "net_cash", value)
                              }
                              placeholder={String(client.estimated_net_cash / 100)}
                            />
                          </FormField>
                          <FormField
                            label="Ad spend"
                            hint={`Auto ${formatCents(client.ad_spend)}`}
                          >
                            <TextInput
                              value={draft.ad_spend}
                              onChange={(value) =>
                                setPeriodField(client.client_key, "ad_spend", value)
                              }
                              placeholder={String(client.ad_spend / 100)}
                            />
                          </FormField>
                          <FormField
                            label="Fulfillment"
                            hint={
                              client.forecast_fulfillment > 0
                                ? `Auto ${formatCents(client.forecast_fulfillment)}`
                                : "Add the real forecast if you know it"
                            }
                          >
                            <TextInput
                              value={draft.forecast_fulfillment}
                              onChange={(value) =>
                                setPeriodField(
                                  client.client_key,
                                  "forecast_fulfillment",
                                  value,
                                )
                              }
                              placeholder={
                                client.forecast_fulfillment > 0
                                  ? String(client.forecast_fulfillment / 100)
                                  : "0"
                              }
                            />
                          </FormField>
                          <FormField
                            label="Software line"
                            hint={`Auto ${formatCents(client.software_line)}`}
                          >
                            <TextInput
                              value={draft.software_fee}
                              onChange={(value) =>
                                setPeriodField(client.client_key, "software_fee", value)
                              }
                              placeholder={String(client.software_line / 100)}
                            />
                          </FormField>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: 10,
                          }}
                        >
                          <FormField label="Status">
                            <SelectInput
                              value={draft.status}
                              onChange={(value) =>
                                setPeriodField(client.client_key, "status", value)
                              }
                              options={[
                                { value: "draft", label: "Draft" },
                                { value: "ready", label: "Ready" },
                                { value: "sent", label: "Sent" },
                                { value: "paid", label: "Paid" },
                              ]}
                            />
                          </FormField>
                        </div>

                        <FormField label="Notes">
                          <TextAreaInput
                            value={draft.notes}
                            onChange={(value) =>
                              setPeriodField(client.client_key, "notes", value)
                            }
                            placeholder="Anything you want to remember"
                          />
                        </FormField>

                        <details>
                          <summary
                            style={{
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-secondary)",
                            }}
                          >
                            More override fields
                          </summary>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                              gap: 10,
                              marginTop: 10,
                            }}
                          >
                            <FormField label="Cash collected">
                              <TextInput
                                value={draft.cash_collected}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "cash_collected", value)
                                }
                                placeholder={String(client.cash_collected / 100)}
                              />
                            </FormField>
                            <FormField label="Sales line">
                              <TextInput
                                value={draft.sales_team_line}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "sales_team_line", value)
                                }
                                placeholder={String(client.sales_team_line / 100)}
                              />
                            </FormField>
                            <FormField label="Program months">
                              <TextInput
                                value={draft.program_months_sold}
                                onChange={(value) =>
                                  setPeriodField(
                                    client.client_key,
                                    "program_months_sold",
                                    value,
                                  )
                                }
                                placeholder={String(client.program_months_sold)}
                              />
                            </FormField>
                            <FormField label="Coaching line">
                              <TextInput
                                value={draft.coaching_line}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "coaching_line", value)
                                }
                                placeholder={String(client.coaching_line / 100)}
                              />
                            </FormField>
                            <FormField label="Coaching reserve">
                              <TextInput
                                value={draft.coaching_reserve}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "coaching_reserve", value)
                                }
                                placeholder={String(client.coaching_reserve / 100)}
                              />
                            </FormField>
                            <FormField label="Profit share">
                              <TextInput
                                value={draft.profit_share}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "profit_share", value)
                                }
                                placeholder={String(client.profit_share_line / 100)}
                              />
                            </FormField>
                            <FormField label="Final invoice">
                              <TextInput
                                value={draft.invoice_total}
                                onChange={(value) =>
                                  setPeriodField(client.client_key, "invoice_total", value)
                                }
                                placeholder={String(client.invoice_total / 100)}
                              />
                            </FormField>
                          </div>
                        </details>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <ActionButton
                            onClick={() => handleSavePeriod(client)}
                            disabled={busy}
                            icon={<Save size={14} />}
                          >
                            {busy ? "Saving…" : "Save"}
                          </ActionButton>
                          <ActionButton
                            onClick={() => handleClearPeriod(client)}
                            disabled={busy}
                            variant="secondary"
                            icon={<Trash2 size={14} />}
                          >
                            {savedEntry ? "Reset to Auto" : "Clear Draft"}
                          </ActionButton>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="Manual Cash Items"
            sub="Add anything that should reduce safe cash but is not coming from the sales sheet."
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 10,
              }}
            >
              <FormField label="Label">
                <TextInput
                  value={obligationDraft.label}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, label: value }))
                  }
                  placeholder="Coach payout"
                />
              </FormField>
              <FormField label="Amount">
                <TextInput
                  value={obligationDraft.amount}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, amount: value }))
                  }
                  placeholder="500"
                />
              </FormField>
              <FormField label="Due date">
                <DateInput
                  value={obligationDraft.due_date}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, due_date: value }))
                  }
                />
              </FormField>
              <FormField label="Type">
                <SelectInput
                  value={obligationDraft.obligation_type}
                  onChange={(value) =>
                    setObligationDraft((current) => ({
                      ...current,
                      obligation_type: value,
                    }))
                  }
                  options={[
                    { value: "other", label: "Other" },
                    { value: "coach_pay", label: "Coach Pay" },
                    { value: "fulfillment", label: "Fulfillment" },
                    { value: "software", label: "Software" },
                    { value: "tax", label: "Tax" },
                    { value: "commission_adjustment", label: "Commission Adjustment" },
                  ]}
                />
              </FormField>
              <FormField label="Payee">
                <TextInput
                  value={obligationDraft.payee_name}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, payee_name: value }))
                  }
                  placeholder="Name"
                />
              </FormField>
              <FormField label="Client">
                <TextInput
                  value={obligationDraft.client_name}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, client_name: value }))
                  }
                  placeholder="Optional"
                />
              </FormField>
            </div>

            <div style={{ marginTop: 10 }}>
              <FormField label="Notes">
                <TextAreaInput
                  value={obligationDraft.notes}
                  onChange={(value) =>
                    setObligationDraft((current) => ({ ...current, notes: value }))
                  }
                  placeholder="Why this item is owed"
                />
              </FormField>
            </div>

            <div style={{ marginTop: 12 }}>
              <ActionButton
                onClick={handleAddObligation}
                disabled={savingObligation}
                icon={<Plus size={14} />}
              >
                {savingObligation ? "Adding…" : "Add Manual Item"}
              </ActionButton>
            </div>

            {finance.planning.unpaid_manual_obligations.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                {finance.planning.unpaid_manual_obligations.map((item) => {
                  const busy = workingObligationId === item.id;
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        gap: 12,
                        alignItems: "center",
                        padding: 12,
                        borderRadius: 10,
                        background: "var(--bg-primary)",
                        border: "1px solid var(--border-primary)",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                          {item.label}
                        </div>
                        <InlineMeta>
                          Due {item.due_date}
                          {item.payee_name ? ` · ${item.payee_name}` : ""}
                          {item.client_name ? ` · ${item.client_name}` : ""}
                        </InlineMeta>
                        {(item.notes || item.obligation_type) && (
                          <InlineMeta>
                            {item.notes || item.obligation_type.replace(/_/g, " ")}
                          </InlineMeta>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong style={{ color: "var(--text-primary)" }}>
                          {formatCents(item.amount_cents)}
                        </strong>
                        <ActionButton
                          onClick={() =>
                            handleObligationAction(item.id, "update_obligation_status")
                          }
                          disabled={busy}
                          variant="secondary"
                        >
                          Paid
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            handleObligationAction(item.id, "delete_obligation")
                          }
                          disabled={busy}
                          variant="secondary"
                          icon={<Trash2 size={14} />}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title={`Mercury Month - ${currentMonth.label}`}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <StatCard
                label="Income (MTD)"
                value={formatCents(currentMonth.summary.income)}
                icon={<TrendingUp size={16} />}
                sub={`${currentMonth.summary.by_category.filter((c) => c.income > 0).length} income categories`}
                color="var(--success, #10b981)"
              />
              <StatCard
                label="Expenses (MTD)"
                value={formatCents(currentMonth.summary.expenses)}
                icon={<TrendingDown size={16} />}
                sub={`${currentMonth.summary.tx_count} transactions`}
                color="var(--danger, #ef4444)"
              />
              <StatCard
                label="Net (MTD)"
                value={formatCents(currentMonth.summary.net)}
                icon={<TrendingUp size={16} />}
                sub={currentMonth.summary.net >= 0 ? "Profit" : "Loss"}
                color={
                  currentMonth.summary.net >= 0
                    ? "var(--success, #10b981)"
                    : "var(--danger, #ef4444)"
                }
              />
            </div>
          </Panel>

          <Panel title="12-Month Trend">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${trend.length}, 1fr)`,
                gap: 8,
                alignItems: "flex-end",
                height: 180,
                paddingBottom: 8,
              }}
            >
              {trend.map((month) => (
                <div
                  key={month.month}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    height: "100%",
                    justifyContent: "flex-end",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 2,
                      alignItems: "flex-end",
                      height: "100%",
                    }}
                  >
                    <div
                      title={`Income: ${formatCents(month.income)}`}
                      style={{
                        width: 10,
                        height: `${(month.income / maxTrendValue) * 100}%`,
                        background: "var(--success, #10b981)",
                        borderRadius: "3px 3px 0 0",
                        minHeight: 2,
                      }}
                    />
                    <div
                      title={`Expenses: ${formatCents(month.expenses)}`}
                      style={{
                        width: 10,
                        height: `${(month.expenses / maxTrendValue) * 100}%`,
                        background: "var(--danger, #ef4444)",
                        borderRadius: "3px 3px 0 0",
                        minHeight: 2,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                    {formatTrendLabel(month.month)}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: 16,
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 8,
              }}
            >
              <LegendDot color="var(--success, #10b981)" label="Income" />
              <LegendDot color="var(--danger, #ef4444)" label="Expenses" />
            </div>
          </Panel>

          <Panel
            title="Spending by Category"
            sub="Click a row to see the charges inside it."
          >
            <TableWrap>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-primary)" }}>
                    <Th>Category</Th>
                    <Th align="right">Income</Th>
                    <Th align="right">Expenses</Th>
                    <Th align="right">Net</Th>
                    <Th align="right">Count</Th>
                  </tr>
                </thead>
                <tbody>
                  {currentMonth.summary.by_category.map((category) => {
                    const isOpen = expandedCategory === category.category;
                    const txs = categoryTransactions.get(category.category) ?? [];

                    return (
                      <Fragment key={category.category}>
                        <tr
                          style={{
                            borderTop: "1px solid var(--border-primary)",
                            cursor: "pointer",
                          }}
                          onClick={() =>
                            setExpandedCategory((current) =>
                              current === category.category ? null : category.category,
                            )
                          }
                        >
                          <Td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span>{category.category}</span>
                            </div>
                          </Td>
                          <Td align="right" color="var(--success, #10b981)">
                            {category.income > 0 ? formatCents(category.income) : "—"}
                          </Td>
                          <Td align="right" color="var(--danger, #ef4444)">
                            {category.expenses > 0 ? formatCents(category.expenses) : "—"}
                          </Td>
                          <Td align="right">
                            {formatCents(category.income - category.expenses)}
                          </Td>
                          <Td align="right">{category.count}</Td>
                        </tr>
                        {isOpen && (
                          <tr style={{ borderTop: "1px solid var(--border-primary)" }}>
                            <Td colSpan={5}>
                              <div style={{ display: "grid", gap: 8 }}>
                                {txs.length === 0 ? (
                                  <InlineMeta>No charges found in this category.</InlineMeta>
                                ) : (
                                  txs.map((tx) => (
                                    <div
                                      key={tx.mercury_id}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns:
                                          "110px minmax(0, 1fr) 120px",
                                        gap: 12,
                                        alignItems: "center",
                                        padding: "8px 10px",
                                        borderRadius: 8,
                                        background: "var(--bg-primary)",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 12,
                                          color: "var(--text-muted)",
                                        }}
                                      >
                                        {tx.posted_at ? tx.posted_at.slice(0, 10) : "—"}
                                      </span>
                                      <span style={{ color: "var(--text-secondary)" }}>
                                        {tx.counterparty ?? tx.description ?? "—"}
                                      </span>
                                      <span
                                        style={{
                                          textAlign: "right",
                                          color:
                                            tx.amount >= 0
                                              ? "var(--success, #10b981)"
                                              : "var(--danger, #ef4444)",
                                          fontVariantNumeric: "tabular-nums",
                                        }}
                                      >
                                        {tx.amount >= 0 ? "+" : "−"}
                                        {formatCents(Math.abs(tx.amount))}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </Td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {currentMonth.summary.by_category.length === 0 && (
                    <tr>
                      <Td colSpan={5} align="center" color="var(--text-muted)">
                        No transactions yet this month.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableWrap>
          </Panel>

          <Panel title="Transactions">
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <SelectInput
                value={kindFilter}
                onChange={(value) => setKindFilter(value as "all" | "income" | "expense")}
                options={[
                  { value: "all", label: "All kinds" },
                  { value: "income", label: "Income only" },
                  { value: "expense", label: "Expenses only" },
                ]}
                style={{ width: 180 }}
              />
            </div>
            <TableWrap>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-primary)" }}>
                    <Th>Date</Th>
                    <Th>Counterparty</Th>
                    <Th>Category</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxs.slice(0, 100).map((tx) => (
                    <tr key={tx.mercury_id} style={{ borderTop: "1px solid var(--border-primary)" }}>
                      <Td>{tx.posted_at ? tx.posted_at.slice(0, 10) : "—"}</Td>
                      <Td>{tx.counterparty ?? tx.description ?? "—"}</Td>
                      <Td>{tx.category}</Td>
                      <Td
                        align="right"
                        color={
                          tx.amount >= 0
                            ? "var(--success, #10b981)"
                            : "var(--danger, #ef4444)"
                        }
                      >
                        {tx.amount >= 0 ? "+" : "−"}
                        {formatCents(Math.abs(tx.amount))}
                      </Td>
                    </tr>
                  ))}
                  {filteredTxs.length === 0 && (
                    <tr>
                      <Td colSpan={4} align="center" color="var(--text-muted)">
                        No transactions match the filter.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
              {filteredTxs.length > 100 && (
                <div
                  style={{
                    padding: 10,
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    borderTop: "1px solid var(--border-primary)",
                  }}
                >
                  Showing first 100 of {filteredTxs.length} transactions
                </div>
              )}
            </TableWrap>
          </Panel>

          <Panel title="Monthly Reports">
            <TableWrap>
              {storedReports.length === 0 ? (
                <EmptyState
                  icon={<FileText size={20} />}
                  text="No reports yet. The next one will generate on the 1st."
                />
              ) : (
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-primary)" }}>
                      <Th>Period</Th>
                      <Th>Account</Th>
                      <Th align="right">Opening</Th>
                      <Th align="right">Closing</Th>
                      <Th align="right">Income</Th>
                      <Th align="right">Expenses</Th>
                      <Th align="right">Net</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {storedReports.map((report) => (
                      <tr
                        key={`${report.account}-${report.period_start}`}
                        style={{ borderTop: "1px solid var(--border-primary)" }}
                      >
                        <Td>{report.period_start.slice(0, 7)}</Td>
                        <Td>{report.account}</Td>
                        <Td align="right">{formatCents(report.opening_balance)}</Td>
                        <Td align="right">{formatCents(report.closing_balance)}</Td>
                        <Td align="right" color="var(--success, #10b981)">
                          {formatCents(report.income)}
                        </Td>
                        <Td align="right" color="var(--danger, #ef4444)">
                          {formatCents(report.expenses)}
                        </Td>
                        <Td
                          align="right"
                          color={
                            report.net >= 0
                              ? "var(--success, #10b981)"
                              : "var(--danger, #ef4444)"
                          }
                        >
                          {formatCents(report.net)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableWrap>
          </Panel>

          <Panel title="Legend">
            <div style={{ display: "grid", gap: 10 }}>
              {finance.legend.map((item) => (
                <LegendItemView key={item.term} item={item} />
              ))}
            </div>
          </Panel>
        </div>
      </DetailsPanel>

      <style jsx>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

function payoutKey(row: UpcomingPayoutRow): string {
  return `${row.due_date}-${row.category}-${row.payee}-${row.client_name ?? "none"}`;
}

function priorityColor(priority: "high" | "medium" | "low") {
  if (priority === "high") return "var(--danger, #ef4444)";
  if (priority === "medium") return "var(--warning, #f59e0b)";
  return "var(--accent, #3b82f6)";
}

function coachingStatusColor(status: "on_target" | "above_target" | "above_hard_cap") {
  if (status === "on_target") return "var(--success, #10b981)";
  if (status === "above_target") return "var(--warning, #f59e0b)";
  return "var(--danger, #ef4444)";
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          {title}
        </h2>
        {description && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function DetailsPanel({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      style={{
        marginBottom: 20,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          padding: "16px 18px",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
            {title}
          </div>
          {description && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{description}</div>
          )}
        </div>
      </summary>
      <div style={{ padding: "0 18px 18px" }}>{children}</div>
    </details>
  );
}

function Panel({
  title,
  sub,
  children,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      {(title || sub) && (
        <div style={{ marginBottom: 12 }}>
          {title && (
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              {title}
            </div>
          )}
          {sub && <InlineMeta>{sub}</InlineMeta>}
        </div>
      )}
      {children}
    </div>
  );
}

function MessageBox({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: ReactNode;
}) {
  const styles =
    tone === "error"
      ? {
          border: "1px solid rgba(239,68,68,0.25)",
          background: "rgba(239,68,68,0.08)",
          color: "var(--danger, #ef4444)",
        }
      : {
          border: "1px solid rgba(16,185,129,0.25)",
          background: "rgba(16,185,129,0.08)",
          color: "var(--success, #10b981)",
        };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: 10,
        fontSize: 13,
        ...styles,
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div
      style={{
        padding: 20,
        textAlign: "center",
        fontSize: 13,
        color: "var(--text-muted)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {icon}
      <div>{text}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
  color,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
        {icon}
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: color ?? "var(--text-primary)",
          marginTop: 8,
          lineHeight: 1.15,
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  icon?: ReactNode;
}) {
  const styles =
    variant === "secondary"
      ? {
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-primary)",
        }
      : {
          background: "var(--text-primary)",
          color: "var(--bg-primary)",
          border: "1px solid transparent",
        };

  return (
    <button
      className="btn-secondary"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...styles,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="form-input"
      style={{ width: "100%" }}
    />
  );
}

function TextAreaInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="form-input"
      rows={3}
      style={{ width: "100%", resize: "vertical", minHeight: 84 }}
    />
  );
}

function DateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="form-input"
      style={{ width: "100%" }}
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  style?: Record<string, string | number>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="form-input"
      style={{ width: "100%", ...style }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function LegendItemView({ item }: { item: FinanceLegendItem }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid var(--border-primary)",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
        {item.term}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
        {item.definition}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
        Calc: {item.formula}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ClientPeriodPlan["invoice_source"] }) {
  const styles =
    source === "manual"
      ? {
          background: "rgba(59,130,246,0.12)",
          color: "var(--accent, #3b82f6)",
        }
      : source === "live"
        ? {
            background: "rgba(16,185,129,0.12)",
            color: "var(--success, #10b981)",
          }
        : {
            background: "rgba(245,158,11,0.12)",
            color: "var(--warning, #f59e0b)",
          };

  return (
    <span
      style={{
        display: "inline-flex",
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "capitalize",
        ...styles,
      }}
    >
      {source}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      <span>{label}</span>
    </div>
  );
}

function InlineMeta({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{children}</div>;
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  color,
  colSpan,
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  color?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 12px",
        textAlign: align,
        color: color ?? "var(--text-secondary)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
