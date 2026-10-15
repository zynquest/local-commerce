import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CloudOff, Loader2, MapPin, ReceiptText, RefreshCw, UserRound } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { get, patch } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { whatsappLink } from '../services/whatsappService.js';
import { useI18n } from '../i18n/index.jsx';

// [status, English label (admin/fallback), badge classes]. UI labels come from orders.status.<status>.
export const ORDER_STATUSES = [
  ['placed', 'New', 'bg-sky-100 text-sky-800'],
  ['confirmed', 'Confirmed', 'bg-violet-100 text-violet-800'],
  ['out_for_delivery', 'Out for delivery', 'bg-amber-100 text-amber-800'],
  ['delivered', 'Delivered', 'bg-emerald-100 text-emerald-800'],
  ['cancelled', 'Cancelled', 'bg-stone-200 text-stone-600'],
];
const statusStyle = Object.fromEntries(ORDER_STATUSES.map(([k, , c]) => [k, c]));

export default function OrdersPanel({ currency, onChange }) {
  const { t, formatDate } = useI18n();
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({ loading: true, orders: [], error: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const { orders } = await get(`/merchant/orders?status=${filter}&limit=100`);
      setState({ loading: false, orders, error: '' });
    } catch (err) {
      setState({ loading: false, orders: [], error: err.message });
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (order, status) => {
    setState((s) => ({ ...s, orders: s.orders.map((o) => (o.id === order.id ? { ...o, status } : o)) }));
    try {
      await patch(`/merchant/orders/${order.id}`, { status });
      onChange?.();
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
      load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          {['all', ...ORDER_STATUSES.map(([k]) => k)].map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`flex-none rounded-full border px-3 py-1 text-xs font-semibold ${
                filter === k ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-600'
              }`}
            >
              {k === 'all' ? t('store.all') : t(`orders.status.${k}`)}
            </button>
          ))}
        </div>
        <button onClick={load} className="btn-ghost py-1.5 text-xs" disabled={state.loading} aria-label={t('common.refresh')}>
          {state.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {state.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>}
      {!state.loading && !state.orders.length && !state.error && (
        <div className="card py-12 text-center text-sm text-stone-500">
          <ReceiptText size={36} className="mx-auto mb-2 text-stone-300" />
          {t('orders.empty')}
        </div>
      )}

      {state.orders.map((o) => (
        <article key={o.id} className="card space-y-2 p-4">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-sm font-bold">#{o.order_code}</p>
              <p className="text-xs text-stone-500">{formatDate(o.created_at)}</p>
            </div>
            <select
              value={o.status}
              onChange={(e) => setStatus(o, e.target.value)}
              className={`rounded-full border-0 px-3 py-1 text-xs font-bold ${statusStyle[o.status]}`}
              aria-label={t('orders.statusLabel')}
            >
              {ORDER_STATUSES.map(([k]) => (
                <option key={k} value={k}>{t(`orders.status.${k}`)}</option>
              ))}
            </select>
          </header>

          <div className="flex flex-wrap gap-1.5">
            {o.price_mismatch && (
              <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <AlertTriangle size={12} /> {t('orders.priceMismatch')}
              </span>
            )}
            {o.placed_offline && (
              <span className="flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                <CloudOff size={12} /> {t('orders.placedOffline')}
              </span>
            )}
            <span className="flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
              <UserRound size={12} /> {o.customer_id ? t('orders.account', { name: o.account_name }) : t('orders.guest')}
            </span>
          </div>

          {o.items.length > 0 && (
            <ul className="divide-y divide-stone-100 rounded-xl bg-stone-50 px-3 text-sm">
              {o.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {i.quantity} × {i.name}
                  </span>
                  <span className="font-medium">{formatMoney(i.line_total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
          {o.notes && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm whitespace-pre-line text-amber-900">📝 {o.notes}</p>}

          <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
            <div className="text-stone-600">
              {o.customer_name && <p className="font-semibold text-stone-800">{o.customer_name}</p>}
              {o.delivery_address && (
                <p className="flex items-start gap-1 text-xs"><MapPin size={12} className="mt-0.5 flex-none" /> {o.delivery_address}</p>
              )}
            </div>
            <div className="text-end">
              {o.delivery_fee > 0 && <p className="text-xs text-stone-500">{t('orders.inclDelivery', { amount: formatMoney(o.delivery_fee, currency) })}</p>}
              <p className="text-base font-bold">{formatMoney(o.total, currency)}</p>
            </div>
          </div>
          {o.customer_phone && (
            <a
              href={whatsappLink(o.customer_phone, t('orders.messageText', { name: o.customer_name || '', code: o.order_code }))}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-whatsapp w-full py-2 text-xs"
            >
              <WhatsAppIcon size={14} /> {t('orders.messageCustomer')}
            </a>
          )}
        </article>
      ))}
    </div>
  );
}
