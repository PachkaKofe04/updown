import { Injectable } from '@nestjs/common';
import type { PredictionDto, StatsDto } from '@updown/contracts';
import { EventEmitter } from 'node:events';

export interface PredictionEvent {
  userId: string;
  kind: 'prediction.opened' | 'prediction.settled';
  prediction: PredictionDto;
  balance: number;
  walletVersion: number;
  stats: StatsDto | null;
}

// Шина событий пользователя внутри процесса: модули игры публикуют, realtime доставляет в сокеты.
@Injectable()
export class UserEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emitPrediction(event: PredictionEvent): void {
    this.emitter.emit('prediction', event);
  }

  onPrediction(listener: (event: PredictionEvent) => void): () => void {
    this.emitter.on('prediction', listener);
    return () => this.emitter.off('prediction', listener);
  }

  /** Сессия отозвана (выход, смена аккаунта): открытые по ней сокеты закрываются. */
  emitSessionRevoked(sessionId: string): void {
    this.emitter.emit('session.revoked', sessionId);
  }

  onSessionRevoked(listener: (sessionId: string) => void): () => void {
    this.emitter.on('session.revoked', listener);
    return () => this.emitter.off('session.revoked', listener);
  }
}
