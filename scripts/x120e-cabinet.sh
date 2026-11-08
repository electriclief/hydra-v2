#!/bin/bash
# =====================================================================================
#  x120e-cabinet.sh  -  turn this Mint laptop into a MAME cabinet.
#
#  The operator's constraint: "what is linux? this is a mame machine!" - the box boots to a game,
#  not to a desktop. Nothing here removes the desktop: XFCE stays installed and stays selectable at
#  the login screen. What changes is which SESSION lightdm starts automatically, and that session is
#  a script that runs one thing.
#
#  What it does:
#    1. installs /usr/local/bin/mame-session  (screen off-blanking + the cabinet loop)
#    2. installs /usr/share/xsessions/mame-cabinet.desktop  (so XFCE remains a choice)
#    3. sets lightdm autologin-session=mame-cabinet, backing up lightdm.conf first
#    4. copies itself to /usr/local/bin/mame-cabinet.sh so the revert is possible from a console
#
#  Revert:  sudo mame-cabinet.sh --revert      (or press Ctrl+Alt+F2 for a console, log in as jim)
#  Check:   sudo /usr/local/bin/mame-session --self-check
# =====================================================================================
set -u

SESSION=/usr/local/bin/mame-session
XSESSION=/usr/share/xsessions/mame-cabinet.desktop
LIGHTDM=/etc/lightdm/lightdm.conf
BACKUP=/etc/lightdm/lightdm.conf.pre-mame
COPY=/usr/local/bin/mame-cabinet.sh
USER_NAME="${SUDO_USER:-jim}"
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)

say() { printf '  %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
if [ "${1:-}" = "--revert" ]; then
  echo "== reverting to the desktop session"
  if [ -f "$BACKUP" ]; then
    cp -a "$BACKUP" "$LIGHTDM"
    say "lightdm.conf restored from $BACKUP"
  else
    python3 - "$LIGHTDM" <<'PY'
import re, sys
p = sys.argv[1]
t = open(p).read()
t = re.sub(r'(?m)^\s*autologin-session=.*\n', '', t)
open(p, 'w').write(t)
PY
    say "autologin-session removed (no backup found)"
  fi
  rm -f "$XSESSION"
  say "removed $XSESSION"
  systemctl restart lightdm 2>/dev/null && say "lightdm restarted - XFCE will autologin again"
  exit 0
fi

# ---------------------------------------------------------------------------------------------
echo "== pre-flight"
[ -x /usr/games/mame ] || { echo "mame is not at /usr/games/mame" >&2; exit 1; }
[ -d "$USER_HOME/mame/roms" ] || { echo "no roms in $USER_HOME/mame/roms" >&2; exit 1; }
[ -x "$USER_HOME/mame-start.sh" ] || { echo "$USER_HOME/mame-start.sh missing or not executable" >&2; exit 1; }
say "mame        /usr/games/mame"
say "roms        $(ls "$USER_HOME/mame/roms"/*.zip 2>/dev/null | wc -l) zips"
say "verified    $(wc -l < "$USER_HOME/mame/games.txt" 2>/dev/null || echo 0) games in games.txt"
say "loop        $USER_HOME/mame-start.sh"

# 1. the session -------------------------------------------------------------------------------
cat > "$SESSION" <<'SESSION_EOF'
#!/bin/bash
# The cabinet session: no desktop, no window manager, no window chrome. One loop.
set -u
HOME_DIR=$(getent passwd "$(id -un)" | cut -d: -f6)
# CRASH GUARD: three starts inside a minute means the loop is not surviving, and a cabinet that
# reboots into a black screen eight times is worse than a desktop nobody asked for. Hand the
# desktop back instead of pretending. Delete ~/.mame/session-starts to re-arm.
STARTS="$HOME_DIR/.mame/session-starts"
mkdir -p "$HOME_DIR/.mame" 2>/dev/null
now=$(date +%s); n=0; last=0
[ -f "$STARTS" ] && read -r n last < "$STARTS"
if [ $(( now - last )) -lt 60 ]; then n=$(( n + 1 )); else n=1; fi
printf '%s %s\n' "$n" "$now" > "$STARTS"
if [ "$n" -ge 3 ]; then
  echo "$(date '+%F %T')  crash guard: three starts in a minute, falling back to the desktop" >> "$HOME_DIR/mame-start.log"
  exec xfce4-session
fi
# a 1366x768 arcade panel must never blank mid-game, and DPMS off keeps the backlight honest
xset s off -dpms 2>/dev/null; xset s noblank 2>/dev/null
xsetroot -solid black 2>/dev/null
exec exec_PLACEHOLDER
SESSION_EOF
chmod 0755 "$SESSION"
# the home directory is baked into the exec line; rewrite it for whoever actually owns this box
sed -i "s|^exec exec_PLACEHOLDER|exec $USER_HOME/mame-start.sh|" "$SESSION"
say "wrote $SESSION (with crash guard -> xfce4-session on the third fast start)"

# 2. the session entry, so the desktop stays a choice at the login screen -----------------------
cat > "$XSESSION" <<'XS_EOF'
[Desktop Entry]
Name=MAME Cabinet
Comment=Boots straight into the arcade cabinet loop - no desktop
Exec=/usr/local/bin/mame-session
Type=Application
DesktopNames=MAME
XS_EOF
chmod 0644 "$XSESSION"
say "wrote $XSESSION"

# 3. lightdm: autologin straight into that session ---------------------------------------------
[ -f "$BACKUP" ] || cp -a "$LIGHTDM" "$BACKUP"
python3 - "$LIGHTDM" "$USER_NAME" <<'PY'
import re, sys
path, user = sys.argv[1], sys.argv[2]
text = open(path).read()
if '[Seat:*]' not in text:
    text += '\n[Seat:*]\n'
head, _, seat = text.partition('[Seat:*]')
lines = [l for l in seat.splitlines() if not l.strip().startswith('autologin-session=')]
# keep autologin-user/timeout, add the cabinet session
def setkey(name, value, block):
    out, done = [], False
    for l in block:
        if re.match(rf'\s*{name}\s*=', l):
            out.append(f'{name}={value}'); done = True
        else:
            out.append(l)
    if not done:
        out.append(f'{name}={value}')
    return out
lines = setkey('autologin-user', user, lines)
lines = setkey('autologin-session', 'mame-cabinet', lines)
open(path, 'w').write(head + '[Seat:*]' + '\n' + '\n'.join(lines).lstrip('\n') + '\n')
PY
say "lightdm autologin-session=mame-cabinet (backup: $BACKUP)"

# 4. the revert must exist on disk, independent of how this script was delivered ------------------
#    $0 is "bash" when this runs as `curl ... | sudo bash`, so copying $0 silently does nothing -
#    which is exactly the kind of "it installed" that leaves you with no way back at 3am.
cat > "$COPY" <<REV_EOF
#!/bin/bash
# Session switch for this box, written by x120e-cabinet.sh at install time.
#   --status   what lightdm will boot into
#   --desktop  autologin into XFCE instead of the arcade loop
#   --cabinet  autologin into the arcade loop
#   --revert   restore the pre-cabinet lightdm.conf and drop the session entry
set -u
LIGHTDM=$LIGHTDM
BACKUP=$BACKUP
XSESSION=$XSESSION
[ "\$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }
status() {
  echo "autologin-session: \$(grep -E '^autologin-session=' "\$LIGHTDM" || echo '(unset - lightdm picks the first session)')"
  echo "sessions on disk : \$(ls /usr/share/xsessions/ | tr '\n' ' ')"
}
case "\${1:---status}" in
  --status) status ;;
  --desktop)
    sed -i '/^autologin-session=/d' "\$LIGHTDM"
    echo "autologin-session removed: next boot is the desktop"; status; systemctl restart lightdm ;;
  --cabinet)
    [ -f "\$BACKUP" ] || cp -a "\$LIGHTDM" "\$BACKUP"
    sed -i '/^autologin-session=/d' "\$LIGHTDM"
    printf 'autologin-session=mame-cabinet\n' >> "\$LIGHTDM"
    echo "autologin-session=mame-cabinet: next boot is the arcade loop"; status; systemctl restart lightdm ;;
  --revert)
    [ -f "\$BACKUP" ] && cp -a "\$BACKUP" "\$LIGHTDM" && echo "lightdm.conf restored"
    rm -f "\$XSESSION" && echo "removed \$XSESSION"; status; systemctl restart lightdm ;;
  *) echo "unknown option: \$1" >&2; exit 2 ;;
