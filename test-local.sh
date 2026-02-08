#!/bin/bash
# test-local.sh - Test sage locally on a real PR
#
# Usage:
#   export ANTHROPIC_API_KEY="sk-ant-..."
#   export GITHUB_TOKEN="ghp_..."  # Personal access token from github.com/settings/tokens
#   ./test-local.sh <repo> <pr-number> <local-checkout-path>
#
# Example:
#   ./test-local.sh owner/repo 123 /tmp/repo

set -e

# Get script directory at the very beginning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Provider defaults
LLM_PROVIDER="${LLM_PROVIDER:-anthropic}"

# Check for API key based on provider
case "$LLM_PROVIDER" in
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ]; then
      echo "Error: ANTHROPIC_API_KEY not set"
      echo "Get one from: https://console.anthropic.com/"
      exit 1
    fi
    export LLM_API_KEY="$ANTHROPIC_API_KEY"
    ;;
  openai)
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Error: OPENAI_API_KEY not set"
      echo "Get one from: https://platform.openai.com/"
      exit 1
    fi
    export LLM_API_KEY="$OPENAI_API_KEY"
    ;;
  google)
    if [ -z "$GOOGLE_API_KEY" ]; then
      echo "Error: GOOGLE_API_KEY not set"
      exit 1
    fi
    export LLM_API_KEY="$GOOGLE_API_KEY"
    ;;
esac

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN not set"
  echo "Create one at: https://github.com/settings/tokens"
  echo "Needs: repo (all) permissions"
  exit 1
fi

if [ $# -lt 3 ]; then
  echo "Usage: $0 <repo> <pr-number> <local-checkout-path>"
  echo ""
  echo "Example:"
  echo "  $0 owner/repo 123 /tmp/repo"
  echo ""
  echo "The repo should already be cloned at <local-checkout-path>"
  exit 1
fi

REPO=$1
PR_NUMBER=$2
WORKSPACE=$3

# Auto-clone if directory doesn't exist
if [ ! -d "$WORKSPACE/.git" ]; then
  echo "Repository not found locally. Cloning..."
  git clone "git@github.com:$REPO.git" "$WORKSPACE"
  echo ""
fi

echo "=== Testing Sage Review Locally ==="
echo "Repository: $REPO"
echo "PR: #$PR_NUMBER"
echo "Provider: $LLM_PROVIDER"
echo "Workspace: $WORKSPACE"
echo ""

# Get PR info from GitHub API
echo "Fetching PR info from GitHub..."
PR_DATA=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/pulls/$PR_NUMBER")

BASE_REF=$(echo "$PR_DATA" | jq -r '.base.ref')
HEAD_SHA=$(echo "$PR_DATA" | jq -r '.head.sha')
HEAD_REF=$(echo "$PR_DATA" | jq -r '.head.ref')

if [ "$BASE_REF" = "null" ]; then
  echo "Error: Could not fetch PR info."
  echo ""
  echo "API Response:"
  echo "$PR_DATA" | jq '.'
  echo ""
  echo "Possible issues:"
  echo "1. GITHUB_TOKEN doesn't have 'repo' scope"
  echo "2. Token not authorized for org SSO"
  echo "3. PR number is incorrect"
  exit 1
fi

echo "Base branch: $BASE_REF"
echo "Head SHA: $HEAD_SHA"
echo "Head ref: $HEAD_REF"
echo ""

# Go to workspace and checkout PR branch
cd "$WORKSPACE"
echo "Fetching latest changes..."
git fetch origin

echo "Checking out PR branch..."
git checkout "$HEAD_REF" 2>/dev/null || git checkout -b "pr-$PR_NUMBER" "$HEAD_SHA"
git pull origin "$HEAD_REF" 2>/dev/null || true

echo ""
echo "=== Running Sage Review ==="
echo ""

# Set environment variables and run review
export LLM_PROVIDER
export LLM_API_KEY
export GITHUB_TOKEN
export GITHUB_REPOSITORY="$REPO"
export PR_NUMBER
export BASE_REF
export HEAD_SHA
export WORKSPACE="$WORKSPACE"
export THINKING_BUDGET="${THINKING_BUDGET:-10000}"
export MAX_TOKENS="${MAX_TOKENS:-50000}"
export GUIDELINES_PATH="${GUIDELINES_PATH:-SAGE.md}"
export SEVERITY_THRESHOLD="${SEVERITY_THRESHOLD:-LOW}"
export FAIL_ON_ERRORS="${FAIL_ON_ERRORS:-false}"
export DRY_RUN="${DRY_RUN:-true}"  # Default to dry-run (no posting)

# Google-specific
if [ "$LLM_PROVIDER" = "google" ]; then
  export GOOGLE_PROJECT_ID="${GOOGLE_PROJECT_ID}"
  export GOOGLE_LOCATION="${GOOGLE_LOCATION:-us-central1}"
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "[DRY RUN MODE] Will not post comments to GitHub"
  echo "Set DRY_RUN=false to post comments"
  echo ""
fi

# Run from sage directory
echo "Script directory: $SCRIPT_DIR"
cd "$SCRIPT_DIR"

if [ ! -f "scripts/review.js" ]; then
  echo "Error: scripts/review.js not found in $SCRIPT_DIR"
  exit 1
fi

node scripts/review.js

echo ""
echo "=== Review Complete ==="
if [ "$DRY_RUN" = "true" ]; then
  echo "This was a dry run. Set DRY_RUN=false to post to GitHub."
else
  echo "Check the PR comments at: https://github.com/$REPO/pull/$PR_NUMBER"
fi
