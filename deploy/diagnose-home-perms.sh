#!/usr/bin/env bash
# Diagnose what's creating root-owned files under /home/servicehub.
#
# Run this on the VPS. Read-only — touches no files, changes no state.
# Paste the output back into the chat so the fix can be planned.
#
# Usage:
#   sudo bash /opt/servicehub/deploy/diagnose-home-perms.sh
#
# What it checks (all read-only):
#   1. Current offenders + their mtimes (correlate with deploy log timestamps)
#   2. Sudoers entries that allow npm/pm2/node to run as root
#   3. Crons + systemd timers that could fire as root
#   4. Root's bash history for past `sudo npm` / `sudo pm2`
#   5. Recent root logins (last 50)
#   6. Recent /var/log/servicehub-deploy/ self-heal entries
#      (so we can see how often the symptom is actually firing)

set -u

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)"
  exit 1
fi

APP_USER=servicehub
HOME_DIR="/home/$APP_USER"

bar() { printf '\n=== %s ===\n' "$1"; }

bar "1. Current non-$APP_USER-owned paths under $HOME_DIR"
if [[ -d "$HOME_DIR" ]]; then
  COUNT="$(find "$HOME_DIR" -not -user "$APP_USER" 2>/dev/null | wc -l | tr -d ' ')"
  echo "Total: $COUNT"
  if [[ "$COUNT" -gt 0 ]]; then
    echo "(showing up to 30, sorted by mtime ascending — oldest at top, newest at bottom)"
    find "$HOME_DIR" -not -user "$APP_USER" \
      -printf '%u %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null \
      | sort -k2,3 | head -n 30
  else
    echo "(none — self-heal has been catching them, OR the source is dormant right now)"
  fi
else
  echo "WARN: $HOME_DIR does not exist"
fi

bar "2. Sudoers entries that mention npm / pm2 / node / shell scripts"
ls -la /etc/sudoers.d/ 2>/dev/null
echo ---
grep -rE "(^|[ \t/])(npm|pm2|node|bash|sh)([ \t]|$)" /etc/sudoers /etc/sudoers.d/ 2>/dev/null \
  | grep -v "^Binary" || echo "(no matches — only the documented servicehub-deploy entry)"

bar "3a. Root crontab"
crontab -l 2>/dev/null || echo "(no root crontab)"

bar "3b. /etc/cron.* directories"
for d in /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
  if [[ -d "$d" ]]; then
    echo "--- $d ---"
    ls -la "$d" 2>/dev/null | tail -n +2
  fi
done

bar "3c. Cron files mentioning servicehub / npm / pm2 / node"
grep -rlE "servicehub|npm|pm2|/usr/bin/node" /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly 2>/dev/null \
  | while read -r f; do echo "--- $f ---"; cat "$f"; done

bar "3d. systemd timers"
systemctl list-timers --all --no-pager 2>/dev/null | head -n 30

bar "3e. systemd units that mention servicehub / npm / pm2"
systemctl list-unit-files --no-pager 2>/dev/null | grep -E "servicehub|pm2" || echo "(none)"

bar "4a. Root bash history — npm / pm2 invocations"
if [[ -f /root/.bash_history ]]; then
  grep -nE "(^|\s)(sudo\s+)?(npm|pm2|node)(\s|$)" /root/.bash_history 2>/dev/null | tail -n 40 \
    || echo "(no matches in /root/.bash_history)"
else
  echo "(/root/.bash_history does not exist)"
fi

bar "4b. Other histories under /root"
ls -la /root/.*history 2>/dev/null

bar "5. Recent root logins (last 50)"
last -n 50 root 2>/dev/null || true

bar "6. Recent self-heal activity in deploy logs"
if [[ -d /var/log/servicehub-deploy ]]; then
  echo "Total deploys with offenders detected vs 'OK — all paths already owned':"
  OFFENDED="$(grep -lE "found [0-9]+ non-servicehub-owned path" /var/log/servicehub-deploy/*.log 2>/dev/null | wc -l | tr -d ' ')"
  CLEAN="$(grep -lE "OK — all paths already owned by servicehub" /var/log/servicehub-deploy/*.log 2>/dev/null | wc -l | tr -d ' ')"
  echo "  with offenders : $OFFENDED"
  echo "  clean          : $CLEAN"
  echo
  echo "Last 5 deploys that FOUND offenders (filename = github delivery id):"
  grep -lE "found [0-9]+ non-servicehub-owned path" /var/log/servicehub-deploy/*.log 2>/dev/null \
    | xargs -r ls -t 2>/dev/null | head -n 5 \
    | while read -r f; do
        echo "--- $f ---"
        grep -A 6 "found [0-9]+ non-servicehub-owned" "$f" | head -n 8
      done
else
  echo "(/var/log/servicehub-deploy does not exist — listener never ran?)"
fi

bar "Diagnostic complete"
echo "Paste the entire output above back into the chat."
