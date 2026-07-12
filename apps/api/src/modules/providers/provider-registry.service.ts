import { Injectable } from '@nestjs/common';
import type { ProviderCapabilities, ProviderType } from '@agent-platform/shared';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';
import type { ProviderAdapter } from './provider.types';
import { UnsupportedAdapter } from './unsupported.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { BedrockAdapter } from './bedrock.adapter';

const CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
  OPENAI: fullCapabilities(),
  AZURE_OPENAI: fullCapabilities(),
  OPENAI_COMPATIBLE: fullCapabilities(),
  OLLAMA: { ...fullCapabilities(), modelListing: true },
  ANTHROPIC: { ...fullCapabilities(), embeddings: false },
  GOOGLE_GEMINI: fullCapabilities(),
  AWS_BEDROCK: { ...fullCapabilities(), structuredOutput: false, vision: false },
};

@Injectable()
export class ProviderRegistryService {
  private readonly adapters = new Map<ProviderType, ProviderAdapter>();

  constructor(
    openAiCompatible: OpenAiCompatibleAdapter,
    anthropic: AnthropicAdapter,
    gemini: GeminiAdapter,
    bedrock: BedrockAdapter,
  ) {
    for (const type of ['OPENAI', 'AZURE_OPENAI', 'OPENAI_COMPATIBLE', 'OLLAMA'] as const) {
      this.adapters.set(type, openAiCompatible);
    }
    this.adapters.set('ANTHROPIC', anthropic);
    this.adapters.set('GOOGLE_GEMINI', gemini);
    this.adapters.set('AWS_BEDROCK', bedrock);
  }

  get(type: ProviderType): ProviderAdapter {
    return this.adapters.get(type) ?? new UnsupportedAdapter(emptyCapabilities());
  }

  capabilities(type: ProviderType, model?: string): ProviderCapabilities {
    const detected = this.get(type).capabilityDetection(model);
    return { ...CAPABILITIES[type], ...detected };
  }
}

function fullCapabilities(): ProviderCapabilities {
  return {
    chat: true,
    streaming: true,
    embeddings: true,
    toolCalling: true,
    structuredOutput: true,
    vision: true,
    modelListing: true,
  };
}

function emptyCapabilities(): ProviderCapabilities {
  return {
    chat: false,
    streaming: false,
    embeddings: false,
    toolCalling: false,
    structuredOutput: false,
    vision: false,
    modelListing: false,
  };
}
