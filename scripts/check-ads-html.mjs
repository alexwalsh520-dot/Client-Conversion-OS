// Guard: the ads tab (public/ads-tracker-export.html) is one big HTML file whose
// JavaScript is compiled in the browser, so a syntax typo silently blanks the whole
// tab and nothing catches it before it ships. This wires that check into the build:
// every inline <script> is parsed with the Node syntax checker, and the build FAILS
// on any syntax error. So a broken ads tab can no longer reach production.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = "public/ads-tracker-export.html";
const html = readFileSync(FILE, "utf8");

// Every inline script that is real JS (has no src=, is not a JSON/importmap block).
const blocks = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  const body = m[2] || "";
  if (/\bsrc\s*=/.test(attrs)) continue; // external, nothing to parse
  if (/type\s*=\s*["'](application\/json|importmap)["']/i.test(attrs)) continue;
  if (!body.trim()) continue;
  blocks.push({ body, line: html.slice(0, m.index).split("\n").length });
}

const dir = mkdtempSync(join(tmpdir(), "adshtml-"));
let failed = 0;
blocks.forEach((b, i) => {
  const tmp = join(dir, `block-${i}.js`);
  writeFileSync(tmp, b.body);
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (err) {
    failed += 1;
    const out = (err.stderr || err.stdout || Buffer.from(String(err))).toString();
    console.error(`\n[check-ads-html] SYNTAX ERROR in ${FILE} (inline script starting near line ${b.line}):\n${out}`);
  }
});

if (failed) {
  console.error(`[check-ads-html] ${failed} inline script(s) failed to parse. Build blocked so the ads tab can't ship broken.`);
  process.exit(1);
}
console.log(`[check-ads-html] OK — ${blocks.length} inline script(s) parse cleanly.`);
