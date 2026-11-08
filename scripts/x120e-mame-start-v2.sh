#!/bin/bash
# =====================================================================================
#  mame-start.sh  -  the cabinet loop. Boots to a GAME, never to a desktop or a menu.
#
#  The rule: "boots to the same game unless re-selected". Re-selecting is done the way a cabinet
#  player already knows how: quit the game, and the machine shows the game list. Pick one and it
#  becomes the new default. No 3-second timer, no key sniffing, no toolkit, no window manager.
#
#      boot                  -> last_game (dkong on a fresh box)
#      quit the game (ESC)   -> MAME's own list, keyboard-driven, over the same fullscreen window
#      pick a game           -> it plays, and it is written to last_game
#      quit the list (ESC)   -> the last game plays again; the screen is never left black
#
#  The choice is read back from MAME's own cfg directory: the newest .cfg is the game that really
#  ran. There is no second opinion about what was played.
#
#  Usage:  mame-start.sh                cabinet boot (infinite loop)
#          mame-start.sh --list         the games this box can actually start
#          mame-start.sh <driver>       play one game, then show the list
#  Env:    MAME_EXTRA="-seconds_to_run 5"   extra mame flags (testing)
#          MAME_ONCE=1                      leave after one round (testing)
# =====================================================================================
set -u

HOME_DIR="$(cd "$(dirname "$0")" && pwd)"
ROMDIR="$HOME_DIR/mame/roms"
GAMES="$HOME_DIR/mame/games.txt"
MAMEBIN=/usr/games/mame
LAST="$HOME_DIR/last_game"
CFGDIR="$HOME_DIR/.mame/cfg"
LOG="$HOME_DIR/mame-start.log"
DEFAULT_GAME=dkong

# 1366x768 panel against a 224-256 line arcade signal: integer scaling, aspect kept, so the pixels
# stay square and 4:3 is not smeared across 16:9 (that is what reads as "emulator", not "cabinet")
COMMON="-rompath $ROMDIR -nowindow -skip_gameinfo -keepaspect -unevenstretchx -prescale 2 -resolution 1366x768"
EXTRA="${MAME_EXTRA:-}"

[ -x "$MAMEBIN" ] || { echo "no mame at $MAMEBIN" >&2; exit 1; }
[ -d "$ROMDIR" ] || { echo "no roms at $ROMDIR" >&2; exit 1; }

log() { echo "$(date '+%F %T')  $*" >> "$LOG"; }

list_games() {
  # games.txt is the VERIFIED list (every driver checked with -verifyroms once, so a game in there
  # really starts). A set can be present and still be unplayable: centiped is missing one ROM,
  # arknoid2 a file nobody has ever dumped. Without the verified list, fall back to the zips and
  # say so, rather than pretending the list is trustworthy.
  if [ -s "$GAMES" ]; then
    cat "$GAMES"
    return
  fi
  echo "# UNVERIFIED: no $GAMES, this is every zip in the rom directory" >&2
  for z in "$ROMDIR"/*.zip; do
    d=$(basename "$z" .zip)
    case "$d" in *junk|zigzag) continue ;; esac
    printf '%s\n' "$d"
  done
}

case "${1:-}" in
  --list) list_games; exit 0 ;;
esac

if [ $# -ge 1 ]; then
  DEFAULT_GAME="$1"
fi

# an explicit choice is written before it plays, so a power cut mid-game still boots it
last_game=$(head -1 "$LAST" 2>/dev/null | tr -d '\r\n')
if [ $# -ge 1 ]; then
  last_game="$1"
  printf '%s\n' "$last_game" > "$LAST"
elif [ -z "$last_game" ]; then
  last_game="$DEFAULT_GAME"
fi

mkdir -p "$CFGDIR" 2>/dev/null

while :; do
  log "playing $last_game"
  # shellcheck disable=SC2086
  "$MAMEBIN" $COMMON $EXTRA "$last_game"

  # the game has ended: show the list over the same screen, keyboard-driven
  log "list"
  # shellcheck disable=SC2086
  "$MAMEBIN" $COMMON $EXTRA

  newest=$(ls -t "$CFGDIR"/*.cfg 2>/dev/null | head -1)
  if [ -n "$newest" ]; then
    picked=$(basename "$newest" .cfg)
    if [ -n "$picked" ] && [ "$picked" != "$last_game" ]; then
      last_game="$picked"
      printf '%s\n' "$last_game" > "$LAST"
      log "chose $last_game"
    fi
  fi

  # a test run should not be an infinite loop
  [ "${MAME_ONCE:-0}" = "1" ] && exit 0

  # if the player quits the list as well, play the last game again rather than sit on a black screen
  last_game=$(head -1 "$LAST" 2>/dev/null | tr -d '\r\n')
  [ -n "$last_game" ] || last_game="$DEFAULT_GAME"
done
