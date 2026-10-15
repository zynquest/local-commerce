import { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';

/** Rate-limit key: the real client IP (CDN header when configured), with IPv6 grouped by /56. */
export const clientKey = (req) => ipKeyGenerator((config.clientIpHeader && req.get(config.clientIpHeader)) || req.ip);
