// Recover an item whose image generated fine but whose Storage upload failed
// (transient DB timeout). Uploads the local PNG the generator already saved and
// wires it into factory_items + factory_item_versions, so we do not pay for and
// wait on a whole new generation just to replace a lost upload.
//
// Usage:
//   node scripts/factory-upload-local.mjs --project "<name>" --client <key> \
//     --label BG37 --file "/path/to/BG37.png"
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
function env(key) {
  const line = envText.split(/\r?\n/).find((x) => x.startsWith(key + "="));
  if (!line) return "";
  let v = line.slice(key.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const STORAGE_BUCKET = "ad-variations";
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const projectName = flag("--project");
const clientKey = flag("--client");
const label = flag("--label");
const file = flag("--file");
if (!projectName || !label || !file) {
  console.error('Usage: --project "<name>" [--client <key>] --label <LABEL> --file <path>');
  process.exit(1);
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

let q = sb.from("factory_projects").select("id, name, client").eq("name", projectName);
if (clientKey) q = q.eq("client", clientKey);
const { data: project, error: pErr } = await q.maybeSingle();
if (pErr) throw new Error(pErr.message);
if (!project) throw new Error(`Project not found: ${projectName}`);

const { data: item, error: iErr } = await sb
  .from("factory_items")
  .select("*")
  .eq("project_id", project.id)
  .eq("label", label)
  .maybeSingle();
if (iErr) throw new Error(iErr.message);
if (!item) throw new Error(`Item not found: ${label}`);

const bytes = await fsp.readFile(file);
if (!bytes.length) throw new Error("Local file is empty");
const ext = path.extname(file).slice(1).toLowerCase() || "png";
const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;

const objectPath = `factory/${slugify(project.name)}/${label}-${Date.now()}-${crypto
  .randomBytes(4)
  .toString("hex")}.${ext}`;

const { error: upErr } = await sb.storage
  .from(STORAGE_BUCKET)
  .upload(objectPath, bytes, { contentType, upsert: true });
if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

const publicUrl = sb.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl;
console.log(`Uploaded ${label} (${bytes.length} bytes) -> ${publicUrl}`);

const { error: updErr } = await sb
  .from("factory_items")
  .update({ image_url: publicUrl, stage: "image_generated", revision_note: null, updated_at: new Date().toISOString() })
  .eq("id", item.id);
if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

const { data: maxV } = await sb
  .from("factory_item_versions")
  .select("version")
  .eq("item_id", item.id)
  .order("version", { ascending: false })
  .limit(1)
  .maybeSingle();
const nextV = ((maxV && maxV.version) || 0) + 1;
const { error: vErr } = await sb
  .from("factory_item_versions")
  .insert({ item_id: item.id, version: nextV, image_url: publicUrl, revision_note: item.revision_note || null });
if (vErr) console.warn(`version insert failed (non-fatal): ${vErr.message}`);

console.log(`${label}: stage=image_generated, version v${nextV}`);
