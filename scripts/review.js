#!/usr/bin/env node
/**
 * Sage - Multi-LLM Code Review Engine
 *
 * Supports: Anthropic Claude, OpenAI GPT, Google Gemini
 */

const { Octokit } = require('@octokit/rest');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ProviderFactory = require('./providers/factory');

// Configuration from environment variables
const CONFIG = {
  // LLM Provider Config
  provider: process.env.LLM_PROVIDER || 'anthropic',
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,

  // GitHub Config
  githubToken: process.env.GITHUB_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
  prNumber: parseInt(process.env.PR_NUMBER),
  baseBranch: process.env.BASE_REF,
  headSha: process.env.HEAD_SHA,
  workspace: process.env.WORKSPACE,

  // Review Config
  thinkingBudget: parseInt(process.env.THINKING_BUDGET || '10000'),
  maxTokens: parseInt(process.env.MAX_TOKENS || '50000'),
  guidelinesPath: process.env.GUIDELINES_PATH || 'SAGE.md',
  severityThreshold: process.env.SEVERITY_THRESHOLD || 'LOW',
  failOnErrors: process.env.FAIL_ON_ERRORS === 'true',
  dryRun: process.env.DRY_RUN === 'true',

  // Google-specific
  googleProjectId: process.env.GOOGLE_PROJECT_ID,
  googleLocation: process.env.GOOGLE_LOCATION || 'us-central1'
};

// Initialize GitHub client
const octokit = new Octokit({
  auth: CONFIG.githubToken,
  userAgent: 'sage/1.0.0'
});

// Severity levels for filtering
const SEVERITY_LEVELS = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

/**
 * Main entry point for Sage review process
 * Coordinates PR analysis, LLM review, and GitHub comment posting
 * @async
 * @throws {Error} When required configuration is missing or invalid
 */
async function main() {
  try {
    console.log('🧙‍♂️ Starting Sage Review');
    console.log('================================');
    console.log(`Repository: ${CONFIG.repository}`);
    console.log(`PR: #${CONFIG.prNumber}`);
    console.log(`Provider: ${CONFIG.provider}`);
    console.log(`Model: ${CONFIG.model || 'default'}`);
    console.log('');

    // Validate configuration
    validateConfig();

    // Parse repository owner and name
    const [owner, repo] = CONFIG.repository.split('/');

    // Change to workspace directory
    process.chdir(CONFIG.workspace);

    // Get PR diff and files
    const { diff, changedFiles } = await getPRChanges();

    // Filter reviewable files
    const reviewableFiles = filterFiles(changedFiles);

    if (reviewableFiles.length === 0) {
      console.log('[INFO]  No reviewable files found');
      await postNoFilesComment(owner, repo);
      setOutputs({ completed: true, findings_count: 0, critical_count: 0, high_count: 0 });
      return;
    }

    console.log(`📝 Reviewing ${reviewableFiles.length}/${changedFiles.length} files`);
    console.log('');

    // Read project guidelines (optional)
    const guidelines = await readGuidelines();

    // Create LLM provider
    const llmProvider = ProviderFactory.createProvider(
      CONFIG.provider,
      CONFIG.apiKey,
      CONFIG.model,
      {
        projectId: CONFIG.googleProjectId,
        location: CONFIG.googleLocation
      }
    );

    console.log(`[OK] Using ${llmProvider.getName()}`);
    if (llmProvider.supportsPromptCaching()) {
      console.log('[OK] Prompt caching enabled');
    }
    if (llmProvider.supportsExtendedThinking()) {
      console.log('[OK] Extended thinking enabled');
    }

    // Call LLM API
    const response = await callLLM(llmProvider, diff, reviewableFiles, guidelines);

    // Parse findings
    const allFindings = parseFindings(response.text);

    // Filter by severity threshold
    const findings = filterBySeverity(allFindings);

    console.log(`[OK] Found ${findings.length} issues (${allFindings.length - findings.length} filtered by threshold)`);

    // Count by severity
    const counts = countBySeverity(findings);

    // Calculate cost estimate (use model from API response)
    const costEstimate = calculateCost(response.usage, response.model);

    if (CONFIG.dryRun) {
      // Dry run - just print findings, don't post to GitHub
      console.log('');
      console.log('[DRY RUN] Review completed - not posting to GitHub');
      console.log('='.repeat(80));
      console.log('');
      printFindings(findings, response.usage, costEstimate, response.model);
    } else {
      // Post comments to GitHub
      if (findings.length > 0) {
        await postReviewComments(owner, repo, findings);
      }

      // Post summary comment
      await postSummaryComment(owner, repo, findings, response.usage, response.model);

      console.log('');
      console.log('[SUCCESS] Review completed successfully');
      console.log(`   Findings: ${findings.length} (${counts.CRITICAL} critical, ${counts.HIGH} high)`);
      console.log(`   Cost: $${costEstimate.toFixed(4)}`);
    }

    // Set outputs for workflow
    setOutputs({
      completed: true,
      findings_count: findings.length,
      critical_count: counts.CRITICAL,
      high_count: counts.HIGH,
      cost_estimate: costEstimate.toFixed(4)
    });

  } catch (error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message);
    console.error('[ERROR] Review failed:', sanitizedMessage);

    // Only log stack trace in debug mode, never in production
    if (process.env.DEBUG === 'true') {
      console.error(error.stack);
    }

    // Try to post error comment
    try {
      const [owner, repo] = CONFIG.repository.split('/');
      await postErrorComment(owner, repo, sanitizedMessage);
    } catch (postError) {
      const sanitizedPostError = sanitizeErrorMessage(postError.message);
      console.error('Failed to post error comment:', sanitizedPostError);
    }

    setOutputs({ completed: false });

    if (CONFIG.failOnErrors) {
      process.exit(1);
    }
  }
}

