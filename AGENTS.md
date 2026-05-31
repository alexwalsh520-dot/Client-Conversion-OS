# CCOS Agent Safety Rules

This repository is edited by multiple people and AI coding agents at the same time. Treat `main` as moving constantly.

## Non-Negotiable Main Rule

Before shipping, committing for delivery, or pushing anything intended for `main`:

1. Run `git fetch origin`.
2. Confirm the work is based on the latest `origin/main`.
3. If `origin/main` moved, rebase or replay only your own changes on top of it.
4. Re-run the checks that match your change.
5. Never use `git push --force` or `git push --force-with-lease` against `main`.

Use this guard before pushing:

```bash
npm run guard:main
```

If it fails, do not push. Fetch/rebase first.

## Working Pattern For Agents

Start new work from the current main:

```bash
git fetch origin
git switch -c your-branch-name origin/main
```

Before final commit/push:

```bash
git fetch origin
git rebase --autostash origin/main
npm run guard:main
```

If there are conflicts, resolve only your own intended change. Do not delete, revert, or "clean up" unrelated teammate work.

## Why This Exists

CCOS changes quickly. A stale local branch can accidentally remove features that another teammate just shipped. The expected behavior for every coding tool is: latest GitHub `main` first, then apply the current task.
