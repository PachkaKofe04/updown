import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
}

/** Отправка писем. Сервис подключается настройками SMTP_*, в разработке без них письма пишутся в лог. */
export abstract class MailSender {
  abstract send(mail: Mail): Promise<void>;
}

export class LogMailSender extends MailSender {
  private readonly log = new Logger('Mail');

  async send(mail: Mail): Promise<void> {
    this.log.log(`to ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}

export class SmtpMailSender extends MailSender {
  private readonly transport: Transporter;

  constructor(
    settings: SmtpSettings,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      // 465 - шифрование сразу при подключении, остальные порты - STARTTLS
      secure: settings.port === 465,
      requireTLS: settings.port !== 465,
      auth: { user: settings.user, pass: settings.password },
      // игрок ждёт ответа на "Получить код": зависшее соединение не должно держать запрос минутами
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }

  /** Проверка подключения и входа на SMTP-сервер (без отправки письма). */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
}
