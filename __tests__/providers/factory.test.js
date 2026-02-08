const ProviderFactory = require('../../scripts/providers/factory');
const AnthropicProvider = require('../../scripts/providers/anthropic');
const OpenAIProvider = require('../../scripts/providers/openai');
const GoogleProvider = require('../../scripts/providers/google');

describe('ProviderFactory', () => {
  describe('createProvider', () => {
    test('creates Anthropic provider', () => {
      const provider = ProviderFactory.createProvider('anthropic', 'test-key', 'test-model');
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    test('creates OpenAI provider', () => {
      const provider = ProviderFactory.createProvider('openai', 'test-key', 'test-model');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    test('creates Google provider with projectId', () => {
      const provider = ProviderFactory.createProvider('google', 'test-key', 'test-model', {
        projectId: 'test-project'
      });
      expect(provider).toBeInstanceOf(GoogleProvider);
    });

    test('throws error for unknown provider', () => {
      expect(() => {
        ProviderFactory.createProvider('unknown', 'test-key', 'test-model');
      }).toThrow('Unknown provider: unknown');
    });

    test('throws error when API key is missing', () => {
      expect(() => {
        ProviderFactory.createProvider('anthropic', '', 'test-model');
      }).toThrow('API key is required');
    });

    test('throws error for Google provider without projectId', () => {
      expect(() => {
        ProviderFactory.createProvider('google', 'test-key', 'test-model');
      }).toThrow('Google provider requires projectId option');
    });
  });

  describe('getSupportedProviders', () => {
    test('returns array of supported providers', () => {
      const providers = ProviderFactory.getSupportedProviders();
      expect(providers).toEqual(['anthropic', 'openai', 'google']);
    });
  });

  describe('getDefaultModels', () => {
    test('returns default models for each provider', () => {
      const models = ProviderFactory.getDefaultModels();
      expect(models).toHaveProperty('anthropic');
      expect(models).toHaveProperty('openai');
      expect(models).toHaveProperty('google');
    });
  });
});
