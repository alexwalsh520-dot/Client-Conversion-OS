import { NextRequest, NextResponse } from "next/server";

// GHL v1 API for calendar events and contacts
const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";

function getApiKey(): string {
  const key = process.env.GHL_V1_API_KEY;
  if (!key) throw new Error("GHL_V1_API_KEY not configured");
  return key;
}

function getCalendarIds(): string[] {
  const ids: string[] = [];
  const tysonId = process.env.GHL_CALENDAR_ID_TYSON;
  if (tysonId) ids.push(tysonId);
  const keithId = process.env.GHL_CALENDAR_ID_KEITH;
  if (keithId) ids.push(keithId);
  return ids;
}

interface RiskAssessment {
  score: number; // 0-100, higher = more risk of no-show
  level: "low" | "medium" | "high";
  signals: string[];
}

function computeRiskScore(appointment: Record<string, unknown>, contact: Record<string, unknown> | null): RiskAssessment {
  const signals: string[] = [];
  let score = 30; // Base risk score

  // Check appointment status
  const status = String(appointment.status || appointment.appointmentStatus || "").toLowerCase();
  if (status === "confirmed") {
    score -= 10;
    signals.push("Appointment confirmed");
  } else if (status === "pending" || status === "new") {
    score += 10;
    signals.push("Appointment not yet confirmed");
  }

  // Check if contact data is available
  if (!contact) {
    score += 15;
    signals.push("No contact data available — limited risk assessment");
  } else {
    // Check for email
    const email = contact.email || contact.emailAddress;
    if (!email) {
      score += 10;
      signals.push("No email on file");
    }

    // Check for phone
    const phone = contact.phone || contact.phoneNumber;
    if (!phone) {
      score += 10;
      signals.push("No phone number on file");
    }

    // Check engagement signals
    const tags = contact.tags as string[] | undefined;
    if (tags && Array.isArray(tags)) {
      if (tags.some((t) => typeof t === "string" && t.toLowerCase().includes("engaged"))) {
        score -= 10;
        signals.push("Tagged as engaged");
      }
      if (tags.some((t) => typeof t === "string" && t.toLowerCase().includes("no_show"))) {
        score += 20;
        signals.push("Previous no-show history");
      }
      if (tags.some((t) => typeof t === "string" && t.toLowerCase().includes("rescheduled"))) {
        score += 10;
        signals.push("Has rescheduled before");
      }
    }

    // Check custom fields for budget / qualification signals
    const customFields = contact.customField as Record<string, string>[] | undefined;
    if (customFields && Array.isArray(customFields)) {
      const budgetField = customFields.find(
        (f) => f.key?.toLowerCase().includes("budget") || f.fieldKey?.toLowerCase().includes("budget")
      );
      if (budgetField && budgetField.value) {
        signals.push(`Budget indicated: ${budgetField.value}`);
        score -= 5;
      }
    }

    // Check how recently they were created
    const dateAdded = contact.dateAdded || contact.createdAt;
    if (dateAdded && typeof dateAdded === "string") {
      const addedDate = new Date(dateAdded);
      const daysSinceAdded = (Date.now() - addedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceAdded < 1) {
        signals.push("Brand new lead (added today)");
      } else if (daysSinceAdded > 14) {
        score += 10;
        signals.push("Lead is 14+ days old — may have cooled off");
      }
    }
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  const level: RiskAssessment["level"] =
    score >= 60 ? "high" : score >= 35 ? "medium" : "low";

  return { score, level, signals };
}

export async function GET(_req: NextRequest) {
  try {
    const apiKey = getApiKey();
    const calendarIds = getCalendarIds();

    if (calendarIds.length === 0) {
      return NextResponse.json(
        { leads: [], error: "No GHL calendar IDs configured" },
        { status: 200 }
      );
    }

    // Fetch upcoming appointments for the next 7 days
    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startDate = now.getTime();
    const endDate = sevenDaysOut.getTime();

    // Fetch appointments from all calendars
    const appointmentResults = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!res.ok) {
          console.error(`GHL risk-score: failed to fetch calendar ${calendarId} (${res.status})`);
          return [];
        }

        const data = await res.json();
        const appointments = data.appointments || data.events || data || [];
        return Array.isArray(appointments) ? appointments : [];
      })
    );

    const allAppointments = appointmentResults.flat();

    // For each appointment, try to fetch contact data and compute risk score
    const leads = await Promise.all(
      allAppointments.map(async (appointment: Record<string, unknown>) => {
        const contactId = String(appointment.contactId || appointment.contact_id || "");
        let contact: Record<string, unknown> | null = null;

        if (contactId) {
          try {
            const contactRes = await fetch(`${GHL_V1_BASE}/contacts/${contactId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (contactRes.ok) {
              const contactData = await contactRes.json();
              contact = contactData.contact || contactData;
            }
          } catch (err) {
            console.warn(`GHL risk-score: failed to fetch contact ${contactId}:`, err);
          }
        }

        const riskAssessment = computeRiskScore(appointment, contact);

        return {
          appointment: {
            id: appointment.id || appointment._id,
            calendarId: appointment.calendarId || appointment.calendar_id,
            title: appointment.title || appointment.name,
            startTime: appointment.startTime || appointment.start_time,
            endTime: appointment.endTime || appointment.end_time,
            status: appointment.status || appointment.appointmentStatus,
          },
          contact: contact
            ? {
                id: contact.id || contact._id,
                name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.name || "Unknown",
                email: contact.email || contact.emailAddress || null,
                phone: contact.phone || contact.phoneNumber || null,
              }
            : null,
          riskAssessment,
        };
      })
    );

    // Sort by risk score descending (highest risk first)
    leads.sort((a, b) => b.riskAssessment.score - a.riskAssessment.score);

    return NextResponse.json({ leads });
  } catch (err) {
    console.error("Risk score computation error:", err);
    return NextResponse.json(
      { leads: [], error: err instanceof Error ? err.message : "Failed to compute risk scores" },
      { status: 500 }
    );
  }
}