/**
 * Sanitize error messages to prevent leaking sensitive information
 * Redacts API keys, tokens, and other secrets from error messages
 */
function sanitizeErrorMessage(message) {
  if (!message) return 'Unknown error';

  let sanitized = message;

  // Redact common API key patterns
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***');
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36,}/g, 'ghp_***REDACTED***');
  sanitized = sanitized.replace(/gho_[a-zA-Z0-9]{36,}/g, 'gho_***REDACTED***');
  sanitized = sanitized.replace(/github_pat_[a-zA-Z0-9_]{82,}/g, 'github_pat_***REDACTED***');

  // Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer [a-zA-Z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');

  // Redact Authorization headers
  sanitized = sanitized.replace(/Authorization: [^\s]+/g, 'Authorization: ***REDACTED***');

  // Redact x-api-key headers
  sanitized = sanitized.replace(/x-api-key: [^\s]+/gi, 'x-api-key: ***REDACTED***');

  // Redact any long alphanumeric strings that might be keys (40+ chars)
  sanitized = sanitized.replace(/\b[a-zA-Z0-9_\-]{40,}\b/g, '***REDACTED***');

  return sanitized;
}

/**
 * Validate all configuration parameters
 * Checks required fields, formats, bounds, and security constraints
 * @throws {Error} When any validation fails with descriptive message
 */
function validateConfig() {
  const required = [
    'provider',
    'apiKey',
    'githubToken',
    'repository',
    'prNumber',
    'baseBranch',
    'workspace'
  ];

  for (const field of required) {
    if (!CONFIG[field]) {
      throw new Error(`Missing required configuration: ${field}`);
    }
  }

  // Validate PR number is a positive integer
  if (isNaN(CONFIG.prNumber) || CONFIG.prNumber <= 0 || !Number.isInteger(CONFIG.prNumber)) {
    throw new Error(`Invalid PR number: must be a positive integer (got: ${process.env.PR_NUMBER})`);
  }

  // Validate repository format (owner/repo)
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(CONFIG.repository)) {
    throw new Error(`Invalid repository format: must be owner/repo (got: ${CONFIG.repository})`);
  }

  // Validate provider is supported (strict whitelist)
  const supported = ProviderFactory.getSupportedProviders();
  if (!supported.includes(CONFIG.provider.toLowerCase())) {
    throw new Error(`Unsupported provider: ${CONFIG.provider}. Supported: ${supported.join(', ')}`);
  }

  // Validate severity threshold (strict enum)
  const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  if (!validSeverities.includes(CONFIG.severityThreshold.toUpperCase())) {
    throw new Error(`Invalid severity threshold: ${CONFIG.severityThreshold}. Must be one of: ${validSeverities.join(', ')}`);
  }

  // Validate token budgets are reasonable
  if (CONFIG.maxTokens < 1000 || CONFIG.maxTokens > 200000) {
    throw new Error(`Invalid max-tokens: must be between 1000 and 200000 (got: ${CONFIG.maxTokens})`);
  }

  if (CONFIG.thinkingBudget < 0 || CONFIG.thinkingBudget > 100000) {
    throw new Error(`Invalid thinking-budget: must be between 0 and 100000 (got: ${CONFIG.thinkingBudget})`);
  }

  // Validate API key format (basic checks without logging the key)
  if (CONFIG.apiKey.length < 10) {
    throw new Error('Invalid API key: too short (minimum 10 characters)');
  }

  if (CONFIG.apiKey.length > 500) {
    throw new Error('Invalid API key: too long (maximum 500 characters)');
  }

  if (!/^[a-zA-Z0-9_\-:.]+$/.test(CONFIG.apiKey)) {
    throw new Error('Invalid API key: contains invalid characters');
  }

  // Validate GitHub token format
  if (CONFIG.githubToken.length < 10) {
    throw new Error('Invalid GitHub token: too short');
  }

  // Validate model name if provided
  if (CONFIG.model && (CONFIG.model.length > 100 || CONFIG.model.length === 0)) {
    throw new Error(`Invalid model name: must be between 1 and 100 characters (got: ${CONFIG.model.length} characters)`);
  }

  // Google-specific validation
  if (CONFIG.provider.toLowerCase() === 'google') {
    if (!CONFIG.googleProjectId) {
      throw new Error('Google provider requires GOOGLE_PROJECT_ID environment variable');
    }
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(CONFIG.googleProjectId)) {
      throw new Error('Invalid Google Project ID format');
    }
  }

  // Validate workspace path (prevent directory traversal)
  if (CONFIG.workspace.includes('..') || !path.isAbsolute(CONFIG.workspace)) {
    throw new Error('Invalid workspace path: must be absolute and not contain ".."');
  }
}

