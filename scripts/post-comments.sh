#!/bin/bash
# post-comments.sh - Helper functions for posting comments to GitHub PRs
set -euo pipefail

# Post size warning when PR exceeds limits
post_size_warning() {
  local body=" **Sage Review Skipped**

This PR exceeds the size limits for automated review:
- **Files changed:** ${FILES_CHANGED:-0} (limit: ${MAX_FILES:-50})
- **Lines changed:** ${LINES_CHANGED:-0} (limit: ${MAX_LINES:-2000})

### Recommendations

**Option 1: Break into smaller PRs** (Recommended)
Split this PR into smaller, focused changes for better review quality.

**Option 2: Adjust limits for this PR**
Override the limits in your workflow:
\`\`\`yaml
- uses: nssalian/sage@v1
  with:
    max-files: 100
    max-lines: 5000
\`\`\`

[WARNING] **Note:** Larger PRs may take longer and cost more (~\$0.50-\$1.00 per review)."

  echo "::group::Posting size warning comment"

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
    -d "$(jq -n --arg body "$body" '{body: $body}')")

  local http_code=$(echo "$response" | tail -n1)

  if [ "$http_code" = "201" ]; then
    echo "[OK] Size warning posted successfully"
  else
    echo "::warning::Failed to post comment (HTTP $http_code)"
    echo "$response" | head -n-1
  fi

  echo "::endgroup::"
}

# Post a generic comment to the PR
post_comment() {
  local body="$1"

  # Validate required environment variables
  if [ -z "${GITHUB_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ] || [ -z "${PR_NUMBER:-}" ]; then
    echo "::error::Missing required environment variables"
    return 1
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -d "$(jq -n --arg body "$body" '{body: $body}')")

  local http_code
  http_code=$(echo "$response" | tail -n1)

  if [ "$http_code" = "201" ]; then
    return 0
  else
    echo "::warning::Failed to post comment (HTTP $http_code)"
    return 1
  fi
}

# Post an error comment when review fails
post_error_comment() {
  local error_message="${1:-Unknown error}"

  local body=" **Sage Review Failed**

The automated code review encountered an error:

\`\`\`
${error_message}
\`\`\`

### Troubleshooting

1. **Check API key**: Verify your LLM provider API key secret is set correctly
2. **Check rate limits**: Visit your provider's dashboard for usage
3. **Check workflow logs**: View logs in the Actions tab

If the issue persists, please check the Sage documentation."

  post_comment "$body"
}
