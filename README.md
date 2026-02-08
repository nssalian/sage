# Sage

AI code review for GitHub Actions. Uses Anthropic Claude, OpenAI GPT, or Google Gemini (Vertex AI).

## Quick Start

Add `.github/workflows/sage.yml`:

```yaml
name: Sage Review

on:
  pull_request:
    types: [labeled]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: |
      (github.event_name == 'pull_request' && github.event.label.name == 'sage') ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '/sage'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nssalian/sage@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-provider: anthropic
          llm-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Trigger a review by adding the `sage` label or commenting `/sage` on a PR.

## Secrets and Auth

Store secrets in repo settings -> Secrets -> Actions:

- `ANTHROPIC_API_KEY` for Anthropic Claude
- `OPENAI_API_KEY` for OpenAI GPT

Google Gemini uses Vertex AI (not the public Gemini API):

- Set `llm-provider: google`
- Set `google-project-id` input
- Authenticate via Workload Identity or a service account with `GOOGLE_APPLICATION_CREDENTIALS`
- `llm-api-key` is still required by the action input validation, but is not used by Vertex AI. Set it to any dummy value with 10+ characters using only `a-zA-Z0-9_-:.` (for example `DUMMY_LLM_KEY`).

## Configuration

```yaml
- uses: nssalian/sage@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    llm-provider: anthropic          # anthropic, openai, or google
    llm-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

    # Optional settings
    llm-model: ""                    # Defaults: claude-sonnet-4-5-20250929, gpt-4-turbo-preview, gemini-1.5-pro
    google-project-id: ""            # Required when llm-provider: google
    google-location: us-central1     # Vertex AI location
    max-files: 50                    # Limit files reviewed (cost control)
    max-lines: 2000                  # Limit total lines changed
    max-tokens: 50000                # Max tokens per review
    thinking-budget: 10000           # Anthropic only
    guidelines-path: SAGE.md         # Project-specific guidelines
    severity-threshold: LOW          # CRITICAL, HIGH, MEDIUM, LOW
    fail-on-errors: false            # Fail workflow if the LLM call errors
```

## Custom Guidelines

Create `SAGE.md` in your repo root to add project-specific review guidelines:

```markdown
# Review Guidelines

Focus on:
- SQL injection and XSS vulnerabilities
- Async/await error handling
- Never log API keys or tokens
```

## Supported Providers

Defaults are set in `action.yaml` and can be overridden via `llm-model`:

- Anthropic Claude: `claude-sonnet-4-5-20250929`
- OpenAI GPT: `gpt-4-turbo-preview`
- Google Gemini (Vertex AI): `gemini-1.5-pro`

## How It Works

1. Triggered by label (`sage`) or comment (`/sage`)
2. Analyzes changed files in the PR
3. Posts inline comments for each issue found
4. Posts a summary comment with severity breakdown
5. Updates the same comment on re-review
6. Prints token usage and estimated cost in the workflow output

Issues are categorized as CRITICAL, HIGH, MEDIUM, or LOW based on impact.

## Local Testing

```bash
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=your-key
export GITHUB_TOKEN=your-token

./test-local.sh owner/repo 123 /tmp/repo
```

For Google (Vertex AI):

```bash
export LLM_PROVIDER=google
export GOOGLE_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export GOOGLE_API_KEY=DUMMY_LLM_KEY
export GITHUB_TOKEN=your-token

./test-local.sh owner/repo 123 /tmp/repo
```

Set `DRY_RUN=false` to actually post comments.

## Development

```bash
make install    # Install dependencies
make lint       # Run linter
make test       # Run tests
```

## License

Apache 2.0 - see [LICENSE](LICENSE)
