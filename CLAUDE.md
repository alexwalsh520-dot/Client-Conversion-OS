# Claude Instructions For CCOS

Read and follow `AGENTS.md` before making or shipping changes.

The critical rule: this repo has teammates and AI agents pushing to `main` often. Never assume local code is current. Always fetch and rebase onto latest `origin/main` before pushing or preparing a main-bound change.

Required pre-push guard:

```bash
npm run guard:main
```

Never force-push to `main`. Never revert unrelated teammate changes.
