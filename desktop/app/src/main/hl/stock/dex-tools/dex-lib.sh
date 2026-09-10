#!/usr/bin/env bash
# Shared plumbing for the dex-* CLIs.
#
# Every DEX tool is a thin client: it turns argv into JSON, POSTs it to the
# app's loopback control server, and prints what comes back. All the state —
# the task ledger, the file index, MCP connections — lives in the one process
# that already owns the database, so the tools stay stateless and disposable.
#
# Sourced, never executed directly.

set -uo pipefail

# The control file is written by the app at startup (mode 0600) and holds the
# ephemeral port and bearer token. DEX_CONTROL_FILE is injected into the
# agent's environment; the fallback covers a tool run by hand from the harness
# directory, which is the agent's cwd.
dex_control_file() {
  if [ -n "${DEX_CONTROL_FILE:-}" ] && [ -f "${DEX_CONTROL_FILE}" ]; then
    printf '%s' "${DEX_CONTROL_FILE}"
    return 0
  fi
  if [ -f "../local-task-server.json" ]; then
    printf '%s' "../local-task-server.json"
    return 0
  fi
  return 1
}

# Minimal string-field reader. The two values read here are a URL and a
# base64url token, neither of which can contain a quote or a backslash, so a
# real JSON parser (and a hard dependency on jq or python being installed)
# is not worth buying.
dex_json_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" | head -n 1
}

# JSON-escape one argument for embedding in a request body.
#
# Bash parameter expansion rather than sed: chaining -e expressions with a
# label to fold newlines is unreadable, breaks as soon as a replacement itself
# contains a backslash, and did exactly that here — it emitted nothing at all,
# which quietly sent an empty session id to the server. This has no subprocess
# and no second layer of quoting to get wrong.
dex_esc() {
  local s="$1"
  s="${s//\\/\\\\}"     # backslashes first, or the escapes below get doubled
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# dex_post <path> <json-body>
dex_post() {
  local path="$1" body="$2" control url token response status
  if ! control="$(dex_control_file)"; then
    echo "dex: cannot find the DEX control file. Is the app running? (set DEX_CONTROL_FILE)" >&2
    return 3
  fi
  url="$(dex_json_field url "$control")"
  token="$(dex_json_field token "$control")"
  if [ -z "$url" ] || [ -z "$token" ]; then
    echo "dex: the control file at $control is unreadable or incomplete" >&2
    return 3
  fi

  # Keep the status line separate from the body so a non-2xx reply still shows
  # the server's own error message instead of an opaque curl failure.
  response="$(curl -sS -X POST "${url}${path}" \
    -H "authorization: Bearer ${token}" \
    -H "content-type: application/json" \
    --data-raw "${body}" \
    -w $'\n%{http_code}' 2>&1)" || {
      echo "dex: could not reach the DEX control server at ${url}" >&2
      return 3
    }

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  printf '%s\n' "$body"
  case "$status" in
    2*) return 0 ;;
    *)  return 1 ;;
  esac
}

# The session this agent is driving. Set by the app for every spawned engine.
dex_session_id() {
  printf '%s' "${DEX_SESSION_ID:-${BU_SESSION_ID:-}}"
}
