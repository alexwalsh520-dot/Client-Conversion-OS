import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(
  "/Users/matthew_conder/Claude Projects/Client-Conversion-OS/.env.production",
  "utf8"
);
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      const k = l.slice(0, i).trim();
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [k, v];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: clients } = await sb
  .from("app_users")
  .select("email, role, allowed_tabs")
  .eq("role", "client");

const removed = [];
for (const u of clients ?? []) {
  const tabs = Array.isArray(u.allowed_tabs) ? u.allowed_tabs : [];
  if (!tabs.includes("/accountant")) continue;
  const next = tabs.filter((t) => t !== "/accountant");
  const { error } = await sb
    .from("app_users")
    .update({ allowed_tabs: next })
    .eq("email", u.email);
  if (error) {
    console.error(`  ✗ ${u.email}: ${error.message}`);
    continue;
  }
  removed.push(u.email);
}

console.log(`Removed /accountant from ${removed.length} client users:`);
removed.forEach((e) => console.log(`  ✓ ${e}`));
