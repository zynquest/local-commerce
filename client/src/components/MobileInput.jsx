import { useT } from '../i18n/index.jsx';

/** 10-digit Indian mobile number with a fixed +91 prefix. Value is digits only. */
export const isMobile10 = (v) => /^[6-9]\d{9}$/.test(String(v || ''));

/**
 * Digits only, without the country code — works while typing as well as for pasted numbers:
 * "+91 98765 43210", "919876543210" and "09876543210" all become "9876543210".
 */
export function toMobile10(raw) {
  let d = String(raw || '').trim().replace(/^\+\s*(9\s*1?)?/, '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  // Allow a partial "91…"/"0…" prefix while it's still being typed; it collapses once the number is complete.
  return d.slice(0, d.startsWith('91') ? 12 : d.startsWith('0') ? 11 : 10);
}

export default function MobileInput({ id = 'phone', value, onChange, error, label, hint, autoFocus }) {
  const t = useT();
  return (
    <div>
      <label className="label" htmlFor={id}>{label || t('auth.mobile')}</label>
      <div className="flex items-center gap-2" dir="ltr">
        <span className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-500">+91</span>
        <input maxLength={16}
          id={id}
          className="input tracking-wide"
          value={value}
          onChange={(e) => onChange(toMobile10(e.target.value))}
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          aria-invalid={Boolean(error)}
          autoFocus={autoFocus}
          required
        />
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : hint && <p className="mt-1 text-[11px] text-stone-400">{hint}</p>}
    </div>
  );
}