/**
 * Get PR changes using git commands
 * @async
 * @returns {Promise<{diff: string, changedFiles: string[]}>} Diff text and array of changed file paths
 * @throws {Error} When git commands fail
 */
async function getPRChanges() {
  console.log('::group::Fetching PR changes');

  try {
    const diff = execSync(
      `git diff origin/${CONFIG.baseBranch}...HEAD`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const changedFiles = execSync(
      `git diff --name-only origin/${CONFIG.baseBranch}...HEAD`,
      { encoding: 'utf-8' }
    ).trim().split('\n').filter(f => f);

    console.log(`[OK] Got diff (${diff.length} chars, ${changedFiles.length} files)`);
    console.log('::endgroup::');

    return { diff, changedFiles };
  } catch (error) {
    console.log('::endgroup::');
    throw new Error(`Failed to get PR changes: ${error.message}`);
  }
}

/**
 * Filter files to exclude generated code, binaries, and sensitive files
 * Automatically blocks sensitive files for security (env files, keys, credentials)
 * @param {string[]} files - Array of file paths to filter
 * @returns {string[]} Filtered array of files safe to review
 */
function filterFiles(files) {
  const excludePatterns = [
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /Gemfile\.lock$/,
    /poetry\.lock$/,
    /go\.sum$/,
    /\.min\.(js|css)$/,
    /dist\//,
    /build\//,
    /target\//,
    /node_modules\//,
    /vendor\//,
    /\.generated\./,
    /_pb2\.py$/,
    /_pb2_grpc\.py$/,
    /\.pb\.go$/,
    /\.(png|jpg|jpeg|gif|svg|ico|pdf|woff|woff2|ttf|eot)$/,
    /__snapshots__\//,
    /\.snap$/,
    /migrations?\//,
    /^\.github\/workflows\//  // Skip CI files to avoid infinite loops
  ];

  // SECURITY: Patterns for sensitive files that should never be reviewed
  const sensitivePatterns = [
    /\.env$/,
    /\.env\./,
    /credentials/i,
    /secrets/i,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /id_rsa/,
    /id_dsa/,
    /id_ecdsa/,
    /id_ed25519/,
    /\.ppk$/,
    /\.keystore$/,
    /\.jks$/,
    /token/i,
    /password/i,
    /api[-_]?key/i
  ];

  const sensitiveFiles = [];
  const filteredFiles = files.filter(file => {
    // Check for sensitive files
    if (sensitivePatterns.some(pattern => pattern.test(file))) {
      sensitiveFiles.push(file);
      return false;
    }

    // Check for regular excludes
    return !excludePatterns.some(pattern => pattern.test(file));
  });

  // Warn about sensitive files
  if (sensitiveFiles.length > 0) {
    console.log('::warning::Skipping sensitive files from review (security protection):');
    sensitiveFiles.forEach(file => {
      console.log(`  - ${file}`);
    });
  }

  return filteredFiles;
}

/**
 * Read project-specific guidelines from SAGE.md or custom path
 * Includes path traversal protection and file size limits
 * @async
 * @returns {Promise<string>} Guidelines content or empty string if not found
 */
async function readGuidelines() {
  // Validate guidelines path to prevent directory traversal
  if (CONFIG.guidelinesPath.includes('..') || path.isAbsolute(CONFIG.guidelinesPath)) {
    console.log('::warning::Invalid guidelines path (contains ".." or is absolute), skipping');
    return '';
  }

  // Resolve to absolute path and ensure it's within workspace
  const guidelinesPath = path.resolve(CONFIG.workspace, CONFIG.guidelinesPath);
  const workspaceRealPath = fs.realpathSync(CONFIG.workspace);

  // Check if resolved path is within workspace (prevent directory traversal)
  if (!guidelinesPath.startsWith(workspaceRealPath)) {
    console.log('::warning::Guidelines path is outside workspace, skipping for security');
    return '';
  }

  if (fs.existsSync(guidelinesPath)) {
    try {
      const guidelines = fs.readFileSync(guidelinesPath, 'utf-8');

      // Sanity check: guidelines should be reasonable size
      if (guidelines.length > 50000) {
        console.log('::warning::Guidelines file too large (>50KB), truncating');
        return guidelines.substring(0, 50000);
      }

      console.log(`[OK] Found guidelines at ${CONFIG.guidelinesPath} (${guidelines.length} chars)`);
      return guidelines;
    } catch (error) {
      console.log(`::warning::Failed to read guidelines: ${error.message}`);
      return '';
    }
  }

  console.log(`[INFO]  No guidelines found at ${CONFIG.guidelinesPath}, using defaults`);
  return '';
}

/**
 * Call LLM API via provider with prompt and configuration
 * @async
 * @param {BaseLLMProvider} provider - LLM provider instance
 * @param {string} diff - Git diff text
 * @param {string[]} files - Array of changed file paths
 * @param {string} guidelines - Project-specific guidelines
 * @returns {Promise<{text: string, usage: Object, model: string}>} LLM response with usage stats
 * @throws {Error} When API call fails after retries
 */
async function callLLM(provider, diff, files, guidelines) {
  console.log('::group::Calling LLM API');

  const systemPrompt = getSystemPrompt();
  const userPrompt = `# Pull Request #${CONFIG.prNumber}\n\n## Repository\n${CONFIG.repository}\n\n## Changed Files\n${files.join('\n')}\n\n## Code Changes\n\`\`\`diff\n${diff}\n\`\`\``;

  try {
    const response = await provider.review(systemPrompt, userPrompt, {
      maxTokens: CONFIG.maxTokens,
      thinkingBudget: CONFIG.thinkingBudget,
      guidelines
    });

    const usage = response.usage;
    console.log('[OK] API call successful');
    console.log(`  Input: ${usage.input_tokens?.toLocaleString()} tokens`);
    console.log(`  Output: ${usage.output_tokens?.toLocaleString()} tokens`);

    if (usage.cache_creation_input_tokens) {
      console.log(`  Cache write: ${usage.cache_creation_input_tokens.toLocaleString()} tokens`);
    }
    if (usage.cache_read_input_tokens) {
      console.log(`  Cache read: ${usage.cache_read_input_tokens.toLocaleString()} tokens`);
    }

    console.log('::endgroup::');
    return response;

  } catch (error) {
    console.log('::endgroup::');
    throw error;
  }
}

/**
 * Get system prompt for code review
 * Defines review priorities, severity levels, and output format
 * @returns {string} System prompt text
 */
function getSystemPrompt() {
  return `You are an expert code reviewer. Your role is to identify issues in pull requests with a focus on security, code quality, and best practices.

## Review Priorities

**CRITICAL Priority:**
- Security vulnerabilities (SQL injection, XSS, command injection, hardcoded secrets, auth bypasses)
- Data privacy issues (sensitive data exposure, logging sensitive data, insecure data storage)
- Compliance violations (inadequate access controls, missing audit logs)

**HIGH Priority:**
- Logic bugs (null derefs, race conditions, resource leaks, off-by-one errors)
- Error handling gaps (uncaught exceptions, silent failures, missing validation)
- Performance issues (N+1 queries, memory leaks, inefficient algorithms)
- API design problems (breaking changes, missing validation, inconsistent interfaces)

**MEDIUM Priority:**
- Code quality (high complexity, code duplication, unclear naming)
- Best practices (missing tests, inadequate logging, poor error messages)
- Maintainability issues (tight coupling, magic numbers, commented-out code)

**LOW Priority:**
- Style suggestions (formatting, naming conventions)
- Documentation gaps (missing docstrings, unclear comments)
- Minor refactoring opportunities

## Output Format

Return a valid JSON array of findings. Each finding must have:
- \`severity\`: "CRITICAL", "HIGH", "MEDIUM", or "LOW"
- \`file\`: relative file path
- \`line\`: line number (integer)
- \`title\`: brief description (max 100 chars)
- \`description\`: detailed explanation with impact
- \`suggestion\`: specific code fix or guidance

Example:
\`\`\`json
[
  {
    "severity": "CRITICAL",
    "file": "src/auth.py",
    "line": 42,
    "title": "SQL injection vulnerability in user query",
    "description": "The query uses string formatting to construct SQL, allowing attackers to inject arbitrary SQL commands. This could lead to data theft or unauthorized access.",
    "suggestion": "Use parameterized queries: cursor.execute('SELECT * FROM users WHERE name = %s', (user_input,))"
  }
]
\`\`\`

## Important Rules

1. **Be specific**: Point to exact lines and provide concrete fixes
2. **Focus on impact**: Explain why the issue matters
3. **Actionable only**: Don't report style issues unless they impact readability significantly
4. **Valid JSON**: Return only valid JSON, no markdown code blocks around it
5. **Empty is OK**: Return \`[]\` if no issues found`;
}

/**
 * Parse findings from LLM response JSON
 * Extracts and validates finding objects from response
 * @param {string} responseText - Raw LLM response text
 * @returns {Array<Object>} Array of validated finding objects
 */
function parseFindings(responseText) {
  console.log('::group::Parsing findings');

  try {
    // Try to find JSON array in response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      console.log('[INFO]  No structured findings found in response');
      console.log('::endgroup::');
      return [];
    }

    const findings = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(findings)) {
      console.log('::warning::Response is not an array');
      console.log('::endgroup::');
      return [];
    }

    // Validate each finding
    const validFindings = findings.filter(f => {
      if (!f.severity || !f.file || !f.line || !f.title) {
        console.log(`::warning::Skipping invalid finding: ${JSON.stringify(f)}`);
        return false;
      }
      return true;
    });

    console.log(`[OK] Parsed ${validFindings.length} valid findings`);
    console.log('::endgroup::');

    return validFindings;

  } catch (error) {
    console.log(`::warning::Failed to parse findings: ${error.message}`);
    console.log('::endgroup::');
    return [];
  }
}

