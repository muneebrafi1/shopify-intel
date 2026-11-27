#!/bin/bash
# Snapshot a SQLite database *including* its write-ahead log.
# A plain `cp` of the .sqlite file misses the WAL, so derived flags such as
# stores.is_captured can stay stale (this is what happened to b4-finish.sh).
#
# Usage: scripts/ops/sqlite-backup.sh <source.sqlite> <dest.sqlite>
set -euo pipefail
# sqlite3 is not on PATH on the box; it ships with the Android platform-tools.
for d in /home/box/Android/platform-tools /usr/local/bin; do [ -x "$d/sqlite3" ] && PATH="$PATH:$d"; done
command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
if [ $# -ne 2 ]; then
  echo "usage: $0 <source.sqlite> <dest.sqlite>" >&2
  exit 2
fi
src=$1 dest=$2
[ -f "$src" ] || { echo "missing source: $src" >&2; exit 1; }
mkdir -p "$(dirname "$dest")"
tmp="${dest}.tmp"
rm -f "$tmp" "$dest"
sqlite3 "$src" ".timeout 8000" ".backup '$tmp'"
check=$(sqlite3 "$tmp" "PRAGMA integrity_check;")
[ "$check" = "ok" ] || { echo "integrity_check failed: $check" >&2; rm -f "$tmp"; exit 1; }
mv "$tmp" "$dest"
echo "snapshot $dest ($(sqlite3 "$dest" "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size();") bytes)"
