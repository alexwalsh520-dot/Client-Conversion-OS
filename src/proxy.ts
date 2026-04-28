export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/public|api/sync|api/sales-hub/transcripts|api/sales-hub/review-transcript|api/sales-hub/manychat-webhook|api/sales-hub/ghl-appointment-webhook|api/sales-hub/ghl-conversation-webhook|api/sales-hub/setter-report-data|api/sales-hub/slack-events|api/sales-hub/slack-agent|api/webhooks|api/cron|api/setup|_next/static|_next/image|favicon\\.ico|login|review|voice-notes).*)",
  ],
};
