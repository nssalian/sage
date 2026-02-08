const BaseLLMProvider = require('../../scripts/providers/base');

describe('BaseLLMProvider', () => {
  test('cannot be instantiated directly', () => {
    expect(() => {
      new BaseLLMProvider('test-key', 'test-model');
    }).toThrow('BaseLLMProvider is abstract and cannot be instantiated directly');
  });

  test('review method must be implemented', async () => {
    class TestProvider extends BaseLLMProvider {}
    const provider = new TestProvider('test-key', 'test-model');

    await expect(provider.review('system', 'user')).rejects.toThrow(
      'review() must be implemented by provider'
    );
  });

  test('calculateCost method must be implemented', () => {
    class TestProvider extends BaseLLMProvider {}
    const provider = new TestProvider('test-key', 'test-model');

    expect(() => provider.calculateCost({})).toThrow(
      'calculateCost() must be implemented by provider'
    );
  });

  test('getName method must be implemented', () => {
    class TestProvider extends BaseLLMProvider {}
    const provider = new TestProvider('test-key', 'test-model');

    expect(() => provider.getName()).toThrow(
      'getName() must be implemented by provider'
    );
  });

  test('supportsPromptCaching returns false by default', () => {
    class TestProvider extends BaseLLMProvider {}
    const provider = new TestProvider('test-key', 'test-model');

    expect(provider.supportsPromptCaching()).toBe(false);
  });

  test('supportsExtendedThinking returns false by default', () => {
    class TestProvider extends BaseLLMProvider {}
    const provider = new TestProvider('test-key', 'test-model');

    expect(provider.supportsExtendedThinking()).toBe(false);
  });
});