/**
 * Filter findings by severity threshold
 * @param {Array<Object>} findings - Array of finding objects
 * @returns {Array<Object>} Filtered findings meeting severity threshold
 */
function filterBySeverity(findings) {
  const threshold = SEVERITY_LEVELS[CONFIG.severityThreshold];

  return findings.filter(f => {
    const severity = SEVERITY_LEVELS[f.severity] || 0;
    return severity >= threshold;
  });
}

/**
 * Count findings by severity
 */
function countBySeverity(findings) {
  return {
    CRITICAL: findings.filter(f => f.severity === 'CRITICAL').length,
    HIGH: findings.filter(f => f.severity === 'HIGH').length,
    MEDIUM: findings.filter(f => f.severity === 'MEDIUM').length,
    LOW: findings.filter(f => f.severity === 'LOW').length
  };
}

/**
 * Get pricing for a specific model
 * Supports Anthropic, OpenAI, and Google models with fallback logic
 * @param {string} modelName - Name of the LLM model
 * @returns {Object} Pricing object with input/output/cache rates per million tokens
 */
function getModelPricing(modelName) {
  // Anthropic pricing table (per million tokens)
  const ANTHROPIC_PRICING = {
    'claude-sonnet-4-5-20250929': {
      input: 3.00,
      output: 15.00,
      cache_write: 6.00,
      cache_read: 0.30
    },
    'claude-opus-4-5-20251101': {
      input: 15.00,
      output: 75.00,
      cache_write: 30.00,
      cache_read: 1.50
    },
    'claude-haiku-4-5-20250101': {
      input: 0.80,
      output: 4.00,
      cache_write: 1.60,
      cache_read: 0.08
    },
    'claude-3-5-sonnet-20241022': {
      input: 3.00,
      output: 15.00,
      cache_write: 6.00,
      cache_read: 0.30
    },
    'claude-3-5-haiku-20241022': {
      input: 0.80,
      output: 4.00,
      cache_write: 1.60,
      cache_read: 0.08
    }
  };

  // OpenAI pricing table (per million tokens)
  const OPENAI_PRICING = {
    'gpt-4-turbo-preview': {
      input: 10.00,
      output: 30.00
    },
    'gpt-4-turbo': {
      input: 10.00,
      output: 30.00
    },
    'gpt-4': {
      input: 30.00,
      output: 60.00
    },
    'gpt-3.5-turbo': {
      input: 0.50,
      output: 1.50
    }
  };

  // Google Gemini pricing table (per million tokens)
  const GOOGLE_PRICING = {
    'gemini-1.5-pro': {
      input: 3.50,
      output: 10.50
    },
    'gemini-1.5-flash': {
      input: 0.35,
      output: 1.05
    },
    'gemini-pro': {
      input: 0.50,
      output: 1.50
    }
  };

  // Normalize model name (some responses include version suffix)
  const normalizedName = modelName.split(':')[0];

  // Check Anthropic models
  if (ANTHROPIC_PRICING[normalizedName]) {
    return ANTHROPIC_PRICING[normalizedName];
  }

  // Check OpenAI models
  if (OPENAI_PRICING[normalizedName]) {
    return OPENAI_PRICING[normalizedName];
  }

  // Check Google models
  if (GOOGLE_PRICING[normalizedName]) {
    return GOOGLE_PRICING[normalizedName];
  }

  // Fallback: try to infer from model family
  if (normalizedName.includes('claude') || normalizedName.includes('opus') || normalizedName.includes('sonnet') || normalizedName.includes('haiku')) {
    if (normalizedName.includes('opus')) {
      console.log(`::warning::Unknown Opus model ${modelName}, using Opus 4.5 pricing`);
      return ANTHROPIC_PRICING['claude-opus-4-5-20251101'];
    } else if (normalizedName.includes('haiku')) {
      console.log(`::warning::Unknown Haiku model ${modelName}, using Haiku 4.5 pricing`);
      return ANTHROPIC_PRICING['claude-haiku-4-5-20250101'];
    } else {
      console.log(`::warning::Unknown Sonnet model ${modelName}, using Sonnet 4.5 pricing`);
      return ANTHROPIC_PRICING['claude-sonnet-4-5-20250929'];
    }
  } else if (normalizedName.includes('gpt')) {
    if (normalizedName.includes('gpt-4-turbo')) {
      console.log(`::warning::Unknown GPT-4 Turbo model ${modelName}, using GPT-4 Turbo pricing`);
      return OPENAI_PRICING['gpt-4-turbo'];
    } else if (normalizedName.includes('gpt-4')) {
      console.log(`::warning::Unknown GPT-4 model ${modelName}, using GPT-4 pricing`);
      return OPENAI_PRICING['gpt-4'];
    } else {
      console.log(`::warning::Unknown GPT model ${modelName}, using GPT-3.5 Turbo pricing`);
      return OPENAI_PRICING['gpt-3.5-turbo'];
    }
  } else if (normalizedName.includes('gemini')) {
    if (normalizedName.includes('flash')) {
      console.log(`::warning::Unknown Gemini Flash model ${modelName}, using Gemini 1.5 Flash pricing`);
      return GOOGLE_PRICING['gemini-1.5-flash'];
    } else {
      console.log(`::warning::Unknown Gemini model ${modelName}, using Gemini 1.5 Pro pricing`);
      return GOOGLE_PRICING['gemini-1.5-pro'];
    }
  }

  // Unknown model - use Claude Sonnet as safe default
  console.log(`::warning::Unknown model ${modelName}, using Claude Sonnet 4.5 pricing as fallback`);
  return ANTHROPIC_PRICING['claude-sonnet-4-5-20250929'];
}

