// Slack notification when a client submits a video testimonial.
// Posts to the #testimonials channel (SLACK_CHANNEL_TESTIMONIALS) via the CCOS
// Coaching Bot (SLACK_BOT_TOKEN_COACHING) — the same bot coaches already use —
// rather than the sales team's default bot. The Coaching Bot must be a member
// of the channel or Slack rejects the post with "not_in_channel".
//
// Fire-and-forget from the submit route: a failure only means no Slack ping;
// the submission is already saved.

const SLACK_POST_MESSAGE = "https://slack.com/api/chat.postMessage";
const TESTIMONIALS_CHANNEL = process.env.SLACK_CHANNEL_TESTIMONIALS || "";

export async function notifyVideoTestimonialCompleted(args: {
  clientName: string;
  coachName: string | null;
  watchUrl: string;
}): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN_COACHING;
  if (!token) {
    console.warn("[testimonials/notify-video] SLACK_BOT_TOKEN_COACHING not set; skipping");
    return;
  }
  if (!TESTIMONIALS_CHANNEL) {
    console.warn("[testimonials/notify-video] SLACK_CHANNEL_TESTIMONIALS not set; skipping");
    return;
  }

  const coachLine = args.coachName ? args.coachName : "Unassigned";
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "New video testimonial submitted", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client*\n${args.clientName}` },
        { type: "mrkdwn", text: `*Coach*\n${coachLine}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Watch testimonial", emoji: true },
          url: args.watchUrl,
          action_id: "watch_video_testimonial",
          style: "primary",
        },
      ],
    },
  ];

  try {
    const res = await fetch(SLACK_POST_MESSAGE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: TESTIMONIALS_CHANNEL,
        text: "New video testimonial submitted", // fallback for notifications/a11y
        blocks,
        username: "CCOS Coaching Bot",
        icon_emoji: ":clapper:",
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.warn(`[testimonials/notify-video] Slack post failed: ${data.error}`);
    }
  } catch (err) {
    console.warn("[testimonials/notify-video] Slack post error:", err);
  }
}
