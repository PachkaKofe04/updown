import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock.js';
import { UserEvents } from './user-events.js';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, UserEvents],
  exports: [Clock, UserEvents],
})
export class CommonModule {}
