/**
 * Google Gemini Provider
 * Supports: Gemini Pro, Gemini Ultra
 */

const { VertexAI } = require('@google-cloud/vertexai');
const BaseLLMProvider = require('./base');

class GoogleProvider extends BaseLLMProvider {
  constructor(apiKey, model = 'gemini-1.5-pro', projectId = '', location = 'us-central1') {
    super(apiKey, model);
    this.projectId = projectId;
    this.location = location;

    // Initialize Vertex AI
    this.vertexAI = new VertexAI({
      project: projectId,
      location: location
    });

    this.generativeModel = this.vertexAI.getGenerativeModel({
      model: this.model
    });
  }

  async review(systemPrompt, userPrompt, options = {}) {
    const {
      maxTokens = 4000,
      retries = 3,
      guidelines = ''
    } = options;

    // Build full prompt with guidelines
    const fullSystemPrompt = guidelines
      ? `${systemPrompt}\n\n# Project Guidelines\n\n${guidelines}`
      : systemPrompt;

    // Gemini combines system and user prompts
    const fullPrompt = `${fullSystemPrompt}\n\n${userPrompt}`;

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const request = {
          contents: [
            {
              role: 'user',
              parts: [{ text: fullPrompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.3
          }
        };

        const response = await this.generativeModel.generateContent(request);
        const result = response.response;

        const text = result.candidates[0].content.parts[0].text;

        // Normalize usage to match our standard format
        const usage = {
          input_tokens: result.usageMetadata?.promptTokenCount || 0,
          output_tokens: result.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: result.usageMetadata?.totalTokenCount || 0
        };

        return {
          text,
          usage,
          model: this.model
        };

      } catch (error) {
        if (attempt === retries) {
          throw new Error(`Google Gemini API failed after ${retries} attempts: ${error.message}`);
        }

        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  getModelPricing(modelName) {
    // Google Gemini pricing table (per million tokens)
    const PRICING_TABLE = {
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

    if (PRICING_TABLE[modelName]) {
      return PRICING_TABLE[modelName];
    }

    // Fallback: try to infer from model family
    if (modelName.includes('flash')) {
      console.log(`::warning::Unknown Gemini Flash model ${modelName}, using Gemini 1.5 Flash pricing`);
      return PRICING_TABLE['gemini-1.5-flash'];
    } else if (modelName.includes('1.5-pro')) {
      console.log(`::warning::Unknown Gemini 1.5 Pro model ${modelName}, using Gemini 1.5 Pro pricing`);
      return PRICING_TABLE['gemini-1.5-pro'];
    } else if (modelName.includes('pro')) {
      console.log(`::warning::Unknown Gemini Pro model ${modelName}, using Gemini Pro pricing`);
      return PRICING_TABLE['gemini-pro'];
    }

    // Unknown model - use Gemini 1.5 Pro as safe default
    console.log(`::warning::Unknown model ${modelName}, using Gemini 1.5 Pro pricing as fallback`);
    return PRICING_TABLE['gemini-1.5-pro'];
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
    return 'Google Gemini';
  }

  supportsPromptCaching() {
    return false; // Gemini doesn't have prompt caching in the same way
  }

  supportsExtendedThinking() {
    return false; // Gemini doesn't have extended thinking feature
  }
}

module.exports = GoogleProvider;
