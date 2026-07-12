import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProviderCredentialsDto {
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  organization?: string;

  @ApiPropertyOptional({ example: '2024-10-21' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  azureApiVersion?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  accessKeyId?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  secretAccessKey?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  sessionToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)+-\d+$/)
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  projectId?: string;

  @ApiPropertyOptional({ example: 'us-central1' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/)
  location?: string;
}

export class CreateProviderDto {
  @ApiProperty()
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ enum: ProviderType })
  @IsEnum(ProviderType)
  type!: ProviderType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  baseUrl?: string;

  @ApiProperty({ type: ProviderCredentialsDto, writeOnly: true })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProviderCredentialsDto)
  credentials!: ProviderCredentialsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 256_000, 'config'))
  config?: Record<string, unknown>;
}

export class UpdateProviderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  baseUrl?: string;

  @ApiPropertyOptional({ type: ProviderCredentialsDto, writeOnly: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProviderCredentialsDto)
  credentials?: ProviderCredentialsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @Transform(({ value }: { value: unknown }) => assertJsonSize(value, 256_000, 'config'))
  config?: Record<string, unknown>;

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
