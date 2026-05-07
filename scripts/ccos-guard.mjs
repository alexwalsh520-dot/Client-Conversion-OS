#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import path from "node:path";

const EXPECTED_ROOT = "/Users/alexwalsh/Documents/Codex - CCOS/Client-Conversion-OS";
const EXPECTED_REMOTE = "https://github.com/alexwalsh520-dot/Client-Conversion-OS.git";
const EXPECTED_PROJECT_ID = "prj_xxUEguiWepcgyXvczfj6lWMzWX8z";

const allowDirty = process.argv.includes("--allow-dirty");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function fail(message, details = "") {
  console.error(`\nCCOS guard failed: ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

function warn(message) {
  console.warn(`CCOS guard warning: ${message}`);
}

let root;
try {
  root = run("git", ["rev-parse", "--show-toplevel"]);
} catch {
  fail("this is not a Git repository");
}

const realRoot = realpathSync(root);
const expectedRoot = realpathSync(EXPECTED_ROOT);
if (realRoot !== expectedRoot) {
  fail(
    "wrong repository folder",
    `Expected: ${expectedRoot}\nActual:   ${realRoot}`
  );
}

const remote = run("git", ["remote", "get-url", "origin"]);
if (remote !== EXPECTED_REMOTE) {
  fail("wrong GitHub remote", `Expected: ${EXPECTED_REMOTE}\nActual:   ${remote}`);
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  fail("wrong branch", `Expected: main\nActual:   ${branch}`);
}

run("git", ["fetch", "origin", "main", "--quiet"]);

const head = run("git", ["rev-parse", "HEAD"]);
const originMain = run("git", ["rev-parse", "origin/main"]);
if (head !== originMain) {
  const counts = run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
  fail(
    "local main is not exactly origin/main",
    `HEAD:        ${head.slice(0, 12)}\norigin/main: ${originMain.slice(0, 12)}\nahead/behind: ${counts}`
  );
}

const status = run("git", ["status", "--short"]);
if (status && !allowDirty) {
  fail("working tree is dirty", `${status}\n\nUse npm run guard -- --allow-dirty only after you intentionally start work.`);
}

const vercelProjectPath = path.join(root, ".vercel", "project.json");
if (existsSync(vercelProjectPath)) {
  try {
    const project = JSON.parse(readFileSync(vercelProjectPath, "utf8"));
    if (project.projectId !== EXPECTED_PROJECT_ID) {
      fail(
        "wrong Vercel project link",
        `Expected projectId: ${EXPECTED_PROJECT_ID}\nActual projectId:   ${project.projectId || "(missing)"}`
      );
    }
  } catch (error) {
    fail("could not read .vercel/project.json", String(error));
  }
} else {
  warn(".vercel/project.json is missing; deploys may target the wrong Vercel project");
}

console.log("CCOS guard passed.");
console.log(`Root: ${realRoot}`);
console.log(`Commit: ${head.slice(0, 12)}`);
