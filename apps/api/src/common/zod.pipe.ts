import { type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { DomainError } from './errors.js';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new DomainError('validation_failed');
    return parsed.data;
  }
}
