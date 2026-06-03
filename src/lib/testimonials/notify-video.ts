// Slack notification when a client submits a video testimonial.
// Posts to the #testimonials channel (SLACK_CHANNEL_TESTIMONIALS) with the
// owning coach and a button to watch the testimonial in CCOS.
//
// Fire-and-forget from the submit route: a failure only means no Slack ping;
// the submission is already saved.

import { postRichMessage } from "@/lib/slack";

const TESTIMONIALS_CHANNEL = process.env.SLACK_CHANNEL_TESTIMONIALS || "";

export async function notifyVideoTestimonialCompleted(args: {
  clientName: string;
  coachName: string | null;
  watchUrl: string;
}): Promise<void> {
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

  const ok = await postRichMessage(TESTIMONIALS_CHANNEL, blocks);
  if (!ok) {
    console.warn("[testimonials/notify-video] postRichMessage failed");
  }
}
