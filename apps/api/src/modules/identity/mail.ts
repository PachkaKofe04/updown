import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Отправка писем. Провайдер подключается через SMTP_URL, в разработке письма пишутся в лог. */
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
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(url);
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
