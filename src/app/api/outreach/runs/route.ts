import { NextResponse } from "next/server";

// Run history is stored in localStorage on the client (MVP).
// This route exists as a placeholder for future server-side storage.
// The client reads/writes directly to localStorage via lib/outreach-store.ts.

export async function GET() {
  return NextResponse.json({
    message:
      "Run history is stored client-side in localStorage for MVP. Use the outreach-store.ts client module to read/write runs.",
    storage: "localStorage",
  });
}
