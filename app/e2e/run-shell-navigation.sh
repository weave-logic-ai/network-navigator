#!/usr/bin/env bash
# From app/: bash e2e/run-shell-navigation.sh
# Runs the synthetic dialog fixture and both deployment-flag modes in Chrome.
# Set E2E_BROWSER_CHANNEL to another installed Playwright channel if needed.

set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
next_bin="$app_root/node_modules/.bin/next"
playwright_bin="$app_root/node_modules/.bin/playwright"
fixture_dir="$app_root/e2e/fixtures/shell-dialogs"
log_dir="$app_root/../data/drives/ux-shell-e2e"
fixture_port="${E2E_SHELL_FIXTURE_PORT:-3754}"
app_port="${E2E_SHELL_APP_PORT:-3752}"
browser_channel="${E2E_BROWSER_CHANNEL:-chrome}"
server_pid=""

mkdir -p "$log_dir"

stop_server() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
}
trap stop_server EXIT INT TERM

start_server() {
  local label="$1" port="$2" project_dir="$3" path="$4"
  shift 4
  local url="http://127.0.0.1:$port$path"
  local log_file="$log_dir/$label.log"

  if curl -sS -o /dev/null --max-time 1 "$url" 2>/dev/null; then
    echo "Port $port is already serving HTTP; choose another E2E_SHELL_*_PORT." >&2
    exit 1
  fi

  env "$@" "$next_bin" dev "$project_dir" -H 127.0.0.1 -p "$port" >"$log_file" 2>&1 &
  server_pid=$!
  for ((attempt = 0; attempt < 60; attempt++)); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      echo "$label server exited; see $log_file" >&2
      tail -40 "$log_file" >&2
      exit 1
    fi
    sleep 1
  done
  echo "$label server did not become ready; see $log_file" >&2
  tail -40 "$log_file" >&2
  exit 1
}

cd "$app_root"

echo "Synthetic dialog fixture (targets=0 and targets=1)"
start_server fixture "$fixture_port" "$fixture_dir" "/?targets=0"
E2E_SHELL_FIXTURE_URL="http://127.0.0.1:$fixture_port" E2E_BROWSER_CHANNEL="$browser_channel" \
  "$playwright_bin" test e2e/scenarios/shell-dialogs-fixture.spec.ts --workers=1 --reporter=line
stop_server

echo "Deployment research flags enabled"
start_server enabled "$app_port" "$app_root" "/sources" \
  RESEARCH_TARGETS=false RESEARCH_SOURCES=true RESEARCH_SNIPPETS=true RESEARCH_PARSER_TELEMETRY=true
E2E_SHELL_RESEARCH=true E2E_BASE_URL="http://127.0.0.1:$app_port" E2E_BROWSER_CHANNEL="$browser_channel" \
  "$playwright_bin" test e2e/scenarios/shell-navigation.spec.ts --workers=1 --reporter=line
stop_server

echo "Deployment research flags disabled"
start_server disabled "$app_port" "$app_root" "/sources" \
  RESEARCH_TARGETS=false RESEARCH_SOURCES=false RESEARCH_SNIPPETS=false RESEARCH_PARSER_TELEMETRY=false
E2E_SHELL_RESEARCH=false E2E_BASE_URL="http://127.0.0.1:$app_port" E2E_BROWSER_CHANNEL="$browser_channel" \
  "$playwright_bin" test e2e/scenarios/shell-navigation.spec.ts --workers=1 --reporter=line
stop_server
