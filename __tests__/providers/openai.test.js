const OpenAIProvider = require('../../scripts/providers/openai');

describe('OpenAIProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-key', 'gpt-4-turbo-preview');
  });

  test('extends BaseLLMProvider', () => {
    expect(provider.getName()).toBe('OpenAI');
  });

  test('does not support prompt caching', () => {
    expect(provider.supportsPromptCaching()).toBe(false);
  });

  test('does not support extended thinking', () => {
    expect(provider.supportsExtendedThinking()).toBe(false);
  });

  test('calculates cost for GPT-4 Turbo', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 10.00/1M = 0.01
    // output: 500 * 30.00/1M = 0.015
    // total: 0.025
    expect(cost).toBeCloseTo(0.025, 3);
  });

  test('calculates cost for GPT-4', () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4');
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 30.00/1M = 0.03
    // output: 500 * 60.00/1M = 0.03
    // total: 0.06
    expect(cost).toBeCloseTo(0.06, 2);
  });

  test('calculates cost for GPT-3.5', () => {
    const provider = new OpenAIProvider('test-key', 'gpt-3.5-turbo');
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 0.50/1M = 0.0005
    // output: 500 * 1.50/1M = 0.00075
    // total: 0.00125
    expect(cost).toBeCloseTo(0.00125, 5);
  });
});