/**
 * Calculate cost based on token usage and model pricing
 * @param {Object} usage - Token usage object with input_tokens, output_tokens, cache tokens
 * @param {string} modelName - Name of the model used
 * @returns {number} Total cost in USD
 */
function calculateCost(usage, modelName) {
  const prices = getModelPricing(modelName);

  let cost = 0;

  // Input tokens (per million)
  cost += (usage.input_tokens || 0) * (prices.input / 1_000_000);

  // Output tokens (includes thinking)
  cost += (usage.output_tokens || 0) * (prices.output / 1_000_000);

  // Cache writes (Anthropic only)
  if (usage.cache_creation_input_tokens && prices.cache_write) {
    cost += usage.cache_creation_input_tokens * (prices.cache_write / 1_000_000);
  }

  // Cache reads (Anthropic only)
  if (usage.cache_read_input_tokens && prices.cache_read) {
    cost += usage.cache_read_input_tokens * (prices.cache_read / 1_000_000);
  }

  return cost;
}

/**
 * Print findings to console (dry-run mode)
 */
function printFindings(findings, usage, cost, model) {
  const counts = countBySeverity(findings);

  // ANSI color codes
  const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
  };

  const severityColors = {
    CRITICAL: colors.red,
    HIGH: colors.yellow,
    MEDIUM: colors.blue,
    LOW: colors.gray
  };

  const severityIcons = {
    CRITICAL: '🚨',
    HIGH: '⚠️ ',
    MEDIUM: '💡',
    LOW: 'ℹ️ '
  };

  // Determine merge status
  const critical = findings.filter(f => f.severity === 'CRITICAL');
  const high = findings.filter(f => f.severity === 'HIGH');
  const readyToMerge = critical.length === 0 && high.length === 0;
  const statusEmoji = readyToMerge ? '✅' : '⚠️ ';
  const statusText = readyToMerge ? 'READY TO MERGE' : 'REVIEW REQUIRED';
  const statusColor = readyToMerge ? colors.green : colors.yellow;

  // Header
  console.log('');
  console.log(colors.bold + colors.cyan + '╔═══════════════════════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.bold + colors.cyan + '║' + colors.reset + colors.bold + '                             SAGE CODE REVIEW RESULTS                          ' + colors.cyan + '║' + colors.reset);
  console.log(colors.bold + colors.cyan + '╚═══════════════════════════════════════════════════════════════════════════════╝' + colors.reset);
  console.log('');
  console.log(statusColor + colors.bold + `  ${statusEmoji} ${statusText}` + colors.reset + ` • ${findings.length} issue${findings.length !== 1 ? 's' : ''} found`);
  console.log('');

  // Summary box
  console.log(colors.bold + '📊 SUMMARY' + colors.reset);
  console.log(colors.dim + '─'.repeat(80) + colors.reset);

  if (findings.length === 0) {
    console.log(colors.green + colors.bold + '✓ No issues found!' + colors.reset);
  } else {
    console.log(`   Total Issues: ${colors.bold}${findings.length}${colors.reset}`);
    if (counts.CRITICAL > 0) console.log(`   ${severityIcons.CRITICAL} Critical:  ${colors.red}${colors.bold}${counts.CRITICAL}${colors.reset}`);
    if (counts.HIGH > 0) console.log(`   ${severityIcons.HIGH} High:      ${colors.yellow}${colors.bold}${counts.HIGH}${colors.reset}`);
    if (counts.MEDIUM > 0) console.log(`   ${severityIcons.MEDIUM} Medium:    ${colors.blue}${counts.MEDIUM}${colors.reset}`);
    if (counts.LOW > 0) console.log(`   ${severityIcons.LOW} Low:       ${colors.gray}${counts.LOW}${colors.reset}`);
  }

  console.log('');

  // Determine provider from model name
  let providerName = 'Unknown';
  if (model.includes('claude')) providerName = 'Anthropic Claude';
  else if (model.includes('gpt')) providerName = 'OpenAI';
  else if (model.includes('gemini')) providerName = 'Google Gemini';

  console.log(`   🤖 Provider:  ${providerName}`);
  console.log(`   🔧 Model:     ${model}`);
  console.log(`   💰 Cost:      $${cost.toFixed(4)}`);
  console.log(`   🔢 Tokens:    ${usage.input_tokens?.toLocaleString()} in / ${usage.output_tokens?.toLocaleString()} out`);
  if (usage.cache_creation_input_tokens) {
    console.log(`   📝 Cache Write: ${usage.cache_creation_input_tokens.toLocaleString()} tokens`);
  }
  if (usage.cache_read_input_tokens) {
    const cacheSavings = usage.cache_read_input_tokens * 0.30 / 1_000_000;
    console.log(`   ⚡ Cache Read: ${usage.cache_read_input_tokens.toLocaleString()} tokens (saved $${cacheSavings.toFixed(4)})`);
  }
  console.log('');

  if (findings.length === 0) {
    return;
  }

  // Group by severity
  const bySeverity = {
    CRITICAL: findings.filter(f => f.severity === 'CRITICAL'),
    HIGH: findings.filter(f => f.severity === 'HIGH'),
    MEDIUM: findings.filter(f => f.severity === 'MEDIUM'),
    LOW: findings.filter(f => f.severity === 'LOW')
  };

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;

    const color = severityColors[severity];
    const icon = severityIcons[severity];

    console.log(color + colors.bold + `${icon} ${severity}` + colors.reset + colors.dim + ` (${items.length} issue${items.length > 1 ? 's' : ''})` + colors.reset);
    console.log(colors.dim + '═'.repeat(80) + colors.reset);
    console.log('');

    items.forEach((finding, idx) => {
      // File and line
      console.log(colors.cyan + `  📄 ${finding.file}` + colors.reset + colors.dim + `:${finding.line}` + colors.reset);

      // Title
      console.log(colors.bold + `  ${finding.title}` + colors.reset);
      console.log('');

      // Description
      const descLines = finding.description.split('\n');
      descLines.forEach(line => {
        console.log(`     ${line}`);
      });

      // Suggested fix
      if (finding.suggestion) {
        console.log('');
        console.log(colors.green + '     💡 Suggested fix:' + colors.reset);
        const suggestionLines = finding.suggestion.split('\n');
        suggestionLines.forEach(line => {
          console.log(colors.dim + `        ${line}` + colors.reset);
        });
      }

      // Separator between findings
      if (idx < items.length - 1) {
        console.log('');
        console.log(colors.dim + '  ' + '─'.repeat(78) + colors.reset);
        console.log('');
      }
    });

    console.log('');
  }

  // Footer
  console.log(colors.dim + '═'.repeat(80) + colors.reset);
  console.log(colors.dim + '  Reviewed with ' + model + colors.reset);
  console.log('');
}

