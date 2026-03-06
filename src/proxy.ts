export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/sync|api/dm-reviews/transcripts|api/dm-reviews/review-transcript|_next/static|_next/image|favicon\\.ico|login|review).*)",
  ],
};
