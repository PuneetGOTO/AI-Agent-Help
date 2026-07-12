import { Module } from '@nestjs/common';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';
import { ProviderRegistryService } from './provider-registry.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { AnthropicAdapter } from './anthropic.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { BedrockAdapter } from './bedrock.adapter';

@Module({
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    ProviderRegistryService,
    OpenAiCompatibleAdapter,
    AnthropicAdapter,
    GeminiAdapter,
    BedrockAdapter,
  ],
  exports: [ProvidersService, ProviderRegistryService],
})
export class ProvidersModule {}
