#!/usr/bin/env bash
# metaharness-scan.sh — per-component MetaHarness scan for this monorepo.
#
# MetaHarness (`metaharness score <dir>` / `metaharness genome <dir>`) has NO
# monorepo awareness: it scores whatever single directory you point it at.
# Scoring the REPO ROOT is actively misleading here — root has no
# package.json/tsconfig, so it reports repo_type "unknown_mcp", near-zero
# compileConfidence, and verdict "blocked". Those are artifacts of scanning
# the wrong directory, not real findings about this repo. This script instead
# scans each real component directory and aggregates the results into one
# table, so the numbers reflect actual buildable units.
#
# Usage:
#   scripts/metaharness-scan.sh [component ...]
#
#   With no arguments, scans the default component set (see COMPONENTS below).
#   Pass one or more directory names to scan a subset, e.g.:
#     scripts/metaharness-scan.sh app browser
#
# Exit code: ALWAYS 0 (report-only; safe to run as a non-blocking CI step).
# A missing/failing metaharness binary or a bad component score is reported
# in the table, never turned into a script failure.
#
# Binary resolution (first match wins), see resolve_bin():
#   1. $METAHARNESS_BIN               — explicit override, must be executable
#   2. `metaharness` on PATH
#   3. <repo>/**/node_modules/.bin/metaharness (repo root + component dirs)
#   4. ~/.ruflo/metaharness-cache-*/node_modules/metaharness/dist/bin.js
#      (ruflo's local metaharness cache, when present on this machine)
#   5. `npx --yes metaharness@latest` (network fallback; set
#      METAHARNESS_NO_NPX=1 to disable, e.g. in offline CI)
#
# If no binary resolves, the script prints a clear WARN and still exits 0
# with a degraded table (every row marked "skipped").

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 0

# --- component set ----------------------------------------------------------
# Deliberately excludes the repo root — see header comment. Root has no
# package.json/tsconfig, so scanning it produces "unknown_mcp" /
# compileConfidence ~12 / "blocked" artifacts that are not real findings.
DEFAULT_COMPONENTS=(app browser scripts docs)
if [[ $# -gt 0 ]]; then
  COMPONENTS=("$@")
else
  COMPONENTS=("${DEFAULT_COMPONENTS[@]}")
fi

echo "metaharness-scan: repo root ($REPO_ROOT) is deliberately excluded from the tracked set — it has no package.json/tsconfig and scores as a false 'blocked' artifact, not a real finding."
echo

# --- baseline (captured 2026-08-16) for operator context -------------------
# harnessFit / compileConfidence / risk_score. Not asserted against — just
# printed alongside so a human can eyeball drift. compileConfidence for
# browser/docs/scripts may legitimately read HIGHER than this baseline if
# their package.json scripts were improved since it was captured — that is
# expected, not a regression.
#
# Plain `case` lookup rather than an associative array (`declare -A`) — the
# macOS system /bin/bash is 3.2, which predates bash 4's associative arrays,
# and this script needs to run unmodified there as well as in CI.
baseline_for() {
  case "$1" in
    app)     echo "57 / 90 / 0.295 (needs-work)" ;;
    browser) echo "61 / 65 / 0.47 (needs-work)" ;;
    docs)    echo "51 / 65 / --" ;;
    scripts) echo "50 / 40 / --" ;;
    *)       echo "" ;;
  esac
}

# --- resolve the metaharness binary -----------------------------------------
# Sets METAHARNESS_CMD (bash array) — invoke as "${METAHARNESS_CMD[@]}" <args>.
METAHARNESS_CMD=()
BIN_SOURCE=""

resolve_bin() {
  if [[ -n "${METAHARNESS_BIN:-}" ]]; then
    if [[ -x "${METAHARNESS_BIN}" ]]; then
      METAHARNESS_CMD=("${METAHARNESS_BIN}")
      BIN_SOURCE="\$METAHARNESS_BIN override"
      return 0
    fi
    echo "WARN: METAHARNESS_BIN=${METAHARNESS_BIN} is set but not executable — ignoring." >&2
  fi

  if command -v metaharness >/dev/null 2>&1; then
    METAHARNESS_CMD=("metaharness")
    BIN_SOURCE="PATH"
    return 0
  fi

  local candidate
  for candidate in \
    "$REPO_ROOT/node_modules/.bin/metaharness" \
    "$REPO_ROOT"/*/node_modules/.bin/metaharness
  do
    if [[ -x "$candidate" ]]; then
      METAHARNESS_CMD=("$candidate")
      BIN_SOURCE="local node_modules ($candidate)"
      return 0
    fi
  done

  local dist_bin
  for dist_bin in "$HOME"/.ruflo/metaharness-cache-*/node_modules/metaharness/dist/bin.js; do
    if [[ -f "$dist_bin" ]]; then
      METAHARNESS_CMD=("node" "$dist_bin")
      BIN_SOURCE="ruflo cache ($dist_bin)"
      return 0
    fi
  done

  if [[ "${METAHARNESS_NO_NPX:-0}" != "1" ]] && command -v npx >/dev/null 2>&1; then
    if npx --yes metaharness@latest --help >/dev/null 2>&1; then
      METAHARNESS_CMD=("npx" "--yes" "metaharness@latest")
      BIN_SOURCE="npx (network fallback)"
      return 0
    fi
  fi

  return 1
}

