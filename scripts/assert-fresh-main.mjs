#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fail(message) {
  console.error(`\nCCOS main safety guard failed:\n${message}\n`);
  process.exit(1);
}

try {
  git(["rev-parse", "--is-inside-work-tree"]);
} catch {
  fail("This command must be run inside the CCOS git repository.");
}

try {
  git(["fetch", "origin", "main"]);
} catch (error) {
  fail(`Could not fetch origin/main.\n${error.stderr || error.message}`);
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = git(["rev-parse", "--short", "HEAD"]);
const originMain = git(["rev-parse", "--short", "origin/main"]);

try {
  execFileSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
    stdio: "ignore",
  });
} catch {
  fail(
    [
      `Your branch (${branch} @ ${head}) is not based on the latest origin/main (${originMain}).`,
      "Run:",
      "  git fetch origin",
      "  git rebase --autostash origin/main",
      "Then re-run the relevant tests and this guard.",
    ].join("\n")
  );
}

const status = git(["status", "--porcelain"]);
if (status) {
  fail(
    [
      "You still have uncommitted files. Commit or stash your intended changes before pushing.",
      "",
      status,
    ].join("\n")
  );
}

console.log(`CCOS main safety guard passed: ${branch} @ ${head} contains origin/main @ ${originMain}.`);
