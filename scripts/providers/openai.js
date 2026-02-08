/**
 * OpenAI Provider
 * Supports: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
 */

const OpenAI = require('openai');
const BaseLLMProvider = require('./base');

class OpenAIProvider extends BaseLLMProvider {
  constructor(apiKey, model = 'gpt-4-turbo-preview') {
    super(apiKey, model);
    this.client = new OpenAI({ apiKey });
  }

  async review(systemPrompt, userPrompt, options = {}) {
    const {
      maxTokens = 4000,
      retries = 3,
      guidelines = ''
    } = options;

    // Build system prompt with guidelines
    const fullSystemPrompt = guidelines
      ? `${systemPrompt}\n\n# Project Guidelines\n\n${guidelines}`
      : systemPrompt;

    // OpenAI uses system/user message format
    const messages = [
      { role: 'system', content: fullSystemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3, // Lower temperature for more consistent code reviews
          response_format: { type: 'text' }
        });

        const text = response.choices[0].message.content;

        // Normalize usage to match our standard format
        const usage = {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        };

        return {
          text,
          usage,
          model: response.model
        };

      } catch (error) {
        if (attempt === retries) {
          throw new Error(`OpenAI API failed after ${retries} attempts: ${error.message}`);
        }

        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  getModelPricing(modelName) {
    // OpenAI pricing table (per million tokens)
    const PRICING_TABLE = {
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

    if (PRICING_TABLE[modelName]) {
      return PRICING_TABLE[modelName];
    }

    // Fallback: try to infer from model family
    if (modelName.includes('gpt-4-turbo')) {
      console.log(`::warning::Unknown GPT-4 Turbo model ${modelName}, using GPT-4 Turbo pricing`);
      return PRICING_TABLE['gpt-4-turbo'];
    } else if (modelName.includes('gpt-4')) {
      console.log(`::warning::Unknown GPT-4 model ${modelName}, using GPT-4 pricing`);
      return PRICING_TABLE['gpt-4'];
    } else if (modelName.includes('gpt-3.5')) {
      console.log(`::warning::Unknown GPT-3.5 model ${modelName}, using GPT-3.5 Turbo pricing`);
      return PRICING_TABLE['gpt-3.5-turbo'];
    }

    // Unknown model - use GPT-4 Turbo as safe default
    console.log(`::warning::Unknown model ${modelName}, using GPT-4 Turbo pricing as fallback`);
    return PRICING_TABLE['gpt-4-turbo'];
  }

  calculateCost(usage, modelName) {
    const model = modelName || this.model;
    const prices = this.getModelPricing(model);

    let cost = 0;
    cost += (usage.input_tokens || 0) * (prices.input / 1_000_000);
    cost += (usage.output_tokens || 0) * (prices.output / 1_000_000);

    return cost;
  }

  getName() {
    return 'OpenAI';
  }

  supportsPromptCaching() {
    return false; // OpenAI doesn't have prompt caching yet
  }

  supportsExtendedThinking() {
    return false; // OpenAI doesn't have extended thinking feature
  }
}

module.exports = OpenAIProvider;
