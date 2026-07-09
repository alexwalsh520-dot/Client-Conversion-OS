// Precompile the Ads tab's in-browser Babel block to plain JS at build time, using the EXACT same
// babel-standalone version (7.29.0) and preset ("react") the browser uses, so the output is identical
// by construction. SOURCE OF TRUTH is public/ads-tracker-export.src.html (editable JSX); this writes
// the served public/ads-tracker-export.html (compiled, do not hand-edit). Verifies the result parses.
//
// Needs @babel/standalone@7.29.0: `npm install --no-save @babel/standalone@7.29.0` (or add as devDep).
import fs from "fs";
import * as Babel from "@babel/standalone";
import { parse } from "@babel/parser";

const SRC = "public/ads-tracker-export.src.html";
const OUT = "public/ads-tracker-export.html";
const html = fs.readFileSync(SRC, "utf8");

const openTag = '<script type="text/babel" data-presets="react">';
const openIdx = html.indexOf(openTag);
if (openIdx < 0) { console.error("FAIL: text/babel block not found in source"); process.exit(1); }
const bodyStart = openIdx + openTag.length;
const closeIdx = html.indexOf("</script>", bodyStart);
if (closeIdx < 0) { console.error("FAIL: closing </script> not found"); process.exit(1); }
const jsx = html.slice(bodyStart, closeIdx);

const { code } = Babel.transform(jsx, { presets: ["react"], compact: false, comments: true });
if (!code || !code.length) { console.error("FAIL: empty transpile output"); process.exit(1); }

try { parse(code, { sourceType: "script", plugins: [] }); }
catch (e) { console.error("FAIL: compiled output does not parse:", e.message); process.exit(1); }
if (!code.includes("React.createElement")) { console.error("FAIL: no React.createElement (transform did not run)"); process.exit(1); }

const banner = "\n<!-- COMPILED BUILD, DO NOT EDIT BY HAND. Edit public/ads-tracker-export.src.html then run: node scripts/precompile-ads-tab.mjs -->";
let out = html.slice(0, openIdx) + "<script>\n" + code + "\n</script>" + html.slice(closeIdx + "</script>".length);
const before = out.length;
out = out.replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone@7\.29\.0\/babel\.min\.js"[\s\S]*?<\/script>\s*/, "");
if (out.length >= before) { console.error("FAIL: could not remove the babel-standalone loader"); process.exit(1); }
if (out.includes('type="text/babel"')) { console.error("FAIL: a text/babel script still remains"); process.exit(1); }
if (!/COMPILED BUILD, DO NOT EDIT/.test(out)) out = out.replace(/(<!doctype html>|<!DOCTYPE html>)/i, "$1" + banner);

fs.writeFileSync(OUT, out);
console.log("OK  jsx", Math.round(jsx.length / 1024), "KB -> compiled", Math.round(code.length / 1024), "KB; babel loader removed; parses clean");
