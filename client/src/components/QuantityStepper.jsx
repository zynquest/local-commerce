import { Minus, Plus } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

/** "ADD" button that turns into a [-] qty [+] stepper once the item is in the cart. */
export default function QuantityStepper({ quantity, onAdd, onRemove, disabled, size = 'md', addLabel }) {
  const t = useT();
  const h = size === 'lg' ? 'h-12 text-base' : 'h-9 text-sm';
  const stop = (fn) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  if (disabled) {
    return (
      <button disabled className={`${h} w-full rounded-xl bg-stone-100 font-semibold text-stone-400`}>
        {t('product.outOfStock')}
      </button>
    );
  }
  if (!quantity) {
    return (
      <button
        onClick={stop(onAdd)}
        className={`${h} w-full rounded-xl border-2 border-brand bg-white font-bold text-brand transition hover:bg-brand hover:text-white active:scale-95`}
      >
        {addLabel || t('product.add')}
      </button>
    );
  }
  return (
    <div className={`${h} flex w-full animate-pop items-center justify-between rounded-xl bg-brand font-bold text-white`}>
      <button aria-label={t('product.decrease')} onClick={stop(onRemove)} className="flex h-full flex-1 items-center justify-center">
        <Minus size={16} strokeWidth={3} />
      </button>
      <span className="min-w-6 text-center tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button aria-label={t('product.increase')} onClick={stop(onAdd)} className="flex h-full flex-1 items-center justify-center">
        <Plus size={16} strokeWidth={3} />
      </button>
    </div>
  );
}
