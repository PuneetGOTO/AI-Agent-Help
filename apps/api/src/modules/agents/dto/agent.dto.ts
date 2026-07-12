import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AgentStatus, MemoryMode } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AgentConfigDto {
  @ApiProperty()
  @IsUUID()
  providerConnectionId!: string;

  @ApiProperty({ example: 'gpt-4.1-mini' })
  @IsString()
  @Length(1, 200)
  model!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100_000)
  systemPrompt!: string;

  @ApiPropertyOptional({ default: 0.3 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ default: 2048 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(128_000)
  maxTokens?: number;

  @ApiPropertyOptional({ default: 60000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(300_000)
  timeoutMs?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  retryCount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  streamEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) =>
    assertJsonSize(value, 512_000, 'structuredOutputSchema'),
  )
  structuredOutputSchema?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: MemoryMode, default: MemoryMode.SHORT_TERM })
  @IsOptional()
  @IsEnum(MemoryMode)
  memoryMode?: MemoryMode;

  @ApiPropertyOptional({ description: 'Maximum USD cost for a single run' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  budgetUsd?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsUUID(undefined, { each: true })
  toolIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsUUID(undefined, { each: true })
  knowledgeBaseIds?: string[];
}

function assertJsonSize(value: unknown, maxBytes: number, name: string): unknown {
  if (value !== undefined && Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
    throw new Error(`${name} exceeds the size limit`);
  }
  return value;
}

export class CreateAgentDto extends AgentConfigDto {
  @ApiProperty()
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class UpdateAgentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: AgentStatus })
  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;
}

export class CreateAgentVersionDto extends PartialType(AgentConfigDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class PublishAgentDto {
  @ApiPropertyOptional({ description: 'Defaults to the latest version' })
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class RollbackAgentDto {
  @ApiProperty()
  @IsUUID()
  versionId!: string;
}

export class ChatDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100_000)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}
