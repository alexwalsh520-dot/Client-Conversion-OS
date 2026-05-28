import { NextRequest, NextResponse } from "next/server";
import { getStoredHiggsfieldCredentialStatus, saveHiggsfieldCredentials } from "@/lib/higgsfield-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getStoredHiggsfieldCredentialStatus(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("Studio 2 Higgsfield auth status error:", err);
    return NextResponse.json({ connected: false, source: null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawCredentials = typeof body.credentialsJson === "string" ? body.credentialsJson.trim() : "";
    const credentials = rawCredentials ? JSON.parse(rawCredentials) : body.credentials;
    await saveHiggsfieldCredentials(credentials);
    return NextResponse.json({ ok: true, ...(await getStoredHiggsfieldCredentialStatus()) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save Higgsfield credentials.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
