const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_APPOINTMENT_CHANNEL = "C0941TYBNJE";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface SlackAppointmentBooking {
  postedAt: string;
  closerName: string | null;
  offer: string | null;
  appointmentTime: string | null;
  prospectName: string | null;
  phone: string | null;
  email: string | null;
  rawText: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  has_more?: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
  messages?: Array<{
    ts?: string;
    text?: string;
    subtype?: string;
  }>;
}

interface SlackJoinResponse {
  ok: boolean;
  error?: string;
}

interface SlackAuthTestResponse {
  ok: boolean;
  error?: string;
  user_id?: string;
}

function getBotToken() {
  return process.env.SLACK_BOT_TOKEN || null;
}

function getAppointmentChannelId() {
  return process.env.SLACK_CHANNEL_APPOINTMENT_NOTIFS || DEFAULT_APPOINTMENT_CHANNEL;
}

function toUnixSeconds(date: string, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  return String(Math.floor(new Date(`${date}${suffix}`).getTime() / 1000));
}

function readField(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function parseMessage(text: string, ts: string): SlackAppointmentBooking | null {
  if (!/new appointment booked/i.test(text)) return null;

  return {
    postedAt: new Date(Number(ts) * 1000).toISOString(),
    closerName: readField(text, "Closer"),
    offer: readField(text, "Offer"),
    appointmentTime: readField(text, "Appointment Time"),
    prospectName: readField(text, "Prospect Name"),
    phone: readField(text, "Phone"),
    email: readField(text, "Email"),
    rawText: text,
  };
}

export async function fetchSlackAppointmentBookings(
  dateFrom: string,
  dateTo: string,
): Promise<SlackAppointmentBooking[]> {
  const token = getBotToken();
  if (!token) return [];

  const channel = getAppointmentChannelId();
  const oldest = toUnixSeconds(addDays(dateFrom, -1), false);
  const latest = toUnixSeconds(addDays(dateTo, 1), true);
  const bookings: SlackAppointmentBooking[] = [];

  try {
    const joinRes = await fetch(`${SLACK_API_BASE}/conversations.join`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel }),
      cache: "no-store",
    });

    if (joinRes.ok) {
      const joinData = (await joinRes.json()) as SlackJoinResponse;
      if (!joinData.ok && joinData.error !== "already_in_channel") {
        console.warn("[slack-appointments] join warning", joinData.error);

        const authRes = await fetch(`${SLACK_API_BASE}/auth.test`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          cache: "no-store",
        });

        if (authRes.ok) {
          const authData = (await authRes.json()) as SlackAuthTestResponse;
          if (authData.ok && authData.user_id) {
            const inviteRes = await fetch(`${SLACK_API_BASE}/conversations.invite`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json; charset=utf-8",
              },
              body: JSON.stringify({
                channel,
                users: authData.user_id,
              }),
              cache: "no-store",
            });

            if (inviteRes.ok) {
              const inviteData = (await inviteRes.json()) as SlackJoinResponse;
              if (!inviteData.ok && inviteData.error !== "already_in_channel") {
                console.warn("[slack-appointments] invite warning", inviteData.error);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn("[slack-appointments] join request failed", error);
  }

  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams({
      channel,
      oldest,
      latest,
      inclusive: "true",
      limit: "200",
    });

    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${SLACK_API_BASE}/conversations.history?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[slack-appointments] HTTP error", res.status);
      return bookings;
    }

    const data = (await res.json()) as SlackHistoryResponse;
    if (!data.ok) {
      console.error("[slack-appointments] API error", data.error);
      return bookings;
    }

    for (const message of data.messages || []) {
      if (!message.ts || !message.text || message.subtype) continue;
      const parsed = parseMessage(message.text, message.ts);
      if (parsed) bookings.push(parsed);
    }

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!data.has_more || !cursor) break;
  }

  return bookings;
}
