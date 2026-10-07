import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { ComebackClaimResponse, ComebackStatus } from '@updown/contracts';
import type { AuthContext } from '../identity/identity.service.js';
import { Auth, SessionGuard } from '../identity/session.guard.js';
import { ComebackService } from './comeback.service.js';

@Controller('v1/bonus')
@UseGuards(SessionGuard)
export class BonusController {
  constructor(private readonly comeback: ComebackService) {}

  @Get('comeback')
  status(@Auth() auth: AuthContext): Promise<ComebackStatus> {
    return this.comeback.status(auth.userId);
  }

  @Post('comeback')
  @HttpCode(200)
  claim(@Auth() auth: AuthContext): Promise<ComebackClaimResponse> {
    return this.comeback.claim(auth.userId);
  }
}
