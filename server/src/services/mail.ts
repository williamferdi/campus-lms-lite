import nodemailer from "nodemailer";
import type { Config } from "../config.js";

export interface Mailer {
  /** True only when an SMTP provider is configured. */
  readonly configured: boolean;
  send(to: string, subject: string, text: string): Promise<boolean>;
}

export function createMailer(config: Config, log: { warn: (o: object, m: string) => void }): Mailer {
  if (!config.SMTP_URL) {
    return {
      configured: false,
      async send() {
        return false; // Never pretend an email was sent.
      },
    };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  return {
    configured: true,
    async send(to, subject, text) {
      try {
        await transport.sendMail({ from: config.MAIL_FROM, to, subject, text });
        return true;
      } catch (err) {
        log.warn({ err: (err as Error).message, to }, "email delivery failed");
        return false;
      }
    },
  };
}
