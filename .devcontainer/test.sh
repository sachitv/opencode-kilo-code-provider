#!/usr/bin/env bash
set -euo pipefail

cd /workspace
bun install --frozen-lockfile
bun run check

test_version() {
  local version="$1"
  local config="$2"
  local config_home="/tmp/opencode-${version}/config"
  local data_home="/tmp/opencode-${version}/data"

  rm -rf "/tmp/opencode-${version}"
  mkdir -p "$config_home/opencode" "$data_home"

  if [[ -n "${KILO_CODE_API_KEY:-}" ]]; then
    mkdir -p "$data_home/opencode"
    KILO_CODE_API_KEY="$KILO_CODE_API_KEY" \
      AUTH_FILE="$data_home/opencode/auth.json" \
      bun -e 'await Bun.write(process.env.AUTH_FILE, JSON.stringify({ "kilo-code": { type: "api", key: process.env.KILO_CODE_API_KEY } }))'
  fi

  if [[ "$version" == 2.* ]]; then
    local opencode_command="/opt/opencode-v2/node_modules/.bin/opencode2"
    local models_args=(models --standalone)
  else
    local opencode_command="$HOME/.opencode/bin/opencode"
    local models_args=(models kilo-code)
  fi

  if [[ "$version" == 2.* ]]; then
    cp "$config" "$config_home/opencode/opencode.json"
  else
    cp "$config" "$config_home/opencode/opencode.jsonc"
  fi

  echo "Testing OpenCode ${version}"
  "$opencode_command" --version
  if [[ "$version" != 2.* && -n "${KILO_CODE_API_KEY:-}" ]]; then
    models_output=$(
      XDG_CONFIG_HOME="$config_home" \
      XDG_DATA_HOME="$data_home" \
      timeout 60s "$opencode_command" "${models_args[@]}" 2>&1
    )
    if [[ "$models_output" != *"kilo-code/"* ]]; then
      printf '%s\n' "$models_output"
      echo "Kilo Code provider was not loaded by OpenCode ${version}" >&2
      return 1
    fi
    echo "Kilo Code provider loaded."
  fi

  if [[ "$version" == 2.* ]]; then
    config_output=$( \
      XDG_CONFIG_HOME="$config_home" \
      XDG_DATA_HOME="$data_home" \
      "$opencode_command" debug config 2>&1
    )
    if [[ "$config_output" != *"file:///workspace/dist"* ]]; then
      printf '%s\n' "$config_output"
      echo "Kilo Code plugin configuration was not loaded by OpenCode ${version}" >&2
      return 1
    fi
    echo "Kilo Code plugin configuration loaded."
  fi

  if [[ -n "${KILO_CODE_API_KEY:-}" ]]; then
    if [[ "$version" == 2.* ]]; then
      completion_output=$(
        XDG_CONFIG_HOME="$config_home" \
        XDG_DATA_HOME="$data_home" \
        timeout 60s "$opencode_command" run --standalone --model "kilo-code/kilo-auto/free" "Reply with exactly OK." 2>&1
      )
    else
      completion_output=$(
        XDG_CONFIG_HOME="$config_home" \
        XDG_DATA_HOME="$data_home" \
        timeout 60s "$opencode_command" run "Reply with exactly OK." 2>&1
      )
    fi
    printf '%s\n' "$completion_output"
    if [[ "$completion_output" != *"OK"* ]]; then
      echo "Kilo Code completion failed in OpenCode ${version}" >&2
      return 1
    fi
  else
    echo "Skipping live completion; set KILO_CODE_API_KEY to run it."
  fi
}

test_version "1.18.30" "/workspace/.devcontainer/opencode-v1.jsonc"
test_version "2.0.3" "/workspace/.devcontainer/opencode-v2.jsonc"
