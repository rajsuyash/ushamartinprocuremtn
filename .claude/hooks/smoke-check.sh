#!/usr/bin/env bash
# Stop hook: runs when Claude tries to finish a turn.
# Exit 2 blocks the stop and feeds stderr back to Claude; exit 0 allows it.
# Requires the dev server to run as: pnpm dev 2>&1 | tee .claude/dev-server.log

LOG=".claude/dev-server.log"
FAIL=0
MSG=""

if [ -f "$LOG" ]; then
  # Unified error patterns from Next.js dev output. Tail keeps it cheap and recent.
  PATTERNS='Unhandled Runtime Error|Hydration failed|Text content does not match|ReferenceError|TypeError:|ECONNREFUSED|EADDRINUSE|Module not found|Cannot find module|Failed to compile|UnhandledPromiseRejection|FATAL|Uncaught \(in promise\)'
  HITS=$(tail -n 300 "$LOG" | grep -E "$PATTERNS" | tail -n 5)
  if [ -n "$HITS" ]; then
    FAIL=1
    MSG="$MSG Dev-server log shows runtime errors (fix before claiming done):\n$HITS\n"
  fi
fi

if [ "$FAIL" -eq 1 ]; then
  printf "%b" "$MSG" >&2
  exit 2
fi
exit 0
