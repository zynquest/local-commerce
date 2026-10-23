// Sends one test email with the configured SMTP settings (SMTP_USER / SMTP_PASS / SMTP_FROM), to debug delivery on
// the VM:   node src/cli/mail.js you@example.com
import { config } from '../config.js';
import { sendMail } from '../mail.js';

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Usage: node src/cli/mail.js <to-address>');
  process.exit(1);
}
console.log(`[mail] ${config.smtp.host}:${config.smtp.port} secure=${config.smtp.secure} user=${config.smtp.user || '(empty)'} from=${config.smtp.from || '(empty)'}`);
try {
  const info = await sendMail({ to, subject: `${config.platformName} test email`, text: `SMTP works. Sent ${new Date().toISOString()} to ${to}.` });
  console.log(`[mail] sent to ${to}: ${info.messageId} — ${info.response}`);
} catch (err) {
  console.error(`[mail] failed: ${err.message}`);
  if (err.response) console.error(err.response);
  process.exitCode = 1;
}
