/**
 * Base LLM Provider Interface
 *
 * All LLM providers must implement this interface to work with Sage
 */

class BaseLLMProvider {
  constructor(apiKey, model) {
    if (this.constructor === BaseLLMProvider) {
      throw new Error(
        "BaseLLMProvider is abstract and cannot be instantiated directly",
      );
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Call the LLM API to review code
   * @param {string} systemPrompt - The system instructions
   * @param {string} userPrompt - The user content (code diff)
   * @param {Object} options - Provider-specific options
   * @returns {Promise<Object>} Response with { text, usage, model }
   */
  async review(systemPrompt, userPrompt, options = {}) {
    void systemPrompt;
    void userPrompt;
    void options;
    throw new Error("review() must be implemented by provider");
  }

  /**
   * Calculate cost based on token usage
   * @param {Object} usage - Token usage object
   * @param {string} modelName - Optional model name for dynamic pricing
   * @returns {number} Cost in USD
   */
  calculateCost(usage, modelName) {
    void usage;
    void modelName;
    throw new Error("calculateCost() must be implemented by provider");
  }

  /**
   * Get provider name
   * @returns {string}
   */
  getName() {
    throw new Error("getName() must be implemented by provider");
  }

  /**
   * Check if provider supports caching
   * @returns {boolean}
   */
  supportsPromptCaching() {
    return false;
  }

  /**
   * Check if provider supports extended thinking
   * @returns {boolean}
   */
  supportsExtendedThinking() {
    return false;
  }
}

module.exports = BaseLLMProvider;
