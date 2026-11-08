#!/bin/bash
# =====================================================================================
#  mame-cabinet-install.sh - build another cabinet from scratch.
#
#  One command on a fresh Mint/Ubuntu/Debian laptop:
#      curl -fsSL http://192.168.1.123:8140/mame-cabinet-install.sh | sudo bash
#
#  What it does, in order: installs mame, creates the rom folder and a Desktop shortcut to it,
#  installs the cabinet loop and the rom tools, verifies every zip it finds and keeps only the
#  games that really start, then points lightdm at the cabinet session.
#
#  Options:
#      --user NAME      the person who will be logged in at the cabinet (default: SUDO_USER)
#      --dry-run        print every action, change nothing
#      --bench [N]      also benchmark N games (default 3) with mame -bench 60, writes bench.txt
#      --no-session     skip the boot change (leave the desktop alone)
#      --roms DIR       use an existing rom directory (symlinked from ~/mame/roms)
#
#  Nothing is downloaded that is not a script or a package: this installs the PLAYER, never the
#  games. ROMs are yours to supply; romtools.sh tells you exactly what a set is missing.
# =====================================================================================
set -u

BASE="${MAME_BASE:-http://192.168.1.123:8140}"
DRY=0
DO_SESSION=1
BENCH=0
BENCH_N=3
USER_NAME="${SUDO_USER:-$(id -un)}"
ROMS_GIVEN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --bench) BENCH=1; shift; case "${1:-}" in ''|--*) ;; *) BENCH_N="$1"; shift ;; esac ;;
    --no-session) DO_SESSION=0; shift ;;
    --roms) ROMS_GIVEN="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '  would: %s\n' "$*"; else "$@"; fi; }