if ! resolve_bin; then
  echo "WARN: metaharness binary not found (checked \$METAHARNESS_BIN, PATH, local node_modules/.bin, ~/.ruflo cache, and npx fallback)."
  echo "      Install it with 'npm install -D metaharness' or set METAHARNESS_BIN to a working dist/bin.js, then re-run."
  echo "      Continuing in degraded mode — every component below is reported as skipped. Exit code stays 0 (non-blocking)."
  echo
  DEGRADED=1
else
  echo "metaharness-scan: using metaharness via ${BIN_SOURCE}"
  echo
  DEGRADED=0
fi

# --- json field extraction (no jq dependency; node is already required) ----
json_get() {
  # json_get <json-string> <field>
  node -e '
    let input = process.argv[1];
    let field = process.argv[2];
    try {
      const obj = JSON.parse(input);
      const v = obj[field];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch {
      process.stdout.write("");
    }
  ' "$1" "$2" 2>/dev/null
}

# --- scan one component ------------------------------------------------------
declare -a ROWS=()

scan_component() {
  local comp="$1"
  local dir="$REPO_ROOT/$comp"

  if [[ ! -d "$dir" ]]; then
    echo "WARN: component directory '$comp' does not exist under $REPO_ROOT — skipping." >&2
    ROWS+=("$comp|missing|missing|missing|missing|missing|missing")
    return
  fi

  if [[ "$DEGRADED" == "1" ]]; then
    ROWS+=("$comp|skipped|skipped|skipped|skipped|skipped|skipped")
    return
  fi

  local score_json score_rc genome_json genome_rc
  score_json="$("${METAHARNESS_CMD[@]}" score "$dir" --json 2>&1)"
  score_rc=$?
  genome_json="$("${METAHARNESS_CMD[@]}" genome "$dir" --json 2>&1)"
  genome_rc=$?

  local harness_fit compile_conf risk_score mcp_surface publish_ready verdict

  if [[ $score_rc -eq 0 ]]; then
    harness_fit="$(json_get "$score_json" harnessFit)"
    compile_conf="$(json_get "$score_json" compileConfidence)"
    [[ -z "$harness_fit" ]] && harness_fit="parse-error"
    [[ -z "$compile_conf" ]] && compile_conf="parse-error"
  else
    harness_fit="error(rc=$score_rc)"
    compile_conf="error(rc=$score_rc)"
    echo "WARN: 'metaharness score $comp' failed (exit $score_rc): $(echo "$score_json" | head -c 200)" >&2
  fi

  # genome's exit code IS the verdict: 0=ready, 1=needs-work, 2=blocked.
  # A genome exit of 2 can ALSO mean a hard CLI error (bad path); disambiguate
  # by checking for the JSON "error" key that only the error path sets.
  local genome_error
  genome_error="$(json_get "$genome_json" error)"
  if [[ -n "$genome_error" ]]; then
    risk_score="error"
    mcp_surface="error"
    publish_ready="error"
    verdict="error: $genome_error"
    echo "WARN: 'metaharness genome $comp' returned an error: $genome_error" >&2
  else
    risk_score="$(json_get "$genome_json" risk_score)"
    mcp_surface="$(json_get "$genome_json" mcp_surface)"
    publish_ready="$(json_get "$genome_json" publish_readiness)"
    [[ -z "$risk_score" ]] && risk_score="parse-error"
    [[ -z "$mcp_surface" ]] && mcp_surface="parse-error"
    [[ -z "$publish_ready" ]] && publish_ready="parse-error"
    case "$genome_rc" in
      0) verdict="ready" ;;
      1) verdict="needs-work" ;;
      2) verdict="blocked" ;;
      *) verdict="unknown(rc=$genome_rc)" ;;
    esac
  fi

  ROWS+=("$comp|$harness_fit|$compile_conf|$risk_score|$verdict|$mcp_surface|$publish_ready")
}

for comp in "${COMPONENTS[@]}"; do
  scan_component "$comp"
done

# --- render table -------------------------------------------------------------
printf '%-10s %-12s %-14s %-12s %-14s %-20s %-10s\n' \
  "COMPONENT" "HARNESS_FIT" "COMPILE_CONF" "RISK_SCORE" "VERDICT" "MCP_SURFACE" "PUBLISH_R"
printf '%-10s %-12s %-14s %-12s %-14s %-20s %-10s\n' \
  "---------" "-----------" "------------" "----------" "-------" "-----------" "---------"

for row in "${ROWS[@]}"; do
  IFS='|' read -r comp harness_fit compile_conf risk_score verdict mcp_surface publish_ready <<< "$row"
  printf '%-10s %-12s %-14s %-12s %-14s %-20s %-10s\n' \
    "$comp" "$harness_fit" "$compile_conf" "$risk_score" "$verdict" "$mcp_surface" "$publish_ready"
done

echo
echo "Baseline (captured 2026-08-16, harnessFit / compileConfidence / risk_score (verdict)):"
for comp in "${COMPONENTS[@]}"; do
  baseline="$(baseline_for "$comp")"
  if [[ -n "$baseline" ]]; then
    printf '  %-10s %s\n' "$comp" "$baseline"
  fi
done
echo "  (compileConfidence reading higher than baseline for browser/docs/scripts is expected if their"
echo "   package.json scripts were improved since the baseline was captured — not a regression.)"

# Always non-blocking: this is a report, not a gate. A bad score in a
# component should show up in the table above, not fail CI.
exit 0
