// GHL coaching-side integration: upsert a contact in the connected GHL
// Location and attach a tag that a GHL workflow can trigger on.
//
// This lives beside src/lib/ghl.ts (the outreach integration) but uses
// its own env vars because the coaching flow uses a different Private
// Integration token (scoped to contacts.write only) than the outreach
// side. If you unify them later, just point both env var names at the
// same value.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function getConfig(): { token: string; locationId: string } | null {
  const token = process.env.GHL_ACCESS_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return null;
  return { token, locationId };
}

export interface UpsertContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** Tags to add. A GHL workflow triggered on "Contact Tag Added" filters on one of these. */
  tags: string[];
  /** Optional custom fields — key/value pairs the GHL contact record will store. */
  customFields?: Record<string, string | number | null | undefined>;
}

export interface UpsertContactResult {
  ok: boolean;
  status: number;
  contactId?: string;
  skipped?: "no_config" | "no_email";
  error?: string;
}

/**
 * Upsert a contact (identify by email) and attach the given tags.
 *
 * Behavior:
 *   - Returns skipped: "no_config" if the env vars are missing. Callers
 *     should treat this as a soft no-op so a misconfigured env doesn't
 *     break the primary write (intake save, client insert).
 *   - Returns skipped: "no_email" if no email was supplied.
 *   - Otherwise POSTs to /contacts/upsert. Never throws; all errors are
 *     returned in the result object.
 *
 * GHL's upsert dedupes by email + locationId, so calling this multiple
 * times with the same email updates the same contact. Adding a tag that
 * is already on the contact is a silent no-op on GHL's side (does not
 * re-fire the "Contact Tag Added" trigger).
 */
export async function upsertCoachingContact(
  input: UpsertContactInput,
): Promise<UpsertContactResult> {
  if (!input.email) return { ok: false, status: 0, skipped: "no_email" };
  const cfg = getConfig();
  if (!cfg) return { ok: false, status: 0, skipped: "no_config" };

  const body: Record<string, unknown> = {
    email: input.email.trim().toLowerCase(),
    locationId: cfg.locationId,
    tags: input.tags,
  };
  if (input.firstName) body.firstName = input.firstName;
  if (input.lastName) body.lastName = input.lastName;
  if (input.phone) body.phone = input.phone;
  if (input.customFields) {
    const fields = Object.entries(input.customFields)
      .filter(([, v]) => v != null && v !== "")
      .map(([key, value]) => ({ key, field_value: String(value) }));
    if (fields.length > 0) body.customFields = fields;
  }

  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        Version: GHL_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `GHL upsert failed (${res.status}): ${text.slice(0, 300)}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as {
      contact?: { id?: string };
    };
    return { ok: true, status: res.status, contactId: data.contact?.id };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