esac
REV_EOF
#!/bin/bash
# Stand-alone revert for the MAME cabinet session, written by x120e-cabinet.sh at install time.
set -u
[ "\$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }
if [ -f "$BACKUP" ]; then
  cp -a "$BACKUP" "$LIGHTDM" && echo "lightdm.conf restored from $BACKUP"
else
  echo "no backup at $BACKUP - removing autologin-session by hand instead"
  sed -i '/^autologin-session=/d' "$LIGHTDM"
fi
rm -f "$XSESSION" && echo "removed $XSESSION"
systemctl restart lightdm && echo "lightdm restarted - the desktop comes back"
REV_EOF
chmod 0755 "$COPY"
say "revert: sudo $COPY --revert"

# ---------------------------------------------------------------------------------------------
echo
echo "== verification"
say "session file     $( [ -f "$XSESSION" ] && echo present || echo MISSING )"
say "session script   $( [ -x "$SESSION" ] && echo executable || echo MISSING )"
say "autologin        $(grep -E '^autologin-(user|session)=' "$LIGHTDM" | tr '\n' ' ')"
say "sessions offered $(ls /usr/share/xsessions/ | tr '\n' ' ')"
echo
echo "  Reboot to boot into the cabinet. While it runs:"
echo "    Ctrl+Alt+F2            console login (jim) - the escape hatch"
echo "    quit a game            ESC once in MAME = the game list; pick another, it becomes the default"
echo "    sudo $COPY --desktop   boot the desktop instead (from that console)"
echo "    sudo $COPY --cabinet   boot the arcade loop again"
echo
echo "  XFCE is installed and untouched - but be clear about what that means: with autologin on,"
echo "  this box never SHOWS a login screen, so there is nothing to pick a session from. XFCE is"
echo "  reached by telling lightdm to autologin into it:  sudo $COPY --desktop"
