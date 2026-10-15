import { ShoppingBag } from 'lucide-react';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { formatMoney } from '../lib/format.js';
import { whatsappLink } from '../services/whatsappService.js';
import { useT } from '../i18n/index.jsx';

/** Floating WhatsApp chat button + persistent "View bag" bar. */
export default function FloatingActions({ hideCartBar = false, raised = false }) {
  const t = useT();
  const { store: config } = useStore();
  const cart = useCart();
  if (!config) return null;
  const showBar = !hideCartBar && (cart.count > 0 || cart.notes.trim());

  return (
    <>
      {config.whatsapp_number && (
        <a
          href={whatsappLink(config.whatsapp_number, t('store.chatGreeting', { name: config.name }))}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('store.chatOnWhatsApp')}
          className={`fixed end-4 z-30 rounded-full bg-whatsapp p-3.5 text-white shadow-lg shadow-black/20 transition hover:scale-105 ${showBar || raised ? 'bottom-24' : 'bottom-6'}`}
        >
          <WhatsAppIcon size={26} />
        </a>
      )}
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
