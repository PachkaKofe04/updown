import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@updown/contracts';
import type { Response } from 'express';

// Тексты ошибок для человека: спокойно и понятно, без технических кодов.
const MESSAGES: Record<ErrorCode, string> = {
  validation_failed: 'Проверьте введённые данные.',
  unauthorized: 'Сессия не найдена. Нажмите "Играть", чтобы начать.',
  not_found: 'Не найдено.',
  insufficient_funds: 'Недостаточно Coins для этого прогноза.',
  stake_too_small: 'Сумма прогноза меньше минимальной.',
  too_many_open_predictions: 'Одновременно можно держать не больше 10 прогнозов.',
  rate_limited: 'Слишком часто. Подождите секунду.',
  market_closed: 'Рынок по этому активу сейчас закрыт.',
  stale_price: 'Не удалось получить свежую котировку. Новый прогноз временно недоступен.',
  duration_not_allowed: 'Этот интервал недоступен для выбранного актива.',
  asset_unavailable: 'Актив сейчас недоступен.',
  idempotency_conflict: 'Этот запрос уже был отправлен с другими параметрами.',
  nickname_invalid: 'Выберите другой ник.',
  nickname_taken: 'Этот ник уже занят.',
  code_invalid: 'Код не подошёл или устарел. Проверьте цифры или запросите новый.',
  code_attempts_exceeded: 'Слишком много попыток. Запросите новый код.',
  email_in_use: 'Эта почта уже привязана к другому аккаунту.',
  account_not_found: 'Аккаунт с этой почтой не найден.',
  already_registered: 'Прогресс уже сохранён на почту.',
  comeback_unavailable: 'Бонус сейчас недоступен.',
  maintenance: 'Короткое обслуживание. Новые прогнозы откроются через минуту.',
  internal: 'Что-то пошло не так. Попробуйте ещё раз.',
};

const STATUS: Record<ErrorCode, number> = {
  validation_failed: HttpStatus.BAD_REQUEST,
  unauthorized: HttpStatus.UNAUTHORIZED,
  not_found: HttpStatus.NOT_FOUND,
  insufficient_funds: HttpStatus.UNPROCESSABLE_ENTITY,
  stake_too_small: HttpStatus.UNPROCESSABLE_ENTITY,
  too_many_open_predictions: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  market_closed: HttpStatus.CONFLICT,
  stale_price: HttpStatus.SERVICE_UNAVAILABLE,
  duration_not_allowed: HttpStatus.UNPROCESSABLE_ENTITY,
  asset_unavailable: HttpStatus.CONFLICT,
  idempotency_conflict: HttpStatus.CONFLICT,
  nickname_invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  nickname_taken: HttpStatus.CONFLICT,
  code_invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  code_attempts_exceeded: HttpStatus.TOO_MANY_REQUESTS,
  email_in_use: HttpStatus.CONFLICT,
  account_not_found: HttpStatus.NOT_FOUND,
  already_registered: HttpStatus.CONFLICT,
  comeback_unavailable: HttpStatus.CONFLICT,
  maintenance: HttpStatus.SERVICE_UNAVAILABLE,
  internal: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.status = STATUS[code];
  }

  toBody(): ApiError {
    return { code: this.code, message: this.message };
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof DomainError) {
      res.status(exception.status).json(exception.toBody());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode = status === 404 ? 'not_found' : status === 401 ? 'unauthorized' : 'validation_failed';
      res.status(status).json({ code, message: MESSAGES[code] } satisfies ApiError);
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ code: 'internal', message: MESSAGES.internal } satisfies ApiError);
  }
}
