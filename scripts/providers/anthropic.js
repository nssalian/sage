/**
 * Anthropic Claude Provider
 * Supports: Claude Sonnet, Claude Opus, Claude Haiku
 */

const Anthropic = require('@anthropic-ai/sdk');
const BaseLLMProvider = require('./base');

class AnthropicProvider extends BaseLLMProvider {
  constructor(apiKey, model = 'claude-sonnet-4-5-20250929') {
    super(apiKey, model);
    this.client = new Anthropic({ apiKey });
  }

  async review(systemPrompt, userPrompt, options = {}) {
    const {
      maxTokens = 4000,
      thinkingBudget = 10000,
      guidelines = '',
      retries = 3
    } = options;

    // Build messages with prompt caching
    const messages = [
      {
        role: 'user',
        content: [
          // CACHED: System instructions
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          },
          // CACHED: Project guidelines
          {
            type: 'text',
            text: guidelines ? `# Project Guidelines\n\n${guidelines}` : '# No Project-Specific Guidelines',
            cache_control: { type: 'ephemeral' }
          },
          // NOT CACHED: Current diff
          {
            type: 'text',
            text: userPrompt
          }
        ]
      }
    ];

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          thinking: {
            type: 'enabled',
            budget_tokens: thinkingBudget
          },
          messages
        });

        // Extract text from response
        const text = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        return {
          text,
          usage: response.usage,
          model: response.model
        };

      } catch (error) {
        if (attempt === retries) {
          throw new Error(`Anthropic API failed after ${retries} attempts: ${error.message}`);
        }

        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  getModelPricing(modelName) {
    // Anthropic pricing table (per million tokens)
    const PRICING_TABLE = {
      // Claude 4.5 models
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
      // Claude 3.5 models (legacy)
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

    // Normalize model name (some responses include version suffix)
    const normalizedName = modelName.split(':')[0];

    if (PRICING_TABLE[normalizedName]) {
      return PRICING_TABLE[normalizedName];
    }

    // Fallback: try to infer from model family
    if (normalizedName.includes('opus')) {
      console.log(`::warning::Unknown Opus model ${modelName}, using Opus 4.5 pricing`);
      return PRICING_TABLE['claude-opus-4-5-20251101'];
    } else if (normalizedName.includes('haiku')) {
      console.log(`::warning::Unknown Haiku model ${modelName}, using Haiku 4.5 pricing`);
      return PRICING_TABLE['claude-haiku-4-5-20250101'];
    } else if (normalizedName.includes('sonnet')) {
      console.log(`::warning::Unknown Sonnet model ${modelName}, using Sonnet 4.5 pricing`);
      return PRICING_TABLE['claude-sonnet-4-5-20250929'];
    }

    // Unknown model - use Sonnet as safe default
    console.log(`::warning::Unknown model ${modelName}, using Sonnet 4.5 pricing as fallback`);
    return PRICING_TABLE['claude-sonnet-4-5-20250929'];
  }

  calculateCost(usage, modelName) {
    const model = modelName || this.model;
    const prices = this.getModelPricing(model);

    let cost = 0;

    // Input tokens (per million)
    cost += (usage.input_tokens || 0) * (prices.input / 1_000_000);

    // Output tokens (includes thinking)
    cost += (usage.output_tokens || 0) * (prices.output / 1_000_000);

    // Cache writes (2x input price)
    if (usage.cache_creation_input_tokens) {
      cost += usage.cache_creation_input_tokens * (prices.cache_write / 1_000_000);
    }

    // Cache reads (10% of input price)
    if (usage.cache_read_input_tokens) {
      cost += usage.cache_read_input_tokens * (prices.cache_read / 1_000_000);
    }

    return cost;
  }

  getName() {
    return 'Anthropic Claude';
  }

  supportsPromptCaching() {
    return true;
  }

  supportsExtendedThinking() {
    return true;
  }
}

module.exports = AnthropicProvider;
