/**
 * LLM Provider Factory
 * Creates the appropriate provider based on configuration
 */

const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const GoogleProvider = require('./google');

class ProviderFactory {
  /**
   * Create an LLM provider instance
   * @param {string} providerName - 'anthropic', 'openai', or 'google'
   * @param {string} apiKey - API key for the provider
   * @param {string} model - Model name
   * @param {Object} options - Provider-specific options
   * @returns {BaseLLMProvider}
   */
  static createProvider(providerName, apiKey, model, options = {}) {
    if (!apiKey) {
      throw new Error(`API key is required for provider: ${providerName}`);
    }

    const provider = providerName.toLowerCase();

    switch (provider) {
    case 'anthropic':
    case 'claude':
      return new AnthropicProvider(apiKey, model || 'claude-sonnet-4-5-20250929');

    case 'openai':
    case 'gpt':
      return new OpenAIProvider(apiKey, model || 'gpt-4-turbo-preview');

    case 'google':
    case 'gemini':
      if (!options.projectId) {
        throw new Error('Google provider requires projectId option');
      }
      return new GoogleProvider(
        apiKey,
        model || 'gemini-1.5-pro',
        options.projectId,
        options.location || 'us-central1'
      );

    default:
      throw new Error(
        `Unknown provider: ${providerName}. Supported: anthropic, openai, google`
      );
    }
  }

  /**
   * Get list of supported providers
   * @returns {Array<string>}
   */
  static getSupportedProviders() {
    return ['anthropic', 'openai', 'google'];
  }

  /**
   * Get default models for each provider
   * @returns {Object}
   */
  static getDefaultModels() {
    return {
      anthropic: 'claude-sonnet-4-5-20250929',
      openai: 'gpt-4-turbo-preview',
      google: 'gemini-1.5-pro'
    };
  }
}

module.exports = ProviderFactory;
