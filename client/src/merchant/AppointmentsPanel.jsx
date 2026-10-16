import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock, Loader2, Phone, RefreshCw, UserRound, X } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { get, patch } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { whatsappLink } from '../services/whatsappService.js';
import { loadCatalog, makeT, useI18n } from '../i18n/index.jsx';

const FILTERS = ['upcoming', 'requested', 'confirmed', 'cancelled'];
const STATUS_STYLE = {
  requested: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-stone-200 text-stone-600',
  no_show: 'bg-rose-100 text-rose-700',
};

/** Booking requests and confirmed appointments for the next two weeks, grouped by day. */
export default function AppointmentsPanel({ store, currency, onChange }) {
  const { t, formatDay, formatClock, locale } = useI18n();
  const [filter, setFilter] = useState('upcoming');
  const [data, setData] = useState({ loading: true, items: [], error: '' });
  const [busy, setBusy] = useState('');
  const [, setCatalogs] = useState(0); // re-render once customers' languages are loaded

  const load = useCallback(() => {
    setData((d) => ({ ...d, loading: true }));
    const q = FILTERS.includes(filter) && filter !== 'upcoming' ? `?status=${filter}` : '';
    return get(`/merchant/appointments${q}`)
      .then((r) => setData({ loading: false, items: r.appointments, error: '' }))
      .catch((err) => setData({ loading: false, items: [], error: err.message }));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Replies to customers are written in the language they booked in.
  useEffect(() => {
    const langs = [...new Set(data.items.map((a) => a.language).filter((l) => l && l !== 'en'))];
    Promise.all(langs.map((l) => loadCatalog(l).catch(() => {}))).then(() => setCatalogs((n) => n + 1));
  }, [data.items]);

  const setStatus = async (a, status) => {
    setBusy(`${a.id}:${status}`);
    try {
      const { appointment } = await patch(`/merchant/appointments/${a.id}`, { status });
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === a.id ? appointment : x)) }));
      onChange?.();
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const shown = filter === 'upcoming' ? data.items.filter((a) => ['requested', 'confirmed'].includes(a.status)) : data.items;
  const byDay = useMemo(() => {
    const map = new Map();
    for (const a of shown) map.set(a.date, [...(map.get(a.date) || []), a]);
    return [...map.entries()];
  }, [shown]);

  const reply = (a, kind) => {
    const tt = makeT(a.language || 'en');
    const vars = {
      name: a.customer_name,
      code: a.code,
      service: a.service_name,
      specialist: a.specialist_name,
      date: new Intl.DateTimeFormat(a.language === 'en' ? 'en-IN' : locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${a.date}T12:00:00Z`)),
      time: a.time,
      store: store.name,
      link: `${window.location.origin}/s/${store.slug}`,
    };
    return whatsappLink(a.customer_phone, tt(kind === 'cancel' ? 'appt.msg.cancelled' : 'appt.msg.confirmed', vars));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`flex-none rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === f ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-700'}`}>
              {t(`appt.filter.${f}`)}
            </button>
          ))}
        </div>
        <button onClick={load} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={t('common.refresh')}>
          <RefreshCw size={18} className={data.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {data.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}
      {!data.loading && !shown.length && (
        <div className="card p-8 text-center text-sm text-stone-500">
          <CalendarDays className="mx-auto mb-2 text-stone-300" size={32} />
          {t('appt.noBookings')}
        </div>
      )}
      {byDay.map(([date, items]) => (
        <section key={date} className="space-y-2">
          <h3 className="text-xs font-bold tracking-wide text-stone-500 uppercase">{formatDay(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          {items.map((a) => (
            <article key={a.id} className="card space-y-2 p-3" data-status={a.status}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-bold">
                    <Clock size={14} className="text-brand" />
                    <span dir="ltr">{formatClock(a.time)} – {formatClock(a.end_time)}</span>
                  </p>
                  <p className="text-sm">{a.service_name} <span className="text-stone-500">· {formatMoney(a.price, currency)}</span></p>
                  <p className="flex items-center gap-1 text-xs text-stone-500"><UserRound size={12} /> {a.specialist_name}</p>
                </div>
                <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[a.status]}`}>{t(`appt.status.${a.status}`)}</span>
              </div>
              <div className="rounded-xl bg-stone-50 p-2 text-sm">
                <p className="font-semibold">{a.customer_name} <span className="font-mono text-xs font-normal text-stone-500">{a.code}</span></p>
                <a href={`tel:+${a.customer_phone}`} className="flex items-center gap-1 text-xs text-brand" dir="ltr"><Phone size={12} /> +{a.customer_phone.slice(0, 2)} {a.customer_phone.slice(2, 7)} {a.customer_phone.slice(7)}</a>
                {a.notes && <p className="mt-1 text-xs text-stone-600">“{a.notes}”</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {a.status === 'requested' && (
                  <button onClick={() => setStatus(a, 'confirmed')} disabled={Boolean(busy)} className="btn-brand py-1.5 text-xs">
                    {busy === `${a.id}:confirmed` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('appt.confirm')}
                  </button>
                )}
                {a.status === 'confirmed' && (
                  <>
                    <button onClick={() => setStatus(a, 'completed')} disabled={Boolean(busy)} className="btn-ghost py-1.5 text-xs"><Check size={14} /> {t('appt.markDone')}</button>
                    <button onClick={() => setStatus(a, 'no_show')} disabled={Boolean(busy)} className="btn-ghost py-1.5 text-xs">{t('appt.markNoShow')}</button>
                  </>
                )}
                {['requested', 'confirmed'].includes(a.status) && (
                  <button onClick={() => window.confirm(t('appt.confirmCancel')) && setStatus(a, 'cancelled')} disabled={Boolean(busy)} className="btn-ghost py-1.5 text-xs text-rose-600">
                    <X size={14} /> {t('appt.cancel')}
                  </button>
                )}
                {['confirmed', 'cancelled'].includes(a.status) && (
                  <a href={reply(a, a.status === 'cancelled' ? 'cancel' : 'confirm')} target="_blank" rel="noopener noreferrer" className="btn-whatsapp py-1.5 text-xs">
                    <WhatsAppIcon size={14} /> {a.status === 'cancelled' ? t('appt.tellCancelled') : t('appt.tellConfirmed')}
                  </a>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}
      {data.loading && !data.items.length && <div className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></div>}
    </div>
  );
}
