#!/usr/bin/env bash
# Pushes one oracle job's captures, report and log tail to its own branch:
# oracle-out/<platform>-<project name>. Used by .github/workflows/oracle.yml.
set -euo pipefail
PLATFORM="$1"
NAME="$(basename "${PROJECT:-examples/showcase}")"
OUT="$RUNNER_TEMP/results"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "oracle/$NAME/." "$OUT/" 2>/dev/null || true
tail -c 120000 "$RUNNER_TEMP/oracle-log.txt" > "$OUT/log-tail.txt" 2>/dev/null || true
{ echo "outcome: ${OUTCOME:-unknown}"; echo "commit: $GITHUB_SHA"; echo "platform: $PLATFORM"; echo "project: ${PROJECT:-}"; } > "$OUT/status.txt"
cd "$OUT"
git init -q
git config user.name "mimicry-oracle"
git config user.email "oracle@users.noreply.github.com"
git add -A
git commit -qm "Oracle $PLATFORM results for $NAME at $GITHUB_SHA"
git push -f "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}" "HEAD:oracle-out/$PLATFORM-$NAME"
