import { useState } from 'react';
import { Circle, Clock, History, Loader2, MessageSquareWarning, ShieldCheck, ShieldOff } from 'lucide-react';
import { post } from '../lib/api.js';
import { useI18n, useT } from '../i18n/index.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { PLATFORM } from '../config.js';
import { whatsappLink } from '../services/whatsappService.js';

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
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs leading-tight font-bold max-w-full ${meta.cls}`}>
      <Icon size={12} className="flex-none" />
      <span>{t(`review.status.${STORE_STATUS[status] ? status : 'draft'}`)}</span>
    </span>
  );
}

const national = (n) => (n ? String(n).replace(/^91(?=\d{10}$)/, '') : '');

function ReviewHistory({ reviews }) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  if (!reviews?.length) return null;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs font-semibold text-stone-600">
        <History size={14} /> {open ? t('review.hideHistory', { count: reviews.length }) : t('review.showHistory', { count: reviews.length })}
      </button>
      {open && (
        <ol className="mt-2 space-y-2 border-s-2 border-stone-200 ps-3 text-xs">
          {reviews.map((r, i) => (
            <li key={i}>
              <p className="font-semibold">{t(`review.action.${r.action}`)}</p>
              <p className="text-stone-500">{formatDate(r.created_at)}</p>
              {r.remarks && <p className="mt-0.5 whitespace-pre-line text-stone-700">“{r.remarks}”</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The store's review state once setup is done (the setup steps handle drafts and requested changes):
 * waiting for approval, suspended (with the team's remarks and a resubmit button), or approved with remarks.
 */
export default function StoreStatusCard({ store, onChange }) {
  const { t, formatDate } = useI18n();
  const { owner } = useSession();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const approvalLink = (s) =>
    whatsappLink(
      PLATFORM.whatsappNumber,
      t('review.waApprovalMsg', { brand: PLATFORM.name, name: s.name, link: `${window.location.origin}/s/${s.slug}`, phone: `+91 ${national(s.whatsapp_number)}`, email: owner?.email || '—' }),
    );

  if (store.status === 'pending_review') {
    const appt = store.business_type === 'appointments';
    return (
      <section className="card space-y-3 border-amber-200 bg-amber-50 p-4" aria-label={t('review.title')}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Clock size={20} />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="font-bold text-amber-950">{t('review.status.pending_review')}</h2>
            <p className="text-sm text-amber-900">
              {t(appt ? 'setup.pendingBodyAppt' : 'review.pendingBody', { date: store.submitted_at ? formatDate(store.submitted_at) : '' })}
            </p>
            <p className="text-xs text-amber-800">{t('setup.afterApproval')}</p>
          </div>
        </div>
        {store.whatsapp_number && !store.whatsapp_verified && (
          <a href={approvalLink(store)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 underline">
            <WhatsAppIcon size={14} /> {t('review.sendAgain')}
          </a>
        )}
      </section>
    );
  }

  if (store.status === 'suspended') {
    const resubmit = async () => {
      const win = window.open('', '_blank');
      setBusy(true);
      setError('');
      try {
        const { store: updated } = await post('/merchant/store/submit', { note: note || undefined });
        setNote('');
        onChange(updated);
        if (win) {
          win.opener = null;
          win.location.href = approvalLink(updated);
        }
      } catch (err) {
        win?.close();
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    return (
      <section className="card space-y-3 border-rose-200 bg-rose-50 p-4" aria-label={t('review.title')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{t('review.title')}</h2>
          <StatusPill status={store.status} />
        </div>
        {store.review_remarks && (
          <div className="rounded-xl bg-white p-3 text-sm">
            <p className="text-[11px] font-bold tracking-wide text-stone-500 uppercase">{t('review.remarks')}</p>
            <p className="mt-1 whitespace-pre-line text-stone-800">{store.review_remarks}</p>
          </div>
        )}
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={t('review.notePlaceholderResubmit')} />
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button onClick={resubmit} disabled={busy} className="btn-brand w-full">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <WhatsAppIcon size={16} />} {t('review.resubmit')}
        </button>
        <ReviewHistory reviews={store.reviews} />
      </section>
    );
  }

  if (store.status === 'approved' && store.review_remarks) {
    return (
      <section className="card space-y-2 border-emerald-200 bg-emerald-50 p-4 text-sm" aria-label={t('review.title')}>
        <p className="text-[11px] font-bold tracking-wide text-emerald-800 uppercase">{t('review.remarks')}</p>
        <p className="whitespace-pre-line text-stone-800">{store.review_remarks}</p>
        <ReviewHistory reviews={store.reviews} />
      </section>
    );
  }
  return null;
}
