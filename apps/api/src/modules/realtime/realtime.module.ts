import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { MarketModule } from '../market/market.module.js';
import { UpdownModule } from '../updown/updown.module.js';
import { RealtimeServer } from './realtime.server.js';

@Module({
  imports: [IdentityModule, MarketModule, UpdownModule],
  providers: [RealtimeServer],
})
export class RealtimeModule {}
