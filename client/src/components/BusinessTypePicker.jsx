import { CalendarClock, Store } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

const TYPES = [
  ['shop', Store, 'biz.shop', 'biz.shopHint'],
  ['appointments', CalendarClock, 'biz.appointments', 'biz.appointmentsHint'],
];

/** Store or Appointments, as two radio cards (registration and the setup steps). `disabled`: shown, not changeable. */
export default function BusinessTypePicker({ value, onChange, error, disabled = false, name = 'businessType' }) {
  const t = useT();
  return (
    <fieldset disabled={disabled}>
      <legend className="label">{t('biz.question')}</legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {TYPES.map(([v, Icon, title, hint]) => {
          const on = value === v;
          return (
            <label
              key={v}
              className={`relative flex flex-col gap-1 rounded-2xl border-2 p-3 text-sm ${disabled ? (on ? 'border-stone-300 bg-stone-50' : 'hidden') : 'cursor-pointer'} ${!disabled && on ? 'border-brand bg-emerald-50' : ''} ${!disabled && !on ? 'border-stone-200 hover:border-stone-300' : ''}`}
            >
              <input type="radio" name={name} value={v} checked={on} onChange={() => onChange?.(v)} className="peer sr-only" />
              <span
                aria-hidden="true"
                className={`absolute top-3 end-3 flex h-4 w-4 items-center justify-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${on ? 'border-brand' : 'border-stone-300'}`}
              >
                {on && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              <Icon size={20} className={on ? 'text-brand' : 'text-stone-500'} />
              <span className="font-bold">{t(title)}</span>
              <span className="text-[11px] leading-snug text-stone-500">{t(hint)}</span>
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </fieldset>
  );
}
