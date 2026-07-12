import { BadRequestException } from '@nestjs/common';

export function assertBcryptPasswordLength(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new BadRequestException('Password must not exceed 72 UTF-8 bytes');
  }
}
