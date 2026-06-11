# Supplements Tab — Connection Guide

The `/supplements` tab is built and gated to **matthew@clientconversion.io** only. The
UI renders every KPI now; each tile lights up as you connect its data source. This is
the checklist to make tracking **fully automated, zero manual entry** (one exception:
COGS upkeep).

Goal of the model: measure the **nutrition-consult → supplement-sale** funnel, fed by
two acquisition paths, with every number reported **Total · Path A · Path B**.

- **Path A (warm):** bought 1:1 coaching → booked consult → bought supplements.
- **Path B (rescue):** didn't close coaching → offered free consult → booked → bought.

Path A money metrics keep **supplements and coaching separate** (never blended). Path B
has no coaching.

---

## 0. One-time: create the data tables

Supabase has no programmatic DDL path, so this is a manual paste.

1. Open the SQL editor: `https://supabase.com/dashboard/project/bostjayrguulwaltnbgt/sql/new`
2. Paste the contents of `supabase/migrations/046_supplements.sql` and run it.

This creates `supplements_customers`, `supplements_appointments`, `supplements_payments`,
`supplements_cogs`, `supplements_funnel_events`.

---

## 1. 🔌 Shopify — revenue, cash, AOV, LTV, close

Powers: Revenue (cash collected), Cash Day 0 + Total, AOV, Customer LTV, Sales Close,
Close Rate.

**Connect:**
1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. **Configure Admin API scopes:** `read_orders`, `read_customers`, `read_products`,
   `read_inventory` (and `read_all_orders` if older than 60 days is needed).
3. Install the app, copy the **Admin API access token**.
4. Add to CCOS env (Vercel project env vars):
   - `SHOPIFY_STORE_DOMAIN` = `your-store.myshopify.com`
   - `SHOPIFY_ADMIN_TOKEN` = `shpat_…`

**What it gives automatically:** every order → a `supplements_payments` row
(`product_type='supplement'`), first order per customer flagged `is_first_order`
(Day 0 cash), refunds, customer identity for LTV.

**Coaching revenue (the other half of Path A):** the high-ticket coaching is collected
**where?** If it's Stripe (already wired in CCOS) or a separate Shopify product, point me
at it and I'll tag those payments `product_type='coaching'` so Path A shows the split.

---

## 2. 🔌 GHL "CC-Clients" — calls booked, show rate, the path tags

Powers: Calls Booked, Calls Showed, Show Rate, Booking Rate, and the **customer path tag**
that every other metric depends on.

**Connect:**
1. In the **CC-Clients** GHL sub-account → **Settings → Private Integrations → Create**.
2. Scopes: `calendars.readonly`, `calendars/events.readonly`, `contacts.readonly`,
   `opportunities.readonly`.
3. Copy the token + the **Location ID** (Settings → Business Profile).
4. Add to CCOS env:
   - `GHL_CC_CLIENTS_LOCATION_ID` = `…`
   - `GHL_CC_CLIENTS_TOKEN` = `pit-…`
5. Tell me **which calendar** the nutrition consults live on (calendar name/id).

**Show/no-show:** so Show Rate isn't a guess, appointments need their status set to
`showed`/`no_show`. Either reps disposition in GHL, or we wire the Zoom join webhook to
auto-mark attendance. Pick one and I'll build it.

---

## 3. 🕳️ THE hole — Customer Path (A vs B) attribution

No API returns "this person came from Path A." It must be **stamped at booking time**.
Without it, every per-path number is impossible — and per-path is the whole point.

**Fix — a GHL workflow (near-zero manual):**
- Trigger: **appointment booked** on the nutrition-consult calendar.
- If the contact has tag `coaching-client` (or a won coaching opportunity) → add tag
  **`path-a`**.
- Else if the contact has tag `comp-consult-offered` → add tag **`path-b`**.
- The sync reads these tags onto `customer_path` for the customer + appointment +
  payments.

**Booking-rate denominators** (so Booking Rate is real) come from the same workflows
writing `supplements_funnel_events`:
- coaching closed → `coaching_closed` (Path A denominator)
- comp consult offered → `comp_offer` (Path B denominator)

I'll spec the exact GHL workflow once you confirm what tags/pipeline stages already exist.

---

## 4. 🔌 Subscriptions — MRR / ARR (only if applicable)

MRR/ARR are only real if supplements sell on a **subscription**. If you run Shopify
Subscriptions / Recharge / Stripe subscriptions, recurring charges get flagged
`is_recurring` and MRR/ARR compute automatically. If it's one-time only, these stay $0
by design (not a hole — just N/A).

---

## 5. 🔌 COGS — Profit, 30-Day GP, LTGP ("add later")

The only place manual upkeep is unavoidable.

- **Product cost:** maintain Shopify's **cost-per-item** field (syncs into
  `supplements_cogs`), or paste unit costs into `supplements_cogs` directly.
- **Ad spend:** already available via the Meta integration in CCOS — I'll wire it in.
- **Fulfillment/shipping:** from Shopify order data where present.

Until COGS exists, the Profit section stays **locked** (visibly greyed) so no profit
number is ever shown as $0 when it's really just unknown.

---

## Automation summary

| Source | Status | Unlocks |
|---|---|---|
| Supabase tables | paste `046_supplements.sql` | storage for everything |
| Shopify | add 2 env vars | revenue, cash, AOV, LTV, close |
| GHL CC-Clients | add 2 env vars + calendar id | booked, showed, show rate |
| GHL path workflow | build workflow | **Path A/B split (all metrics)** + booking-rate denominators |
| Show/no-show | reps or Zoom webhook | accurate show rate |
| Subscriptions | confirm yes/no | MRR/ARR |
| COGS | Shopify cost field | Profit, 30-Day GP, LTGP |

Once 1–3 are connected, a nightly Vercel cron (mirroring the existing `mozi-sync`) keeps
everything current with **zero manual entry**.
