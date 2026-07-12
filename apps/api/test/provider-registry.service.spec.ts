import { ProviderType } from '@prisma/client';
import { AnthropicAdapter } from '../src/modules/providers/anthropic.adapter';
import { BedrockAdapter } from '../src/modules/providers/bedrock.adapter';
import { GeminiAdapter } from '../src/modules/providers/gemini.adapter';
import { OpenAiCompatibleAdapter } from '../src/modules/providers/openai-compatible.adapter';
import { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';

describe('ProviderRegistryService', () => {
  it('registers a real adapter for every declared provider type', () => {
    const openAi = new OpenAiCompatibleAdapter();
    const anthropic = new AnthropicAdapter();
    const gemini = new GeminiAdapter();
    const bedrock = new BedrockAdapter();
    const registry = new ProviderRegistryService(openAi, anthropic, gemini, bedrock);

    expect(registry.get(ProviderType.OPENAI)).toBe(openAi);
    expect(registry.get(ProviderType.AZURE_OPENAI)).toBe(openAi);
    expect(registry.get(ProviderType.OPENAI_COMPATIBLE)).toBe(openAi);
    expect(registry.get(ProviderType.OLLAMA)).toBe(openAi);
    expect(registry.get(ProviderType.ANTHROPIC)).toBe(anthropic);
    expect(registry.get(ProviderType.GOOGLE_GEMINI)).toBe(gemini);
    expect(registry.get(ProviderType.AWS_BEDROCK)).toBe(bedrock);
  });

  it('keeps provider/model capability differences explicit', () => {
    const registry = new ProviderRegistryService(
      new OpenAiCompatibleAdapter(),
      new AnthropicAdapter(),
      new GeminiAdapter(),
      new BedrockAdapter(),
    );

    expect(registry.capabilities(ProviderType.ANTHROPIC, 'claude-sonnet-4')).toEqual(
      expect.objectContaining({ chat: true, embeddings: false, toolCalling: true }),
    );
    expect(registry.capabilities(ProviderType.GOOGLE_GEMINI, 'text-embedding-004')).toEqual(
      expect.objectContaining({ chat: false, embeddings: true, toolCalling: false }),
    );
    expect(registry.capabilities(ProviderType.AWS_BEDROCK, 'amazon.titan-embed-text-v2:0')).toEqual(
      expect.objectContaining({ chat: false, embeddings: true, streaming: false }),
    );
  });
});
