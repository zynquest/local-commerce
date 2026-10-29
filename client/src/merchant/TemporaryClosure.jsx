import { useState } from 'react';
import { Check, DoorClosed, Loader2 } from 'lucide-react';
import { put } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

// India date (YYYY-MM-DD) offset by `days`: the reopening date must be after today.
const istDate = (days = 0) => new Date(Date.now() + 5.5 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Holiday / leave switch: while on, customers can browse the store but can't order on WhatsApp or book. Ends on its
 * own on the reopening date (if one is set), or when switched off. Saves on its own, apart from the other settings.
 */
export default function TemporaryClosure({ store, onSaved }) {
  const { t, formatDay } = useI18n();
  // Starts from whether the store is closed right now: a closure whose reopening date has passed shows as off.
  const [closed, setClosed] = useState(Boolean(store.closed_now));
  const [reopensOn, setReopensOn] = useState(store.closed_now ? store.reopens_on || '' : '');
  const [message, setMessage] = useState(store.closed_now ? store.closure_message || '' : '');
  const [state, setState] = useState({ busy: false, error: '', fields: {} });

  const save = async (nextClosed = closed) => {
    setState({ busy: true, error: '', fields: {} });
    try {
      const { store: saved } = await put('/merchant/store', {
        temp_closed: nextClosed,
        reopens_on: nextClosed ? reopensOn || null : null,
        closure_message: nextClosed ? message.trim() || null : null,
      });
      setClosed(nextClosed);
      if (!nextClosed) {
        setReopensOn('');
        setMessage('');
      }
      setState({ busy: false, error: '', fields: {} });
      onSaved(saved, nextClosed ? t('closure.savedClosed') : t('closure.savedOpen'));
    } catch (err) {
      setState({ busy: false, error: err.fields && Object.keys(err.fields).length ? '' : err.message, fields: err.fields || {} });
    }
  };

  const live = Boolean(store.closed_now);
  return (
    <section className={`card space-y-4 p-4 sm:p-6 ${live ? 'border-amber-300 bg-amber-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <DoorClosed size={18} className={live ? 'text-amber-700' : 'text-brand'} /> {t('closure.title')}
          </h2>
          <p className="mt-1 text-sm text-stone-600">{t('closure.hint')}</p>
        </div>
        <label className="relative inline-flex flex-none cursor-pointer items-center" aria-label={t('closure.toggle')}>
          <input type="checkbox" className="peer sr-only" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          <span className="h-7 w-12 rounded-full bg-stone-300 transition peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300" />
          <span className="absolute start-1 top-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
        </label>
      </div>

      {live && (
        <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-amber-900">
          {store.reopens_on ? t('closure.ownerBannerUntil', { date: formatDay(store.reopens_on, { weekday: 'long', day: 'numeric', month: 'long' }) }) : t('closure.ownerBanner')}
        </p>
      )}

      {closed && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tc-reopens">{t('closure.reopensOn')}</label>
            <input id="tc-reopens" type="date" className="input" min={istDate(1)} value={reopensOn} onChange={(e) => setReopensOn(e.target.value)} />
            {state.fields.reopens_on ? (
              <p className="mt-1 text-xs text-rose-600">{state.fields.reopens_on}</p>
            ) : (
              <p className="mt-1 text-[11px] text-stone-400">{t('closure.reopensHint')}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="tc-message">{t('closure.message')}</label>
            <input id="tc-message" className="input" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 200))} placeholder={t('closure.messagePlaceholder')} maxLength={200} />
          </div>
        </div>
      )}

      {state.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>}
      {(closed || live) && (
        <div className="flex flex-wrap gap-2">
          {closed && (
            <button type="button" onClick={() => save(true)} disabled={state.busy} className="btn-brand flex-1">
              {state.busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {live ? t('common.save') : t('closure.closeNow')}
            </button>
          )}
          {live && (
            <button type="button" onClick={() => save(false)} disabled={state.busy} className="btn-ghost flex-1">
              {t('closure.reopenNow')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