[ "$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)
[ -n "$USER_HOME" ] && [ -d "$USER_HOME" ] || { echo "no home directory for user $USER_NAME" >&2; exit 1; }
ROMDIR="$USER_HOME/mame/roms"

echo "MAME cabinet install"
say "user      $USER_NAME  ($USER_HOME)"
say "source    $BASE"
say "mode      $( [ "$DRY" = 1 ] && echo 'dry run - nothing will change' || echo 'install')"

step "1. player"
if [ -x /usr/games/mame ]; then
  say "mame already installed: $(/usr/games/mame -version 2>/dev/null | head -1)"
else
  say "installing mame (large package - the binary alone is ~400 MB)"
  if ! run apt-get install -y mame; then
    echo "  apt-get failed. If this is a fresh image, run 'apt-get update' first, then this again." >&2
    exit 1
  fi
fi
run apt-get install -y x11-utils >/dev/null 2>&1 || say "x11-utils missing - xwininfo/xwd checks will be unavailable"

step "2. roms"
run mkdir -p "$ROMDIR"
if [ -n "$ROMS_GIVEN" ]; then
  [ -d "$ROMS_GIVEN" ] || { echo "no such rom directory: $ROMS_GIVEN" >&2; exit 1; }
  run ln -sfn "$ROMS_GIVEN" "$ROMDIR"
  say "roms: $ROMDIR -> $ROMS_GIVEN"
fi
if [ -d "$USER_HOME/Desktop" ]; then
  run ln -sfn "$ROMDIR" "$USER_HOME/Desktop/ROMs"
  say "desktop shortcut: $USER_HOME/Desktop/ROMs -> $ROMDIR"
fi
count=0
[ -d "$ROMDIR" ] && count=$(ls "$ROMDIR"/*.zip 2>/dev/null | wc -l)
say "rom zips present: $count"

step "3. the loop and the tools"
for f in mame-start.sh romtools.sh; do
  src="$BASE/$f"
  if [ "$DRY" = 1 ]; then
    say "would fetch $src -> $USER_HOME/$f"
  else
    if curl -fsSL "$src" -o "$USER_HOME/$f"; then
      chmod 0755 "$USER_HOME/$f"
      sed -i 's/\r$//' "$USER_HOME/$f"
      say "$f installed ($(wc -l < "$USER_HOME/$f") lines)"
    else
      echo "  could not fetch $src - is the controller page server on 8140 up?" >&2
      exit 1
    fi
  fi
done

step "4. verify the roms"
if [ "$count" -gt 0 ]; then
  if [ "$DRY" = 1 ]; then
    say "would run romtools.sh --rebuild over $count zips (one -verifyroms each)"
  else
    ( cd "$USER_HOME" && ./romtools.sh --rebuild ) | tail -6
    say "verified games: $(wc -l < "$USER_HOME/mame/games.txt" 2>/dev/null || echo 0)"
  fi
else
  say "no roms yet - drop zips into $ROMDIR, then run: ~/romtools.sh --rebuild"
fi

step "5. boot into the cabinet"
if [ "$DO_SESSION" = 0 ]; then
  say "skipped (--no-session): the desktop will still boot"
else
  if [ "$DRY" = 1 ]; then
    say "would install /usr/local/bin/mame-session, /usr/share/xsessions/mame-cabinet.desktop"
    say "would set lightdm autologin-session=mame-cabinet (backup: lightdm.conf.pre-mame)"
  else
    cat > /usr/local/bin/mame-session <<SESS
#!/bin/bash
# Cabinet session: no desktop, no window manager, one loop. Crash guard gives the desktop back.
set -u
HOME_DIR="$USER_HOME"
STARTS="\$HOME_DIR/.mame/session-starts"
mkdir -p "\$HOME_DIR/.mame" 2>/dev/null
now=\$(date +%s); n=0; last=0
[ -f "\$STARTS" ] && read -r n last < "\$STARTS"
if [ \$(( now - last )) -lt 60 ]; then n=\$(( n + 1 )); else n=1; fi
printf '%s %s\n' "\$n" "\$now" > "\$STARTS"
if [ "\$n" -ge 3 ]; then
  echo "\$(date '+%F %T')  crash guard: three starts in a minute, falling back to the desktop" >> "\$HOME_DIR/mame-start.log"
  exec xfce4-session
fi
xset s off -dpms 2>/dev/null; xset s noblank 2>/dev/null
xsetroot -solid black 2>/dev/null
exec "\$HOME_DIR/mame-start.sh"
SESS
    chmod 0755 /usr/local/bin/mame-session

    cat > /usr/share/xsessions/mame-cabinet.desktop <<'XS'
[Desktop Entry]
Name=MAME Cabinet
Comment=Boots straight into the arcade cabinet loop - no desktop
Exec=/usr/local/bin/mame-session
Type=Application
DesktopNames=MAME
XS
    chmod 0644 /usr/share/xsessions/mame-cabinet.desktop

    if [ -f /etc/lightdm/lightdm.conf ]; then
      [ -f /etc/lightdm/lightdm.conf.pre-mame ] || cp -a /etc/lightdm/lightdm.conf /etc/lightdm/lightdm.conf.pre-mame
      sed -i '/^autologin-session=/d' /etc/lightdm/lightdm.conf
      printf 'autologin-session=mame-cabinet\n' >> /etc/lightdm/lightdm.conf
      say "lightdm: autologin-user=$(grep -E '^autologin-user=' /etc/lightdm/lightdm.conf | cut -d= -f2) autologin-session=mame-cabinet"
    else
      say "no /etc/lightdm/lightdm.conf - this distro does not use lightdm; the session entry is installed but"
      say "you must point your display manager at 'mame-cabinet' yourself"
    fi

    cat > /usr/local/bin/mame-cabinet.sh <<SW
#!/bin/bash
# --status | --desktop | --cabinet | --revert   (written by mame-cabinet-install.sh)
set -u
LIGHTDM=/etc/lightdm/lightdm.conf
BACKUP=/etc/lightdm/lightdm.conf.pre-mame
XSESSION=/usr/share/xsessions/mame-cabinet.desktop
[ "\$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }
st() {
  echo "session: \$(grep -E '^autologin-session=' "\$LIGHTDM" 2>/dev/null || echo '(unset)')"
  echo "offered: \$(ls /usr/share/xsessions/ 2>/dev/null | tr '\n' ' ')"
}
case "\${1:---status}" in
  --status) st ;;
  --desktop) sed -i '/^autologin-session=/d' "\$LIGHTDM"; st; systemctl restart lightdm ;;
  --cabinet) sed -i '/^autologin-session=/d' "\$LIGHTDM"; printf 'autologin-session=mame-cabinet\n' >> "\$LIGHTDM"; st; systemctl restart lightdm ;;
  --revert) [ -f "\$BACKUP" ] && cp -a "\$BACKUP" "\$LIGHTDM"; rm -f "\$XSESSION"; st; systemctl restart lightdm ;;
  *) echo "use --status|--desktop|--cabinet|--revert" >&2; exit 2 ;;
esac
SW
    chmod 0755 /usr/local/bin/mame-cabinet.sh
    say "session installed; switch with: sudo mame-cabinet.sh --desktop | --cabinet"
  fi
fi

step "6. bench"
if [ "$BENCH" = 1 ] && [ "$DRY" = 0 ] && [ -s "$USER_HOME/mame/games.txt" ]; then
  n=0
  : > "$USER_HOME/bench.txt"
  while IFS= read -r d && [ "$n" -lt "$BENCH_N" ]; do
    pct=$(timeout 90 /usr/games/mame -rompath "$ROMDIR" -bench 60 "$d" 2>/dev/null | grep -oE "Average speed: [0-9]+" | grep -oE "[0-9]+")
    printf '%-14s %s%%\n' "$d" "${pct:-no reading}" >> "$USER_HOME/bench.txt"
    n=$((n+1))
  done < "$USER_HOME/mame/games.txt"
  chown "$USER_NAME" "$USER_HOME/bench.txt" 2>/dev/null
  say "benched $n games -> $USER_HOME/bench.txt"
  cat "$USER_HOME/bench.txt" | sed 's/^/    /'
fi

step "done"
say "games ready     $(wc -l < "$USER_HOME/mame/games.txt" 2>/dev/null || echo 0)"
say "rom folder      $ROMDIR"
say "reboot          boot into the last game; ESC opens the game list"
say "escape hatch    Ctrl+Alt+F2, then: sudo mame-cabinet.sh --desktop"
echo
echo "  ROMs are not downloaded by this script. Drop zips in $ROMDIR and run:"
echo "     ~/romtools.sh --rebuild      verify and add them"
echo "     ~/romtools.sh --check <driver>   what a set is still missing"
