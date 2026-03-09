export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/sync|api/sales-hub/transcripts|api/sales-hub/review-transcript|api/webhooks|api/cron|_next/static|_next/image|favicon\\.ico|login|review).*)",
  ],
};
