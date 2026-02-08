const AnthropicProvider = require('../../scripts/providers/anthropic');

describe('AnthropicProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new AnthropicProvider('test-key', 'claude-sonnet-4-5-20250929');
  });

  test('extends BaseLLMProvider', () => {
    expect(provider.getName()).toBe('Anthropic Claude');
  });

  test('supports prompt caching', () => {
    expect(provider.supportsPromptCaching()).toBe(true);
  });

  test('supports extended thinking', () => {
    expect(provider.supportsExtendedThinking()).toBe(true);
  });

  test('calculates cost correctly', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 3.00/1M = 0.003
    // output: 500 * 15.00/1M = 0.0075
    // cache_write: 200 * 6.00/1M = 0.0012
    // cache_read: 100 * 0.30/1M = 0.00003
    // total: 0.01173
    expect(cost).toBeCloseTo(0.01173, 5);
  });

  test('calculates cost without caching', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 3.00/1M = 0.003
    // output: 500 * 15.00/1M = 0.0075
    // total: 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });
});
