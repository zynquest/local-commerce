import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Send } from 'lucide-react';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { isMobile10 } from './MobileInput.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { rich, useI18n } from '../i18n/index.jsx';
import { whatsappLink } from '../services/whatsappService.js';

const pretty = (n) => `+${n.slice(0, n.length - 10)} ${n.slice(-10, -5)} ${n.slice(-5)}`;

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

/**
 * "Send code" + 6-digit code input. The parent owns `code`; `phone` (10 digits, owners) or `email` (customers)
 * must be valid before sending. Delivery depends on the server's OTP provider:
 *  - email:  the code was emailed to the customer
 *  - manual: no SMS yet — the user WhatsApps the support number and the team replies with the code
 *  - dev:    local testing — the code (898989) is shown as a hint
 *  - sms:    the code arrives by SMS
 *  - whatsapp:       the code arrives on WhatsApp (Meta authentication template)
 *  - whatsapp_reply: the user sends us a pre-filled WhatsApp message and gets the code as a reply (free)
 */
export default function OtpField({ phone, email, purpose, code, onCode, disabled, name }) {
  const { t, lang } = useI18n();
  const { requestOtp, appConfig } = useSession();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [delivery, setDelivery] = useState(appConfig.otpDelivery);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState('');
  const [wa, setWa] = useState(null); // whatsapp_reply: { number, text } to send from the user's WhatsApp
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    setError('');
    setSending(true);
    try {
      const r = await requestOtp(email !== undefined ? { email: email.trim().toLowerCase() } : { phone }, purpose, name, lang);
      setSent(true);
      setCooldown(30);
      setDevCode(r.devCode || '');
      setWa(r.waNumber && r.waText ? { number: r.waNumber, text: r.waText } : null);
      if (r.delivery) setDelivery(r.delivery);
    } catch (err) {
      setError(err.fields?.email || err.fields?.phone || err.message);
    } finally {
      setSending(false);
    }
  };

  const help = appConfig.otpHelpWhatsApp;
  const helpMessage = t('otp.manualMsg', { phone: pretty(`91${phone}`) });

  return (
    <div className="space-y-2">
      <button type="button" onClick={send} disabled={disabled || sending || cooldown > 0 || !(email !== undefined ? isEmail(email) : isMobile10(phone))} className="btn-ghost w-full">
        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {cooldown > 0 ? t('otp.resendIn', { s: cooldown }) : sent ? t('otp.resend') : t('otp.send')}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {sent && delivery === 'manual' && help && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          <p className="font-semibold">{t('otp.manualTitle')}</p>
          <p className="text-xs">{rich(t('otp.manualBody', { number: pretty(help), phone: pretty(`91${phone}`) }), { b: (x) => <b dir="ltr">{x}</b> })}</p>
          <a href={whatsappLink(help, helpMessage)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full py-2 text-xs">
            <WhatsAppIcon size={16} /> {t('otp.manualButton', { number: `\u2066${pretty(help)}\u2069` /* LTR isolate: keeps +91 … intact in RTL scripts */ })}
          </a>
        </div>
      )}

      {sent && delivery === 'whatsapp_reply' && wa && (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          <p className="font-semibold">{t('otp.waReplyTitle')}</p>
          <p className="text-xs">{rich(t('otp.waReplyBody', { phone: pretty(`91${phone}`) }), { b: (x) => <b dir="ltr">{x}</b> })}</p>
          <a href={whatsappLink(wa.number, wa.text)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full py-2 text-sm" data-testid="wa-otp-link">
            <WhatsAppIcon size={16} /> {t('otp.waReplyButton')}
          </a>
        </div>
      )}
      {sent && delivery === 'whatsapp' && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
          {rich(t('otp.waSent', { phone: pretty(`91${phone}`) }), { b: (x) => <b dir="ltr">{x}</b> })}
        </p>
      )}
      {sent && delivery === 'email' && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
          {rich(t('otp.emailSent', { email: email.trim().toLowerCase() }), { b: (x) => <b dir="ltr">{x}</b> })}
        </p>
      )}
      {sent && delivery === 'sms' && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
          {rich(t('otp.smsSent', { phone: pretty(`91${phone}`) }), { b: (x) => <b dir="ltr">{x}</b> })}
        </p>
      )}

      {sent && (
        <div>
          <label className="label" htmlFor={`otp-${purpose}`}>{t('otp.enter')}</label>
          <div className="relative" dir="ltr">
            <KeyRound size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
            <input
              id={`otp-${purpose}`}
              className="input ps-9 font-mono tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => onCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
            />
          </div>
          {devCode && (
            <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              {rich(t('otp.devHint', { code: devCode }), { b: (x) => <b className="font-mono">{x}</b> })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