/**
 * Post review comments to GitHub PR
 * Groups findings by file and posts as inline comments
 * @async
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Array<Object>} findings - Array of finding objects
 * @throws {Error} When GitHub API calls fail
 */
async function postReviewComments(owner, repo, findings) {
  console.log('::group::Posting review comments');

  try {
    // Get latest commit SHA
    const { data: commits } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: CONFIG.prNumber
    });

    const commitId = CONFIG.headSha || commits[commits.length - 1].sha;

    // Group findings by file
    const byFile = {};
    for (const finding of findings) {
      if (!byFile[finding.file]) byFile[finding.file] = [];
      byFile[finding.file].push(finding);
    }

    // Post review for each file
    let posted = 0;
    for (const [file, fileFindings] of Object.entries(byFile)) {
      const comments = fileFindings.map(f => ({
        path: f.file,
        line: f.line,
        body: formatComment(f)
      }));

      try {
        await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: CONFIG.prNumber,
          commit_id: commitId,
          event: 'COMMENT',
          comments
        });

        posted += comments.length;
        console.log(`[OK] Posted ${comments.length} comments on ${file}`);

      } catch (error) {
        console.log(`::warning::Failed to post comments on ${file}: ${error.message}`);

        // Try posting as regular comments instead
        for (const comment of comments) {
          try {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: CONFIG.prNumber,
              body: `**${comment.path}:${comment.line}**\n\n${comment.body}`
            });
            posted++;
          } catch (fallbackError) {
            console.log(`::warning::Failed fallback comment: ${fallbackError.message}`);
          }
        }
      }
    }

    console.log(`[OK] Posted ${posted}/${findings.length} comments`);
    console.log('::endgroup::');

  } catch (error) {
    console.log('::endgroup::');
    throw new Error(`Failed to post comments: ${error.message}`);
  }
}

