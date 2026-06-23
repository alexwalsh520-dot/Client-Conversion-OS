#!/bin/bash
# Local revision watcher. Every ~45s it runs the revision queue, so anything you
# drop into the Factory "Revision" column auto-regenerates (and comes back as v2)
# while you work. Generation must run here (local Higgsfield CLI + local raw pics);
# the cloud app can't reach those. Launched detached via nohup; survives restarts.
cd "/Users/alexwalsh/Documents/All/AI Assets/Claude Code Experiment/dashboard" || exit 1
export HIGGSFIELD_CREDENTIALS_PATH=/tmp/hfauth/credentials.json
LOG=/tmp/factory-watcher.log
echo "===== WATCHER START $(date) =====" >> "$LOG"
while true; do
  node scripts/factory-generate.mjs --revisions >> "$LOG" 2>&1
  sleep 45
done
