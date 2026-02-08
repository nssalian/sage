const GoogleProvider = require('../../scripts/providers/google');

describe('GoogleProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new GoogleProvider('test-key', 'gemini-1.5-pro', 'test-project', 'us-central1');
  });

  test('extends BaseLLMProvider', () => {
    expect(provider.getName()).toBe('Google Gemini');
  });

  test('does not support prompt caching', () => {
    expect(provider.supportsPromptCaching()).toBe(false);
  });

  test('does not support extended thinking', () => {
    expect(provider.supportsExtendedThinking()).toBe(false);
  });

  test('calculates cost for Gemini Pro', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 3.50/1M = 0.0035
    // output: 500 * 10.50/1M = 0.00525
    // total: 0.00875
    expect(cost).toBeCloseTo(0.00875, 5);
  });

  test('calculates cost for Gemini Flash', () => {
    const provider = new GoogleProvider('test-key', 'gemini-1.5-flash', 'test-project');
    const usage = {
      input_tokens: 1000,
      output_tokens: 500
    };

    const cost = provider.calculateCost(usage);

    // input: 1000 * 0.35/1M = 0.00035
    // output: 500 * 1.05/1M = 0.000525
    // total: 0.000875
    expect(cost).toBeCloseTo(0.000875, 6);
  });

  test('stores projectId and location', () => {
    expect(provider.projectId).toBe('test-project');
    expect(provider.location).toBe('us-central1');
  });

  test('uses default location if not provided', () => {
    const provider = new GoogleProvider('test-key', 'gemini-1.5-pro', 'test-project');
    expect(provider.location).toBe('us-central1');
  });
});
