import { useState } from 'react';
import { Check, Copy, IndianRupee } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

/** upi://pay link: on a phone it opens the shopper's UPI app (GPay, PhonePe, Paytm, BHIM…) with the store as payee. */
export const upiLink = (id, name, amount) =>
  `upi://pay?pa=${id}&pn=${encodeURIComponent(name || '')}&cu=INR${amount > 0 ? `&am=${Number(amount).toFixed(2)}` : ''}`;

/** "Pay by UPI · id" (opens a UPI app) and a copy button, for computers and phones without a UPI app. */
export default function UpiPay({ id, name, className = '' }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* copy blocked: the ID is on screen */
    }
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <a href={upiLink(id, name)} className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 font-semibold text-violet-800 hover:bg-violet-100">
        <IndianRupee size={14} className="flex-none" /> {t('upi.pay')}
        <span className="truncate font-normal" dir="ltr">· {id}</span>
      </a>
      <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-full border border-stone-200 px-2.5 py-1.5 text-xs text-stone-600" aria-label={t('upi.copy')}>
        {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />} {copied ? t('upi.copied') : t('upi.copy')}
      </button>
    </div>
  );
}
