import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every folder under src/app/p is a public, no-login share link. Each one MUST
// also be named in AccessGate's public-page list, or the page renders for a
// moment and then throws the client at /login, and the person holding the link
// simply cannot get in.
//
// This exists because it happened. The Ads v2 share link shipped working on
// 24 July; on 27 July the Factory share link REPLACED its line in AccessGate
// instead of being added beside it (commit 7683ddf), and Jake's link started
// bouncing to the Google sign-in page. Nothing failed loudly: the route still
// returned 200, the token was still valid, and only opening the link in a
// logged-out browser showed it. A new share link is exactly the moment this
// list gets edited, so the guard belongs next to the list.
const SHARE_ROUTES_DIR = join(process.cwd(), "src/app/p");
const ACCESS_GATE = join(process.cwd(), "src/components/AccessGate.tsx");

function publicShareRoutes(): string[] {
  return readdirSync(SHARE_ROUTES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test("every /p/<kind> share route is allowed through AccessGate", () => {
  const gate = readFileSync(ACCESS_GATE, "utf8");
  const routes = publicShareRoutes();

  // A guard that guards nothing is worse than no guard, so prove we found the
  // routes at all before trusting the assertions below.
  assert.ok(routes.length > 0, "found no share routes under src/app/p");

  const missing = routes.filter(
    (kind) => !gate.includes(`pathname.startsWith("/p/${kind}/")`),
  );

  assert.deepEqual(
    missing,
    [],
    `these share links will bounce their holder to /login because AccessGate ` +
      `does not list them: ${missing.map((k) => `/p/${k}/`).join(", ")}. ` +
      `Add pathname.startsWith("/p/<kind>/") to isPublicPage in AccessGate.tsx ` +
      `(add a line, never replace an existing one).`,
  );
});
