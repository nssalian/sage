#!/bin/bash
# trigger-handler.sh - Detects if Sage review was requested via label or comment
set -euo pipefail

check_trigger_condition() {
  local should_review="false"
  local trigger_source=""

  echo "::group::Checking trigger condition"
  echo "Event: ${EVENT_NAME:-unset}"
  echo "Action: ${EVENT_ACTION:-unset}"

  # Check if triggered by 'sage' label
  if [ "${EVENT_NAME:-}" = "pull_request" ] && \
     [ "${EVENT_ACTION:-}" = "labeled" ] && \
     [ "${LABEL_NAME:-}" = "sage" ]; then
    should_review="true"
    trigger_source="label"
    echo "[OK] Triggered by 'sage' label"
  fi

  # Check if triggered by '/sage' comment
  if [ "${EVENT_NAME:-}" = "issue_comment" ] && \
     [ "${EVENT_ACTION:-}" = "created" ]; then
    # Check if comment starts with /sage (case-insensitive)
    # Use proper quoting to prevent injection
    if echo "${COMMENT_BODY:-}" | grep -iq "^/sage"; then
      should_review="true"
      trigger_source="comment"
      echo "[OK] Triggered by '/sage' comment"
    else
      echo "[INFO]  Comment does not contain '/sage'"
    fi
  fi

  # If neither trigger matched
  if [ "$should_review" = "false" ]; then
    echo "[INFO]  Review not triggered (no label or command found)"
    echo ""
    echo "To trigger Sage review:"
    echo "  1. Add label: sage"
    echo "  2. Comment: /sage"
  fi

  # Set outputs (safely)
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "should_review=$should_review" >> "$GITHUB_OUTPUT"
    echo "trigger_source=$trigger_source" >> "$GITHUB_OUTPUT"
  fi

  echo "::endgroup::"
}
