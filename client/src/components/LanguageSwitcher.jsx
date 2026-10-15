import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages, X } from 'lucide-react';
import { useI18n } from '../i18n/index.jsx';
import { LANGUAGES, getLanguage } from '../i18n/languages.js';

/**
 * Language picker: shows the current language in its own script; opens a list of all 23 languages
 * (native name + English name). Bottom sheet on phones, popover on larger screens.
 * `variant="overlay"` is a translucent pill for use on top of the store banner; `variant="compact"` is icon-only.
 */
export default function LanguageSwitcher({ variant = 'default', className = '' }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = getLanguage(lang);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (code) => {
    setLang(code);
    setOpen(false);
  };

  const buttonCls =
    variant === 'overlay'
      ? 'bg-black/40 text-white hover:bg-black/55 backdrop-blur'
      : variant === 'compact'
        ? 'p-2! text-stone-700 hover:bg-stone-100'
        : 'border border-stone-200 bg-white text-stone-700 hover:border-brand';
  const compact = variant === 'compact';

  return (
    // Positioned by the caller (e.g. "absolute top-3 end-3") or relative by default, never both.
    <div className={`${/\b(absolute|fixed|sticky)\b/.test(className) ? '' : 'relative'} ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('lang.choose')}: ${current.english}`}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${buttonCls}`}
      >
        <Languages size={compact ? 20 : 16} />
        {!compact && (
          <>
            <span lang={current.code}>{current.name}</span>
            <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/30 sm:hidden" aria-hidden="true" />
          <div
            className="fixed inset-x-0 bottom-0 z-[71] max-h-[80vh] animate-fade-up overflow-y-auto rounded-t-3xl bg-white p-4 text-stone-800 shadow-2xl sm:absolute sm:inset-x-auto sm:end-0 sm:bottom-auto sm:mt-2 sm:w-[26rem] sm:rounded-2xl sm:border sm:border-stone-200 sm:p-3"
            role="listbox"
            aria-label={t('lang.choose')}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-bold">{t('lang.choose')}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')} className="rounded-full p-1 hover:bg-stone-100 sm:hidden">
                <X size={18} />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {LANGUAGES.map((l) => (
                <li key={l.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={l.code === lang}
                    onClick={() => choose(l.code)}
                    className={`flex w-full items-center justify-between gap-1 rounded-xl px-3 py-2 text-start ${
                      l.code === lang ? 'bg-brand/10 text-brand' : 'hover:bg-stone-100'
                    }`}
                  >
                    <span className="min-w-0">
                      <span lang={l.code} dir={l.dir} className="block truncate text-base font-semibold">
                        {l.name}
                      </span>
                      <span className="block text-[11px] text-stone-500">{l.english}</span>
                    </span>
                    {l.code === lang && <Check size={16} className="flex-none" />}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 px-1 text-[11px] text-stone-400">{t('lang.note')}</p>
          </div>
        </>
      )}
    </div>
  );
}
