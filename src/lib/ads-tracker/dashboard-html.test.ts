import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@babel/parser";

// The Ads tab is a static HTML file whose entire app is ONE inline
// <script type="text/babel"> compiled in the browser by @babel/standalone with
// the React preset. If that script has ANY syntax error — a duplicate top-level
// declaration, stray TypeScript syntax, etc. — Babel fails to compile it and the
// whole tab renders a blank white page with no error. (This exact thing happened:
// a duplicate `function smoothPath` blanked the dashboard.)
//
// esbuild is too lenient to catch it (it tolerates redeclared functions and
// strips TS). So this guard parses the inline app the SAME way the browser does —
// @babel/parser with the jsx plugin and NO typescript — and fails the build if it
// won't compile. This makes "a JS error blanks the dashboard" impossible to ship.

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "../../../public/ads-tracker-export.html");

test("ads-tracker-export.html inline app compiles (browser-equivalent Babel parse)", () => {
  const html = readFileSync(htmlPath, "utf8");
  const re = /<script[^>]*type=["']text\/babel["'][^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  let code = "";
  let blocks = 0;
  while ((m = re.exec(html))) {
    code += m[1] + "\n;\n";
    blocks++;
  }
  assert.ok(blocks > 0, "expected a <script type=text/babel> block in the dashboard HTML");
  assert.doesNotThrow(
    () => parse(code, { sourceType: "module", plugins: ["jsx"] }),
    "the inline dashboard app has a syntax error that would blank the whole Ads tab"
  );
});