/**
 * Format a finding as a comment
 */
function formatComment(finding) {
  const emoji = {
    CRITICAL: '[CRITICAL]',
    HIGH: '[HIGH]',
    MEDIUM: '[MEDIUM]',
    LOW: '[LOW]'
  }[finding.severity] || '[INFO]';

  return `${emoji} **Sage Review** [${finding.severity}]

**${finding.title}**

${finding.description}

${finding.suggestion ? `**Suggested fix:**\n${finding.suggestion}` : ''}

---
*Reviewed with Sage using ${CONFIG.provider}*`;
}

/**
 * Post summary comment
 */
async function postSummaryComment(owner, repo, findings, usage, model) {
  console.log('::group::Posting summary comment');

  const counts = countBySeverity(findings);
  const cost = calculateCost(usage, model);

  const critical = findings.filter(f => f.severity === 'CRITICAL');
  const high = findings.filter(f => f.severity === 'HIGH');
  const medium = findings.filter(f => f.severity === 'MEDIUM');
  const low = findings.filter(f => f.severity === 'LOW');

  // Determine merge status
  const readyToMerge = critical.length === 0 && high.length === 0;
  const statusEmoji = readyToMerge ? '✅' : '⚠️';
  const statusText = readyToMerge ? '**Ready to merge**' : '**Review required**';
  const statusColor = readyToMerge ? '✨' : '🔍';

  // Build polished summary with collapsible sections
  const summary = `# ${statusColor} Sage Code Review

${statusEmoji} ${statusText} • **${findings.length}** issue${findings.length !== 1 ? 's' : ''} found

${readyToMerge ?
'> 🎉 **No critical or high-priority issues detected!** This PR looks good from an automated review perspective.' :
'> ⚠️  **Action required:** This PR has ' + (critical.length > 0 ? `**${critical.length}** critical` : '') + (critical.length > 0 && high.length > 0 ? ' and ' : '') + (high.length > 0 ? `**${high.length}** high-priority` : '') + ' issue' + (critical.length + high.length !== 1 ? 's' : '') + ' that should be addressed.'}

---

## 📊 Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🚨 Critical | ${counts.CRITICAL} | ${counts.CRITICAL > 0 ? '❌ Must fix' : '✅'} |
| ⚠️ High | ${counts.HIGH} | ${counts.HIGH > 0 ? '⚠️ Should fix' : '✅'} |
| 💡 Medium | ${counts.MEDIUM} | ${counts.MEDIUM > 0 ? '📝 Consider' : '✅'} |
| ℹ️ Low | ${counts.LOW} | ${counts.LOW > 0 ? '💬 Optional' : '✅'} |

${critical.length > 0 ? `
## 🚨 Critical Issues

${critical.map((f, i) => `
### ${i + 1}. ${f.title}

**📄 Location:** \`${f.file}:${f.line}\`

${f.description}

${f.suggestion ? `<details>
<summary>💡 <strong>Suggested Fix</strong></summary>

\`\`\`
${f.suggestion}
\`\`\`

</details>` : ''}
`).join('\n---\n')}
` : ''}

${high.length > 0 ? `
<details ${critical.length === 0 ? 'open' : ''}>
<summary><strong>⚠️  High Priority Issues (${high.length})</strong></summary>

${high.map((f, i) => `
#### ${i + 1}. ${f.title}

**📄** \`${f.file}:${f.line}\`

${f.description}

${f.suggestion ? `**💡 Suggested fix:**
\`\`\`
${f.suggestion}
\`\`\`` : ''}
`).join('\n---\n')}

</details>
` : ''}

