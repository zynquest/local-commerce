import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, MessageSquareText, RefreshCw, SearchCheck, Sparkles } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { post } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { rich, useT } from '../i18n/index.jsx';

const EXAMPLE = `Green Apple 4 pc
200
100
Tomatoes
30
28

Milk,25,21|Wheat Flour,71,69`;

const STATUS_STYLE = {
  created: 'border-emerald-200 bg-emerald-50',
  updated: 'border-sky-200 bg-sky-50',
  failed: 'border-rose-300 bg-rose-50',
};

/**
 * Create products by pasting a product list from WhatsApp. Two formats (mixable):
 *   "Name⏎MRP⏎List price" (three lines per product) or "Name,MRP,List price|Name,MRP,List price".
 * The server parses each product independently; failed ones are listed with the reason and left in the box to fix.
 */
export default function MessageImport({ onCreated, defaultOpen = false, currency = '₹' }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'check' | 'create'
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const send = async (dryRun) => {
    setBusy(dryRun ? 'check' : 'create');
    setError('');
    try {
      const r = await post('/merchant/products/from-message', { text, dryRun });
      setReport(r);
      if (!dryRun) {
        // Keep only what failed in the box so it can be fixed and sent again.
        const failed = r.results.filter((x) => x.status === 'failed');
        setText(failed.map((x) => x.source).join('\n'));
        if (r.summary.created || r.summary.updated) onCreated?.(r.summary);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const reason = (r) => t(`msgimp.e.${r.error}`, r.params || {});
  const lineLabel = ([a, b]) => (a === b ? t('msgimp.line', { n: a }) : t('msgimp.lines', { a, b }));

  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-start" aria-expanded={open}>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-emerald-100 text-whatsapp">
          <WhatsAppIcon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{t('msgimp.title')}</span>
          <span className="block text-xs text-stone-500">{t('msgimp.teaser')}</span>
        </span>
        <ChevronDown size={18} className={`flex-none text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-stone-100 p-4">
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="font-semibold">{t('msgimp.format1')}</p>
              <p className="mt-0.5 text-stone-500">{t('msgimp.format1Body')}</p>
              <pre className="mt-2 rounded-lg bg-white p-2 font-mono text-[11px] leading-relaxed text-stone-700" dir="ltr">{'Green Apple 4 pc\n200\n100'}</pre>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="font-semibold">{t('msgimp.format2')}</p>
              <p className="mt-0.5 text-stone-500">{rich(t('msgimp.format2Body'), { b: (x) => <b className="font-mono">{x}</b> })}</p>
              <pre className="mt-2 rounded-lg bg-white p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-stone-700" dir="ltr">{'Milk,25,21|Wheat Flour,71,69'}</pre>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="msg-import" className="label mb-0">{t('msgimp.boxLabel')}</label>
              <button type="button" onClick={() => setText(EXAMPLE)} className="flex items-center gap-1 text-xs font-semibold text-brand">
                <Sparkles size={12} /> {t('msgimp.tryExample')}
              </button>
            </div>
            <textarea
              id="msg-import"
              className="input min-h-40 font-mono text-sm leading-relaxed"
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={EXAMPLE}
              maxLength={20000}
              spellCheck={false}
            />
            <p className="mt-1 text-[11px] text-stone-400">{t('msgimp.hint')}</p>
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => send(true)} disabled={!text.trim() || Boolean(busy)} className="btn-ghost flex-1">
              {busy === 'check' ? <Loader2 size={16} className="animate-spin" /> : <SearchCheck size={16} />} {t('msgimp.check')}
            </button>
            <button type="button" onClick={() => send(false)} disabled={!text.trim() || Boolean(busy)} className="btn-brand flex-[2]">
              {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareText size={16} />} {t('msgimp.create')}
            </button>
          </div>

          {report && (
            <div className="space-y-2" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {report.dryRun && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{t('msgimp.preview')}</span>}
                <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
                  {t(report.dryRun ? 'msgimp.willCreate' : 'msgimp.created', { count: report.summary.created })}
                </span>
                {report.summary.updated > 0 && (
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">
                    {t(report.dryRun ? 'msgimp.willUpdate' : 'msgimp.updated', { count: report.summary.updated })}
                  </span>
                )}
                {report.summary.failed > 0 && (
                  <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-700">{t('msgimp.failed', { count: report.summary.failed })}</span>
                )}
              </div>
              {!report.dryRun && report.summary.failed > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <RefreshCw size={14} className="mt-0.5 flex-none" /> {t('msgimp.fixAndResend')}
                </p>
              )}
              <ol className="max-h-[28rem] space-y-1.5 overflow-y-auto">
                {report.results.map((r) => (
                  <li key={r.index} className={`rounded-xl border p-2.5 text-xs ${STATUS_STYLE[r.status]}`} data-status={r.status}>
                    <div className="flex items-start gap-2">
                      {r.status === 'failed' ? (
                        <AlertTriangle size={14} className="mt-0.5 flex-none text-rose-600" />
                      ) : (
                        <CheckCircle2 size={14} className={`mt-0.5 flex-none ${r.status === 'updated' ? 'text-sky-600' : 'text-emerald-600'}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="font-semibold">
                            {t('msgimp.item', { n: r.index })}
                            {r.name && <> · {r.name}</>}
                          </span>
                          <span className="text-[10px] text-stone-500">{lineLabel(r.lines)}</span>
                        </p>
                        {r.status === 'failed' ? (
                          <>
                            <pre className="mt-1 overflow-x-auto rounded-md bg-white/70 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-rose-900 ring-1 ring-rose-200" dir="auto">{r.source}</pre>
                            <p className="mt-1 font-semibold text-rose-700">{reason(r)}</p>
                          </>
                        ) : (
                          <p className="mt-0.5 text-stone-600">
                            {t('msgimp.prices', { mrp: formatMoney(r.mrp, currency), list: formatMoney(r.list_price, currency) })}
                            {r.status === 'updated' && <span className="ms-1 font-semibold text-sky-700">· {t('msgimp.priceUpdated')}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
