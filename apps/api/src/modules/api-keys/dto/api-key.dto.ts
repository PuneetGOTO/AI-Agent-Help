import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty()
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({ enum: ApiKeyType, default: ApiKeyType.PLATFORM })
  @IsOptional()
  @IsEnum(ApiKeyType)
  type?: ApiKeyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  scopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}
