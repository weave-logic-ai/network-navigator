#!/usr/bin/env bash
# ruOS desktop bootstrap for Network Navigator.
#
# WHY THIS EXISTS
# ---------------
# The ruOS desktop's root filesystem is ephemeral. Verified 2026-09-19: after
# desktop_stop + desktop_start, /opt, /etc and every apt-installed package are
# gone and the root layer has reset to the base image. Only /home/ruv (a
# separate 20 G volume) survives. The box has no systemd and no cron, so
# nothing restarts a service on its own. A weekday 23:00 America/Toronto
# auto-stop means this happens daily, not rarely.
#
# So: everything this stack needs lives under /home/ruv, and this script
# re-establishes the runtime after every boot. It is idempotent — running it
# when everything is already up is a cheap no-op — which makes it safe to
# attach to a ruOS schedule as a heartbeat as well as a boot step.
#
# USAGE
#   bash /home/ruv/bootstrap.sh            # full bootstrap
#   bash /home/ruv/bootstrap.sh --no-stack # runtime only, skip docker compose
#
# Exits non-zero on failure so a ruOS schedule surfaces the problem.

set -euo pipefail

DOCKER_VERSION="${DOCKER_VERSION:-29.8.1}"
HOME_DIR="${HOME_DIR:-/home/ruv}"
DOCKER_DIR="$HOME_DIR/opt/docker"
DOCKER_SOCK="$HOME_DIR/docker.sock"
DOCKER_DATA="$HOME_DIR/docker"
DOCKER_EXEC_ROOT="$HOME_DIR/docker-exec"
CLI_PLUGINS="$HOME_DIR/.docker/cli-plugins"
REPO_DIR="${REPO_DIR:-$HOME_DIR/dev/network-navigator}"
LOG_DIR="$HOME_DIR/logs"
HEALTH_URL="${HEALTH_URL:-http://localhost:3750/api/health}"
RUN_USER="$(id -un)"

SKIP_STACK=0
[ "${1:-}" = "--no-stack" ] && SKIP_STACK=1

mkdir -p "$LOG_DIR" "$HOME_DIR/opt" "$CLI_PLUGINS"
LOG="$LOG_DIR/bootstrap-$(date -u +%Y%m%d).log"

log()  { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }

export DOCKER_HOST="unix://$DOCKER_SOCK"
export DOCKER_CONFIG="$HOME_DIR/.docker"
export PATH="$DOCKER_DIR:$PATH"

log "=== bootstrap start (user=$RUN_USER) ==="

# ---------------------------------------------------------------- 1. binaries
if [ -x "$DOCKER_DIR/dockerd" ]; then
  log "docker binaries present ($("$DOCKER_DIR/docker" --version 2>/dev/null || echo unknown))"
else
  log "docker binaries missing, fetching static $DOCKER_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL --max-time 300 -o "$tmp/d.tgz" \
    "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
    || fail "could not download docker $DOCKER_VERSION"
  tar xzf "$tmp/d.tgz" -C "$HOME_DIR/opt" || fail "could not extract docker tarball"
  rm -rf "$tmp"
  log "docker binaries installed to $DOCKER_DIR"
fi

# The static tarball does NOT include the compose plugin — it ships only
# dockerd/docker/containerd/runc. Compose is fetched separately as a CLI plugin.
if [ -x "$CLI_PLUGINS/docker-compose" ]; then
  log "compose plugin present ($("$CLI_PLUGINS/docker-compose" version --short 2>/dev/null || echo unknown))"
else
  log "compose plugin missing, fetching latest"
  curl -fsSL --max-time 300 -o "$CLI_PLUGINS/docker-compose" \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
    || fail "could not download the compose plugin"
  chmod +x "$CLI_PLUGINS/docker-compose"
  log "compose plugin installed"
fi

# ----------------------------------------------------------------- 2. daemon
if pgrep -f "dockerd .*--data-root=$DOCKER_DATA" >/dev/null 2>&1; then
  log "dockerd already running"
else
  log "starting dockerd (data-root=$DOCKER_DATA)"
  mkdir -p "$DOCKER_DATA"
  # sudo resets PATH (secure_path), so dockerd cannot find its sibling helper
  # binaries — containerd, runc, docker-proxy — which all ship in the same
  # static tarball. Without them it exits immediately with
  # "invalid userland-proxy-path: userland-proxy is enabled, but
  # userland-proxy-path is not set" and never opens the socket. Set PATH for
  # the daemon and name the proxy explicitly, so neither depends on the
  # caller's environment.
  sudo sh -c "PATH='$DOCKER_DIR':\$PATH nohup '$DOCKER_DIR/dockerd' \
      --data-root='$DOCKER_DATA' \
      --exec-root='$DOCKER_EXEC_ROOT' \
      --pidfile='$HOME_DIR/docker.pid' \
      --host='unix://$DOCKER_SOCK' \
      --userland-proxy-path='$DOCKER_DIR/docker-proxy' \
      >> '$LOG_DIR/dockerd.log' 2>&1 &"

  for _ in $(seq 1 45); do
    [ -S "$DOCKER_SOCK" ] && break
    sleep 1
  done
  if [ ! -S "$DOCKER_SOCK" ]; then
    # Make the failure self-explaining rather than pointing at a log file.
    log "--- last 15 lines of dockerd.log ---"
    tail -15 "$LOG_DIR/dockerd.log" 2>/dev/null | tee -a "$LOG" || true
    fail "dockerd did not create $DOCKER_SOCK"
  fi
  log "dockerd up"
fi

# Own the socket so the docker CLI works without sudo for the rest of the run
# (and for interactive use afterwards).
if [ ! -w "$DOCKER_SOCK" ]; then
  sudo chown "$RUN_USER" "$DOCKER_SOCK" || fail "could not take ownership of $DOCKER_SOCK"
  log "socket ownership set to $RUN_USER"
fi

docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
  || fail "docker CLI cannot reach the daemon at $DOCKER_HOST"
log "daemon reachable, server $(docker version --format '{{.Server.Version}}')"

if [ "$SKIP_STACK" = "1" ]; then
  log "=== --no-stack: runtime ready, stopping here ==="
  exit 0
fi

# ------------------------------------------------------------------ 3. stack
[ -d "$REPO_DIR" ] || fail "repo not found at $REPO_DIR — clone it before running the stack step"
[ -f "$REPO_DIR/.env" ] || fail "$REPO_DIR/.env missing — assemble it from the ruOS secrets vault"

cd "$REPO_DIR"
log "bringing the stack up"
docker compose up -d 2>&1 | tee -a "$LOG" || fail "docker compose up failed"

# ----------------------------------------------------------------- 4. health
log "waiting on $HEALTH_URL"
for _ in $(seq 1 60); do
  if body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
    log "healthy: $body"
    log "=== bootstrap complete ==="
    exit 0
  fi
  sleep 5
done

log "containers:"; docker compose ps 2>&1 | tee -a "$LOG" || true
fail "app did not become healthy within 5 minutes"
