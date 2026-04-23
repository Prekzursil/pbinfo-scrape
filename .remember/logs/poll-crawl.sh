#!/usr/bin/env bash
# Polls the crawl snapshot every 5 minutes until pending drops under 50,
# then exits. Intended to be launched via Bash run_in_background + Monitor.
set -e
SNAPSHOT="fresh-20260423-full"
while :; do
  TS=$(date +%H:%M:%S)
  OUT=$(npm run cli -- crawl status --snapshot "$SNAPSHOT" 2>&1)
  PEND=$(echo "$OUT" | awk -F'[: ,]+' '/"pending":/{print $3}')
  DONE=$(echo "$OUT" | awk -F'[: ,]+' '/"completed":/{print $3}')
  PROG=$(echo "$OUT" | awk -F'[: ,]+' '/"inProgress":/{print $3}')
  echo "[$TS] pending=$PEND completed=$DONE inProgress=$PROG"
  if [ -n "$PEND" ] && [ "$PEND" -lt 50 ]; then
    echo "[$TS] CRAWL-DRAIN-NEAR-COMPLETE"
    break
  fi
  sleep 300
done
