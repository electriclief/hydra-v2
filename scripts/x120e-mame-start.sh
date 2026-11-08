#!/bin/bash
# =====================================================================================
#  mame-start.sh - the machine boots to a GAME, not to a desktop.
#
#  Behaviour, in the operator's words: "boots to the same game unless re-selected".
#
#    1. any key in the first 3 seconds  -> MAME's own built-in game list, they pick
#    2. nothing pressed                 -> the last game, immediately
#    3. first boot ever                 -> the shipped default (dkong)
#
#  Why MAME's own frontend instead of a custom menu: it needs no toolkit, no window manager and
#  no cursor - exactly the constraint this box lives under. The choice is read back afterwards
#  from MAME's own cfg directory (the newest file is the game that actually ran), so there is no
#  second source of truth about "which game did they play".
#
#  Usage:  mame-start.sh            normal cabinet boot
#          mame-start.sh <driver>   force one game (remote control, testing)
#          mame-start.sh --list     print what this box can actually run
# =====================================================================================
set -u

HOME_DIR="$(cd "$(dirname "$0")" && pwd)"
ROMDIR="$HOME_DIR/mame/roms"
MAMEBIN=/usr/games/mame
LAST="$HOME_DIR/last_game"
CFGDIR="$HOME_DIR/.mame/cfg"
LOG="$HOME_DIR/mame-start.log"
DEFAULT_GAME=dkong
CHOICE_SECONDS=3

[ -x "$MAMEBIN" ] || { echo "no mame at $MAMEBIN" >&2; exit 1; }
[ -d "$ROMDIR" ] || { echo "no roms at $ROMDIR" >&2; exit 1; }

# 1366x768 panel, 224-320 line arcade signal: integer scaling keeps pixels square and the picture
# sharp; -keepaspect stops 4:3 being smeared across 16:9, which is what reads as "emulator, not cabinet".
COMMON="-rompath $ROMDIR -nowindow -skip_gameinfo -keepaspect -unevenstretchx -prescale 2 -resolution 1366x768"

list_games() {
  # mame/games.txt is the VERIFIED list: each driver checked with -verifyroms once, so a game in there
  # really starts. The zip sweep below is the fallback and is honestly unverified - a set can be present
  # and still be unplayable (centiped is missing one ROM, arknoid2 a file nobody has ever dumped).
  if [ -s "$HOME_DIR/mame/games.txt" ]; then
    cat "$HOME_DIR/mame/games.txt"
    return
  fi
  for z in "$ROMDIR"/*.zip; do
    d=$(basename "$z" .zip)
    case "$d" in
      *junk|zigzag) continue ;;
    esac
    printf '%s\n' "$d"
  done
}

case "${1:-}" in
  --list) list_games; exit 0 ;;
esac

# ---- 3. a forced game wins, no questions asked -------------------------------------------------
if [ $# -ge 1 ]; then
  game="$1"
  echo "$game" > "$LAST"
  echo "$(date '+%F %T')  forced $game" >> "$LOG"
  exec "$MAMEBIN" $COMMON "$game"
fi

# ---- 1/2. the choice window --------------------------------------------------------------------
last_game=""
[ -r "$LAST" ] && last_game=$(head -1 "$LAST" | tr -d '\r\n')
[ -n "$last_game" ] || last_game="$DEFAULT_GAME"

mkdir -p "$CFGDIR" 2>/dev/null

# -t needs a terminal; under a graphical autologin session there is none, so fall back to the
# keypress path only when stdin is a tty, otherwise honour the timeout (no stray reads on a pipe)
if [ -t 0 ]; then
  printf 'press any key within %ss to choose a game...\n' "$CHOICE_SECONDS"
  if read -r -t "$CHOICE_SECONDS" -n 1 _key 2>/dev/null; then
    echo "$(date '+%F %T')  chooser opened" >> "$LOG"
    "$MAMEBIN" $COMMON            # built-in frontend: they pick, ESC/TAB to leave
    # whatever they ran last wrote a cfg: that is the answer, and it needs no cooperation from MAME
    newest=$(ls -t "$CFGDIR"/*.cfg 2>/dev/null | head -1)
    if [ -n "$newest" ]; then
      picked=$(basename "$newest" .cfg)
      if [ -n "$picked" ] && [ "$picked" != "$last_game" ]; then
        echo "$picked" > "$LAST"
        echo "$(date '+%F %T')  chose $picked" >> "$LOG"
      fi
    fi
    exit 0
  fi
fi

echo "$(date '+%F %T')  last game $last_game" >> "$LOG"
exec "$MAMEBIN" $COMMON "$last_game"