${medium.length > 0 ? `
<details>
<summary><strong>💡 Medium Priority Issues (${medium.length})</strong></summary>

${medium.map((f, i) => `
#### ${i + 1}. ${f.title}

**📄** \`${f.file}:${f.line}\`

<details>
<summary>Details</summary>

${f.description}

${f.suggestion ? `**Suggested fix:**
\`\`\`
${f.suggestion}
\`\`\`` : ''}

</details>
`).join('\n')}

</details>
` : ''}

${low.length > 0 ? `
<details>
<summary><strong>ℹ️  Low Priority Issues (${low.length})</strong></summary>

${low.map((f, i) => `
<details>
<summary>${i + 1}. ${f.title} <code>${f.file}:${f.line}</code></summary>

${f.description}

${f.suggestion ? `**Suggested fix:**
\`\`\`
${f.suggestion}
\`\`\`` : ''}

</details>
`).join('\n')}

</details>
` : ''}

---

<details>
<summary>📈 <strong>Review Metadata</strong></summary>

| Metric | Value |
|--------|-------|
| 🤖 Provider | ${CONFIG.provider.charAt(0).toUpperCase() + CONFIG.provider.slice(1)} |
| 🔧 Model | \`${model}\` |
| 🔢 Tokens | ${usage.input_tokens?.toLocaleString()} input / ${usage.output_tokens?.toLocaleString()} output |
${usage.cache_read_input_tokens ? `| ⚡ Cache | ${usage.cache_read_input_tokens.toLocaleString()} tokens (${((usage.cache_read_input_tokens / (usage.input_tokens + usage.cache_read_input_tokens)) * 100).toFixed(0)}% cached) |\n` : ''}| 💰 Cost | $${cost.toFixed(4)} |

</details>

---

<sub>🧙‍♂️ Automated review by [**Sage**](https://github.com/nssalian/sage) • Comment \`/sage\` or add label \`sage\` to re-review • Human approval still required</sub>`;

  try {
    // Try to find existing Sage comment and update it
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: CONFIG.prNumber
    });

    const existingComment = comments.find(c => c.body?.includes('🧙‍♂️ Automated review by [**Sage**]'));

    if (existingComment) {
      // Update existing comment
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: summary
      });
      console.log('[OK] Summary updated (comment refreshed)');
    } else {
      // Create new comment
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: CONFIG.prNumber,
        body: summary
      });
      console.log('[OK] Summary posted');
    }

    console.log('::endgroup::');

  } catch (error) {
    console.log('::endgroup::');
    throw new Error(`Failed to post summary: ${error.message}`);
  }
}

/**
 * Post comment when no reviewable files found
 */
async function postNoFilesComment(owner, repo) {
  const body = `🧙‍♂️ **Sage Review Complete**

No reviewable files found in this PR. Only lock files, generated code, or binaries were changed.

*This is an automated review.*`;

  try {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: CONFIG.prNumber,
      body
    });
  } catch (error) {
    console.log(`::warning::Failed to post no-files comment: ${error.message}`);
  }
}

/**
 * Post error comment when review fails
 */
async function postErrorComment(owner, repo, errorMessage) {
  const body = `🧙‍♂️ **Sage Review Failed**

The automated code review encountered an error:

\`\`\`
${errorMessage}
\`\`\`

### Troubleshooting

1. **Check API key**: Verify \`LLM_API_KEY\` secret is set correctly
2. **Check provider**: Ensure provider is supported (${ProviderFactory.getSupportedProviders().join(', ')})
3. **Check workflow logs**: View detailed logs in the Actions tab

If the issue persists, please open an issue on the Sage repository.`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: CONFIG.prNumber,
    body
  });
}

/**
 * Set GitHub Actions outputs for downstream jobs
 * @param {Object} outputs - Key-value pairs of output variables
 */
function setOutputs(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT;

  if (outputFile) {
    const lines = Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    fs.appendFileSync(outputFile, lines + '\n');
  }
}

// Run main function
main();
