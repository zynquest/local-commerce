import { useState } from 'react';
import { CheckCircle2, Circle, Clock, History, Loader2, MessageSquareWarning, Send, ShieldCheck, ShieldOff } from 'lucide-react';
import { post } from '../lib/api.js';
import { useI18n, useT } from '../i18n/index.jsx';

// Labels come from the locale files: review.status.<status> and review.action.<action>.
export const STORE_STATUS = {
  draft: { cls: 'bg-stone-200 text-stone-700', icon: Circle },
  pending_review: { cls: 'bg-amber-100 text-amber-800', icon: Clock },
  approved: { cls: 'bg-emerald-100 text-emerald-800', icon: ShieldCheck },
  rejected: { cls: 'bg-rose-100 text-rose-800', icon: MessageSquareWarning },
  suspended: { cls: 'bg-rose-100 text-rose-800', icon: ShieldOff },
};

export function StatusPill({ status }) {
  const t = useT();
  const meta = STORE_STATUS[status] || STORE_STATUS.draft;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${meta.cls}`}>
      <Icon size={12} /> {t(`review.status.${STORE_STATUS[status] ? status : 'draft'}`)}
    </span>
  );
}

/** Approval status, reviewer remarks, checklist and (re)submit action for the store owner. */
export default function StoreStatusCard({ store, onChange, onGoToSettings }) {
  const { t, formatDate } = useI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  if (store.status === 'approved' && !store.review_remarks) return null; // nothing to act on

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { store: updated } = await post('/merchant/store/submit', { note: note || undefined });
      setNote('');
      onChange(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const allDone = store.checklist.every((c) => c.done);
  const isResubmit = store.status === 'rejected' || store.status === 'suspended';
  const tone =
    store.status === 'rejected' || store.status === 'suspended'
      ? 'border-rose-200 bg-rose-50'
      : store.status === 'pending_review'
        ? 'border-amber-200 bg-amber-50'
        : store.status === 'approved'
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-sky-200 bg-sky-50';

  return (
    <section className={`card space-y-3 p-4 ${tone}`} aria-label={t('review.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{t('review.title')}</h2>
        <StatusPill status={store.status} />
      </div>

      {store.status === 'draft' && (
        <p className="text-sm text-stone-700">
          {t('review.draftBody')}
        </p>
      )}
      {store.status === 'pending_review' && (
        <p className="text-sm text-amber-900">
          {t('review.pendingBody', { date: store.submitted_at ? formatDate(store.submitted_at) : '' })}
        </p>
      )}
      {store.review_remarks && store.status !== 'pending_review' && (
        <div className="rounded-xl bg-white p-3 text-sm">
          <p className="text-[11px] font-bold tracking-wide text-stone-500 uppercase">{t('review.remarks')}</p>
          <p className="mt-1 whitespace-pre-line text-stone-800">{store.review_remarks}</p>
        </div>
      )}

      {store.can_submit && (
        <>
          <ul className="space-y-1 text-sm">
            {store.checklist.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                {c.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-stone-400" />}
                <span className={c.done ? 'text-stone-600' : 'font-medium'}>{t(`review.check.${c.key}`, { count: c.key === 'products' ? 1 : undefined })}</span>
                {!c.done && c.key !== 'products' && (
                  <button onClick={onGoToSettings} className="text-xs font-semibold text-brand underline">{t('common.add')}</button>
                )}
              </li>
            ))}
          </ul>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder={isResubmit ? t('review.notePlaceholderResubmit') : t('review.notePlaceholder')}
          />
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <button onClick={submit} disabled={busy || !allDone} className="btn-brand w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {isResubmit ? t('review.resubmit') : t('review.submit')}
          </button>
        </>
      )}

      {store.reviews?.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1 text-xs font-semibold text-stone-600">
            <History size={14} /> {showHistory ? t('review.hideHistory', { count: store.reviews.length }) : t('review.showHistory', { count: store.reviews.length })}
          </button>
          {showHistory && (
            <ol className="mt-2 space-y-2 border-l-2 border-stone-200 ps-3 text-xs">
              {store.reviews.map((r, i) => (
                <li key={i}>
                  <p className="font-semibold">{t(`review.action.${r.action}`)}</p>
                  <p className="text-stone-500">{formatDate(r.created_at)}</p>
                  {r.remarks && <p className="mt-0.5 whitespace-pre-line text-stone-700">“{r.remarks}”</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
