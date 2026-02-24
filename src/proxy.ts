export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/sync|_next/static|_next/image|favicon\\.ico|login).*)",
  ],
};
