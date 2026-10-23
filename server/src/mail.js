// Outgoing email (SMTP, Gmail App Password in production): customer login codes and the team's OTP relay.
import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter;
export function smtp() {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

export const sendMail = (message) => smtp().sendMail({ from: config.smtp.from, ...message });
