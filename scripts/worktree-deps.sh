#!/usr/bin/env bash
# Give a git worktree of this repo its own node_modules: everything links to
# the main checkout's installed packages, except the workspace packages
# (@mimicry/*), which link to the worktree's own sources.
set -euo pipefail
main="${1:?usage: scripts/worktree-deps.sh <main checkout>}"
here="$(git rev-parse --show-toplevel)"
[ "$main" -ef "$here" ] && { echo "run this inside a worktree"; exit 1; }
rm -rf "$here/node_modules"
mkdir -p "$here/node_modules/@mimicry"
for entry in "$main"/node_modules/* "$main"/node_modules/.bin; do
  name="$(basename "$entry")"
  [ "$name" = "@mimicry" ] && continue
  ln -s "$entry" "$here/node_modules/$name"
done
for pkg in "$here"/packages/*; do
  ln -s "../../packages/$(basename "$pkg")" "$here/node_modules/@mimicry/$(basename "$pkg")"
done
echo "node_modules ready in $here"
