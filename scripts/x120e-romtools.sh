#!/bin/bash
# =====================================================================================
#  romtools.sh - what a game needs, what you have, and what is still missing.
#
#  Exists because "add ROMs" is not one action. A set can be present and unplayable (one file
#  short, or a dump nobody has), a name can be a set rather than a driver (arkanoid_junk), and a
#  parent BIOS is a separate download. This answers all three without guessing.
#
#  Usage:
#     romtools.sh --list                 every driver on this box that actually starts
#     romtools.sh --check <driver>...    required files, and which of them are missing
#     romtools.sh --wish <file>          a plain list of game names -> driver, size, and whether
#                                        this box already has it
#     romtools.sh --rebuild              re-verify every zip in the rom dir and rewrite games.txt
#
#  Exit codes: 0 all good, 1 something is missing (the list says what), 2 bad usage.
# =====================================================================================
set -u

MAMEBIN=/usr/games/mame
HOME_DIR=$(cd "$(dirname "$0")" && pwd)
ROMDIR="$HOME_DIR/mame/roms"
GAMES="$HOME_DIR/mame/games.txt"

[ -x "$MAMEBIN" ] || { echo "no mame at $MAMEBIN" >&2; exit 2; }

# a driver is a name mame recognises; a set named "arkanoid_junk" is not one, and says so
is_driver() {
  "$MAMEBIN" -listfull "$1" >/dev/null 2>&1
}

resolve() {
  # exact driver first, then a title search that must be unambiguous
  local want="$1"
  if is_driver "$want"; then printf '%s\n' "$want"; return 0; fi
  local hits
  hits=$("$MAMEBIN" -listfull 2>/dev/null | awk -v w="$want" 'BEGIN{IGNORECASE=1} $0 ~ ("\"" w) {print $1}' | head -5)
  local n
  n=$(printf '%s\n' "$hits" | grep -c . || true)
  if [ "$n" = "1" ]; then printf '%s\n' "$hits"; return 0; fi
  if [ "$n" -gt 1 ]; then
    echo "AMBIGUOUS: $want matches $(printf '%s' "$hits" | tr '\n' ' ')" >&2
    return 1
  fi
  echo "UNKNOWN: no driver called or titled \"$want\"" >&2
  return 1
}

check_one() {
  local d="$1" out missing required
  # mame -listroms prints "Name ... Size Checksum" then one row per file:  name  <size>  CRC(..) SHA1(..)
  required=$("$MAMEBIN" -listroms "$d" 2>/dev/null | awk '
    /^Name .*Size .*Checksum/ {hdr=1; next}
    hdr && /^[^ \t].*[ \t][0-9]+[ \t]/ {n++}
    END {print n+0}')
  out=$("$MAMEBIN" -rompath "$ROMDIR" -verifyroms "$d" 2>&1)
  missing=$(printf '%s\n' "$out" | grep -c "NOT FOUND" || true)
  if [ "$missing" = "0" ]; then
    printf '%-14s OK      %3s files required  %s\n' "$d" "$required" "$(printf '%s' "$out" | head -1)"
    return 0
  fi
  printf '%-14s MISSING %3s files required, %s missing\n' "$d" "$required" "$missing"
  printf '%s\n' "$out" | grep "NOT FOUND" | sed 's/^/                 /'
  return 1
}

case "${1:---list}" in
  --list)
    if [ -s "$GAMES" ]; then cat "$GAMES"; else
      for z in "$ROMDIR"/*.zip; do basename "$z" .zip; done
    fi
    ;;
  --check)
    shift
    [ $# -gt 0 ] || { echo "usage: romtools.sh --check <driver>..." >&2; exit 2; }
    rc=0
    for d in "$@"; do check_one "$d" || rc=1; done
    exit $rc
    ;;
  --wish)
    [ $# -ge 2 ] || { echo "usage: romtools.sh --wish <file with one game name per line>" >&2; exit 2; }
    file="$2"
    [ -r "$file" ] || { echo "cannot read $file" >&2; exit 2; }
    echo "GAME            DRIVER         SIZE      STATE"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in \#*) continue ;; esac
      name=$(printf '%s' "$line" | sed 's/^ *//; s/ *$//')
      if ! d=$(resolve "$name"); then printf '%-15s %-14s %-9s %s\n' "$name" "-" "-" "no such driver"; continue; fi
      # approximate: sum the sizes mame lists for this driver's required files
      # the size is the field immediately before the CRC/SHA1 column, one row per required file
      size=$("$MAMEBIN" -listroms "$d" 2>/dev/null | awk '
        /^Name .*Size .*Checksum/ {hdr=1; next}
        hdr {
          for (i=2; i<=NF; i++) if ($i ~ /^CRC\(/ || $i ~ /^NO$/ || $i ~ /^NO_GOOD/) { s += $(i-1); break }
        }
        END {printf "%.0f", s/1024}')
      ver=$("$MAMEBIN" -rompath "$ROMDIR" -verifyroms "$d" 2>&1)
      if printf '%s' "$ver" | grep -q "NOT FOUND"; then state="MISSING $(printf '%s' "$ver" | grep -c 'NOT FOUND') files"; else state="present"; fi
      printf '%-15s %-14s %-9s %s\n' "$name" "$d" "$( [ -n "$size" ] && echo "${size}K" || echo "?")" "$state"
    done < "$file"
    ;;
  --rebuild)
    [ -d "$ROMDIR" ] || { echo "no rom dir at $ROMDIR" >&2; exit 2; }
    tmp="$GAMES.new"
    : > "$tmp"
    ok=0; bad=0
    for z in "$ROMDIR"/*.zip; do
      d=$(basename "$z" .zip)
      out=$("$MAMEBIN" -rompath "$ROMDIR" -verifyroms "$d" 2>&1)
      if printf '%s' "$out" | grep -qi "not found\|unknown system\|no roms"; then
        bad=$((bad+1)); echo "  drop  $d  ($(printf '%s' "$out" | grep -i "not found\|unknown" | head -1 | cut -c1-60))"
      else
        printf '%s\n' "$d" >> "$tmp"; ok=$((ok+1))
      fi
    done
    sort -o "$tmp" "$tmp"
    mv "$tmp" "$GAMES"
    echo "verified $ok playable, $bad unusable -> $GAMES"
    ;;
  *)
    echo "usage: romtools.sh [--list|--check d...|--wish file|--rebuild]" >&2; exit 2 ;;
esac
