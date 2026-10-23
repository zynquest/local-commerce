import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, CloudOff, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import QuantityStepper from './QuantityStepper.jsx';
import SmartImage from './SmartImage.jsx';
import UnlistedItemsBox from './UnlistedItemsBox.jsx';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { formatMoney, getOpenStatus } from '../lib/format.js';
import { compileWhatsAppOrder, orderMessageLanguage } from '../services/whatsappService.js';
import CustomerAuthModal from './CustomerAuthModal.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { queueOrder } from '../services/orderService.js';
import { makeT, rich, useI18n } from '../i18n/index.jsx';

/** Slide-out cart with unlisted-items notes, delivery details and WhatsApp checkout. */
export default function CartDrawer() {
  const { t, lang } = useI18n();
  const { store: config, slug } = useStore();
  const cart = useCart();
  const { customer } = useSession();
  const [placed, setPlaced] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const cur = config?.currency_symbol || '₹';
  const money = (n) => formatMoney(n, cur);
  const { subtotal, savings, deliveryFee, freeDelivery, freeDeliveryGap, total } = cart.totals;

  // Prefill blank delivery fields from the shopper's account.
  useEffect(() => {
    if (!customer) return;
    const c = cart.customer;
    if (c.name && c.address) return;
    cart.setCustomer({
      name: c.name || customer.name || '',
      phone: c.phone || '',
      address: c.address || customer.default_address || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  useEffect(() => {
    if (!cart.open) return;
    const onKey = (e) => e.key === 'Escape' && cart.setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [cart.open, cart]);

  if (!cart.open || !config) return null;

  const hasItems = cart.items.length > 0;
  const hasNotes = cart.notes.trim().length > 0;
  const minOrder = Number(config.minimum_order) || 0;
  const belowMin = hasItems && subtotal < minOrder;
  const status = getOpenStatus(config.opening_hours, config.closed_days);
  const canOrder = (hasItems || hasNotes) && !belowMin && !!config.whatsapp_number;

  const placeOrder = () => {
    // Customer's language by default; a store can fix one language in Settings (preloaded by StoreProvider).
    const msgLang = orderMessageLanguage(config, lang);
    const order = compileWhatsAppOrder({ ...config, order_language: msgLang }, cart.items, cart.notes, cart.customer, makeT(msgLang));
    // Open synchronously from the click so mobile browsers don't block the popup.
    // ("noopener" in the features string would make window.open return null, so detach manually.)
    const win = window.open(order.url, '_blank');
    if (win) win.opener = null;
    else window.location.href = order.url;
    // Record the order: saved to the device outbox first, synced to the server now or when back online.
    const offline = !navigator.onLine;
    queueOrder(slug, {
      order_code: order.orderId,
      items: cart.items.map((i) => ({
        sku_id: i.sku_id,
        name: i.name,
        mrp: i.mrp,
        quantity: i.quantity,
        unit_price: i.offer_price,
      })),
      notes: order.notes || null,
      customer_name: cart.customer.name || null,
      customer_phone: cart.customer.phone || null,
      delivery_address: cart.customer.address || null,
      placed_offline: offline,
      client_created_at: new Date().toISOString(),
    });
    setPlaced({ ...order, offline });
  };

  const close = () => {
    cart.setOpen(false);
    setPlaced(null);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('cart.title')}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={close} />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-md animate-slide-in flex-col bg-stone-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ShoppingBag size={20} className="text-brand" /> {t('cart.title')}
            {cart.count > 0 && <span className="text-sm font-medium text-stone-500">({t('cart.items', { count: cart.count })})</span>}
          </h2>
          <button onClick={close} aria-label={t('common.close')} className="rounded-full p-2 hover:bg-stone-100">
            <X size={20} />
          </button>
        </header>

        {placed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <CheckCircle2 size={64} className="text-whatsapp" />
            <h3 className="text-xl font-bold">{t('cart.orderReady', { code: placed.orderId })}</h3>
            <p className="text-sm text-stone-600">
              {rich(t('cart.tapSend', { store: config.name }), { b: (x) => <b>{x}</b> })}
            </p>
            {placed.offline && (
              <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-start text-xs text-amber-800">
                <CloudOff size={16} className="flex-none" />
                {t('cart.offlinePlaced')}
              </p>
            )}
            <a href={placed.url} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full">
              <WhatsAppIcon size={18} /> {t('cart.openAgain')}
            </a>
            <button
              onClick={() => {
                cart.clear();
                close();
              }}
              className="btn-ghost w-full"
            >
              {t('cart.sentClear')}
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {status && !status.open && (
                <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle size={18} className="flex-none" />
                  {t('cart.storeClosed', { status: t(status.key, status.vars) })}
                </div>
              )}

              {hasItems ? (
                <ul className="card divide-y divide-stone-100">
                  {cart.items.map((item) => (
                    <li key={item.sku_id} className="flex gap-3 p-3">
                      <SmartImage src={item.image} alt={item.name} width={160} className="h-16 w-16 flex-none rounded-lg object-cover" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-stone-500">
                          <span dir="ltr">{money(item.offer_price)}</span>
                          {item.mrp > item.offer_price && <>{' '}<span dir="ltr" className="line-through">{money(item.mrp)}</span></>}
                        </p>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                          <div className="w-28">
                            <QuantityStepper
                              quantity={item.quantity}
                              onAdd={() => cart.add(item)}
                              onRemove={() => cart.remove(item)}
                            />
                          </div>
                          <span className="text-sm font-bold">{money(item.offer_price * item.quantity)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => cart.setQuantity(item, 0)}
                        aria-label={t('cart.removeItem', { name: item.name })}
                        className="self-start p-1 text-stone-400 hover:text-rose-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-6 text-center text-sm text-stone-500">
                  <ShoppingBag size={40} className="mx-auto mb-2 text-stone-300" />
                  {t('cart.empty')}
                </div>
              )}

              <div className="card p-4">
                <UnlistedItemsBox compact />
              </div>

              <div className="card space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">{t('cart.delivery')}</h3>
                  {customer ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-700">
                      <UserRound size={14} /> {customer.name}
                    </span>
                  ) : (
                    <button type="button" onClick={() => setAuthOpen(true)} className="text-xs font-semibold text-brand">
                      {t('cart.loginToSave')}
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  placeholder={t('cart.yourName')}
                  value={cart.customer.name}
                  autoComplete="name"
                  onChange={(e) => cart.setCustomer({ ...cart.customer, name: e.target.value.slice(0, 80) })}
                />
                <input
                  className="input"
                  placeholder={t('cart.phone')}
                  value={cart.customer.phone}
                  inputMode="tel"
                  autoComplete="tel"
                  onChange={(e) => cart.setCustomer({ ...cart.customer, phone: e.target.value.slice(0, 20) })}
                />
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder={t('cart.address')}
                  value={cart.customer.address}
                  autoComplete="street-address"
                  onChange={(e) => cart.setCustomer({ ...cart.customer, address: e.target.value.slice(0, 300) })}
                />
              </div>
            </div>

            <footer className="pb-safe space-y-2 border-t border-stone-200 bg-white px-4 pt-3">
              {hasItems && (
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-stone-500">{t('cart.subtotal')}</dt>
                    <dd>{money(subtotal)}</dd>
                  </div>
                  {deliveryFee > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-stone-500">{t('cart.deliveryFee')}</dt>
                      <dd>{money(deliveryFee)}</dd>
                    </div>
                  )}
                  {freeDelivery && (
                    <div className="flex justify-between text-emerald-700">
                      <dt>{t('cart.deliveryFee')}</dt>
                      <dd>{t('cart.freeDelivery')}</dd>
                    </div>
                  )}
                  {savings > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <dt>{t('cart.youSave')}</dt>
                      <dd dir="ltr">−{money(savings)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-dashed border-stone-200 pt-1 text-base font-bold">
                    <dt>{t('cart.total')}</dt>
                    <dd>{money(total)}</dd>
                  </div>
                </dl>
              )}
              {belowMin && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {t('cart.minOrder', { min: money(minOrder), more: money(minOrder - subtotal) })}
                </p>
              )}
              {hasItems && !belowMin && freeDeliveryGap > 0 && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {t('cart.freeDeliveryAbove', { more: money(freeDeliveryGap) })}
                </p>
              )}
              {!config.whatsapp_number && (
                <p className="text-xs text-rose-600">{t('cart.notAccepting')}</p>
              )}
              <button onClick={placeOrder} disabled={!canOrder} className="btn-whatsapp w-full py-3.5 text-base">
                <WhatsAppIcon size={20} /> {t('cart.placeOrder')}
              </button>
              <p className="text-center text-[11px] text-stone-400">
                {t('cart.payInfo')}
              </p>
            </footer>
          </>
        )}
      </aside>
      {authOpen && <CustomerAuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
