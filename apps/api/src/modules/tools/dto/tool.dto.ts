import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToolType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateToolDto {
  @ApiProperty()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 500)
  description!: string;

  @ApiProperty({ enum: ToolType })
  @IsEnum(ToolType)
  type!: ToolType;

  @ApiProperty({ description: 'JSON Schema for tool arguments' })
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 512_000, 'inputSchema'))
  inputSchema!: Record<string, unknown>;

  @ApiProperty({ description: 'Type-specific execution configuration' })
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 256_000, 'config'))
  config!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  retryCount?: number;
}

export class UpdateToolDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 512_000, 'inputSchema'))
  inputSchema?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 256_000, 'config'))
  config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  retryCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

function assertJsonSize(value: unknown, maxBytes: number, name: string): unknown {
  if (value !== undefined && Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
    throw new Error(`${name} exceeds the size limit`);
  }
  return value;
}
