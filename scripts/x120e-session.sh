#!/bin/bash
# =====================================================================================
#  x120e-session.sh - choose what this box boots into, truthfully.
#
#  Why this exists: with autologin enabled there IS no login screen, so the installer's claim
#  that "XFCE is still selectable at the login screen" was wrong - the machine never shows a
#  greeter to select anything at. XFCE is installed; the only way to it is to tell lightdm to
#  autologin into it. That is what this does, without deleting anything.
#
#  Usage (from the operator's console, or over ssh with sudo):
#      curl -fsSL http://192.168.1.123:8140/x120e-session.sh | sudo bash -s -- --status
#      curl -fsSL http://192.168.1.123:8140/x120e-session.sh | sudo bash -s -- --desktop
#      curl -fsSL http://192.168.1.123:8140/x120e-session.sh | sudo bash -s -- --cabinet
#      curl -fsSL http://192.168.1.123:8140/x120e-session.sh | sudo bash -s -- --revert
# =====================================================================================
set -u
LIGHTDM=/etc/lightdm/lightdm.conf
BACKUP=/etc/lightdm/lightdm.conf.pre-mame
XSESSION=/usr/share/xsessions/mame-cabinet.desktop

say() { printf '  %s\n' "$*"; }

status() {
  echo "== what this box is set to boot into"
  say "autologin        $(grep -E '^autologin-user=' "$LIGHTDM" || echo '(none)')"
  say "autologin-session $(grep -E '^autologin-session=' "$LIGHTDM" || echo '(unset -> lightdm picks the only/first session)')"
  say "sessions on disk $(ls /usr/share/xsessions/ | tr '\n' ' ')"
  say "cabinet loop     $( [ -x /home/jim/mame-start.sh ] && echo 'present' || echo MISSING )"
  say "cabinet ever ran $( [ -f /home/jim/.mame/session-starts ] && echo 'yes - session-starts exists' || echo 'not yet - the desktop still owns the screen' )"
  say "display manager  $(systemctl is-active display-manager)"
}

[ "$(id -u)" = 0 ] || { echo "run this with sudo" >&2; exit 1; }

case "${1:---status}" in
  --status)
    status
    ;;
  --desktop)
    [ -f "$BACKUP" ] || cp -a "$LIGHTDM" "$BACKUP"
    sed -i '/^autologin-session=/d' "$LIGHTDM"
    echo "autologin-session removed: lightdm will boot the desktop (xfce) again"
    status
    systemctl restart lightdm
    ;;
  --cabinet)
    sed -i '/^autologin-session=/d' "$LIGHTDM"
    printf 'autologin-session=mame-cabinet\n' >> "$LIGHTDM"
    echo "autologin-session=mame-cabinet: lightdm will boot straight into the arcade loop"
    status
    systemctl restart lightdm
    ;;
  --revert)
    if [ -f "$BACKUP" ]; then cp -a "$BACKUP" "$LIGHTDM" && echo "lightdm.conf restored from $BACKUP"; fi
    rm -f "$XSESSION" && echo "removed $XSESSION (the cabinet session is no longer offered)"
    status
    systemctl restart lightdm
    ;;
  *)
    echo "unknown option: $1 (use --status, --desktop, --cabinet, --revert)" >&2
    exit 2
    ;;
esac
