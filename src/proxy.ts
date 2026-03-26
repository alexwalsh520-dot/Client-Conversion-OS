export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/sync|api/sales-hub/transcripts|api/sales-hub/review-transcript|api/sales-hub/manychat-webhook|api/sales-hub/debug-|api/sales-hub/slack-events|api/sales-hub/slack-agent|api/sales-hub/sheet-data|api/webhooks|api/cron|api/setup|_next/static|_next/image|favicon\\.ico|login|review).*)",
  ],
};
