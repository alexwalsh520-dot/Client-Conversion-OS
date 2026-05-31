# Main Safety For CCOS

CCOS has multiple teammates and AI coding agents shipping quickly. The standard workflow is:

```bash
git fetch origin
git switch -c your-branch origin/main
# make the change
git fetch origin
git rebase --autostash origin/main
npm run guard:main
```

If `npm run guard:main` fails, do not push. Rebase on the latest `origin/main`, re-run the relevant checks, then try again.

## Recommended GitHub Repository Settings

These settings cannot be fully enforced by files in the repo; an admin should set them in GitHub:

- Protect `main`.
- Disable force pushes to `main`.
- Require pull requests before merging.
- Require branches to be up to date before merging.
- Require the `Fresh main guard / Branch contains latest main` status check.
- Prefer linear history if the team is comfortable with rebase-based shipping.

This gives both humans and AI agents a hard stop before stale code can overwrite newer shipped work.
