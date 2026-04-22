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

const { data: users, error } = await sb
  .from("app_users")
  .select("email, role, is_active, allowed_tabs");

if (error) {
  console.error("Error reading app_users:", error);
  process.exit(1);
}

console.log("\nCurrent app_users:");
console.log(
  users
    .map(
      (u) =>
        `  ${u.email.padEnd(40)} role=${u.role?.padEnd(6) ?? "null  "} active=${u.is_active} tabs=[${(u.allowed_tabs ?? []).length}]`
    )
    .join("\n")
);

const updated = [];

for (const u of users) {
  const tabs = Array.isArray(u.allowed_tabs) ? u.allowed_tabs : [];
  if (tabs.includes("/accountant")) continue;

  // Only update users who already have tool tabs (e.g. /sales-hub) — admins
  // are filtered-bypassed anyway, but updating all active users is safest.
  if (!u.is_active) continue;

  const next = [...tabs, "/accountant"];
  const { error: upErr } = await sb
    .from("app_users")
    .update({ allowed_tabs: next })
    .eq("email", u.email);
  if (upErr) {
    console.error(`  ✗ ${u.email}: ${upErr.message}`);
    continue;
  }
  updated.push(u.email);
}

console.log(
  `\nAdded /accountant to ${updated.length} user${updated.length === 1 ? "" : "s"}:`
);
updated.forEach((e) => console.log(`  ✓ ${e}`));
