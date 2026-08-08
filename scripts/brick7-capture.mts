// One-off capture for docs/truthlayer-brick7-report.md: asks the door the two
// new questions exactly as a caller would, and prints the answers whole so they
// can be pasted into the report byte for byte. Not part of the app.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const p = resolve(process.cwd(), ".env.local");
if (existsSync(p)) {
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { createClient } = await import("@supabase/supabase-js");
const { askQuestion } = await import("../src/lib/question-door/service.js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
}) as never;

const which = process.argv[2];
const params = JSON.parse(process.argv[3] || "{}");
const key = which === "bench" ? "creative_bench" : "ad_copy";
const r = await askQuestion({ question_key: key, params }, { db, clients: ["tyson", "jake"], caller: "report" });
console.log(JSON.stringify(r, null, 2));
