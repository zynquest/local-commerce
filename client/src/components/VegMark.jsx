import { useT } from '../i18n/index.jsx';

const COLOURS = { veg: '#15803d', nonveg: '#7c3a10' };

/**
 * The Indian food mark next to a shop's name: a green dot in a green square (pure vegetarian) or a brown one (also
 * sells non-veg). Shops that aren't food shops, or haven't said, get no mark.
 */
export default function VegMark({ type, size = 16, className = '' }) {
  const t = useT();
  const colour = COLOURS[type];
  if (!colour) return null;
  const label = t(type === 'veg' ? 'food.vegMark' : 'food.nonvegMark');
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex flex-none items-center justify-center rounded-[3px] border-2 bg-white ${className}`}
      style={{ width: size, height: size, borderColor: colour }}
    >
      <span className="rounded-full" style={{ width: Math.round(size * 0.45), height: Math.round(size * 0.45), background: colour }} />
    </span>
  );
}

export const FOOD_TYPES = ['veg', 'nonveg', 'none'];

/** "Veg or non-veg?" for shops: asked before submitting for approval, and changeable in Store Settings. */
export function FoodTypePicker({ value, onChange, error, name = 'food-type' }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="label">
        {t('food.question')} <span className="text-rose-500">*</span>
      </legend>
      <p className="mb-2 text-[11px] text-stone-500">{t('food.hint')}</p>
      <div className="grid gap-2">
        {FOOD_TYPES.map((k) => (
          <label
            key={k}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${value === k ? 'border-brand bg-emerald-50 font-semibold' : 'border-stone-200'}`}
          >
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="h-4 w-4 accent-[var(--brand)]" />
            {k === 'none' ? <span className="inline-block w-4 flex-none" aria-hidden="true" /> : <VegMark type={k} />}
            {t(`food.${k}`)}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </fieldset>
  );
}
