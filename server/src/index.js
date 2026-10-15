import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { assertOtpConfig, config } from './config.js';
import { migrate } from './migrate.js';

assertOtpConfig(); // refuses fixed/console OTP in production and email OTP without SMTP credentials
console.log(`[otp] provider: ${config.otpProvider}`);

await migrate({ log: (m) => console.log(`[db] ${m}`) });

const app = createApp();
app.listen(config.port, () => console.log(`[api] listening on http://localhost:${config.port}`));

setInterval(() => purgeExpiredSessions().catch(() => {}), 60 * 60_000).unref();
