import { ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { formatMoney } from '../lib/format.js';
import { useT } from '../i18n/index.jsx';

/** Persistent "View bag" bar. (No floating WhatsApp button: the store's WhatsApp link is in the footer.) */
export default function FloatingActions({ hideCartBar = false }) {
  const t = useT();
  const { store: config } = useStore();
  const cart = useCart();
  if (!config) return null;
  const showBar = !hideCartBar && (cart.count > 0 || cart.notes.trim());

  return (
    <>
      {showBar && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 px-4 pt-2">
          <button
            onClick={() => cart.setOpen(true)}
            className="mx-auto flex w-full max-w-xl animate-fade-up items-center justify-between rounded-2xl bg-brand px-5 py-3.5 text-white shadow-xl"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingBag size={20} />
              {cart.count > 0 ? t('cart.items', { count: cart.count }) : t('cart.customList')}
              {cart.count > 0 && <span className="opacity-80">· {formatMoney(cart.totals.subtotal, config.currency_symbol)}</span>}
            </span>
            <span className="text-sm font-bold">{t('cart.viewBag')} <span className="inline-block rtl:rotate-180">→</span></span>
          </button>
        </div>
      )}
    </>
  );
}
