// Minimal i18n: English is bundled; other languages are code-split JSON chunks loaded on demand
// (precached by the service worker, so switching works offline once the app is installed).
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './locales/en.json';
import { DEFAULT_LANGUAGE, getLanguage, intlLocale, isLanguage } from './languages.js';

const loaders = import.meta.glob(['./locales/*.json', '!./locales/en.json']);
const catalogs = { en };
const STORAGE_KEY = 'lang';

export async function loadCatalog(code) {
  if (catalogs[code]) return catalogs[code];
  const loader = loaders[`./locales/${code}.json`];
  if (!loader) return en;
  const mod = await loader();
  catalogs[code] = mod.default || mod;
  return catalogs[code];
}

const lookup = (catalog, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), catalog);
const pluralRules = {};

/** Builds a translate function for a language whose catalog is already loaded (falls back to English). */
export function makeT(code) {
  const catalog = catalogs[code] || en;
  pluralRules[code] ??= new Intl.PluralRules(intlLocale(code));
  return function t(key, vars) {
    let msg;
    if (vars && typeof vars.count === 'number') {
      const form = pluralRules[code].select(vars.count);
      msg = lookup(catalog, `${key}_${form}`) ?? lookup(catalog, `${key}_other`) ?? lookup(en, `${key}_${form}`) ?? lookup(en, `${key}_other`);
    }
    msg ??= lookup(catalog, key) ?? lookup(en, key);
    if (typeof msg !== 'string') {
      if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
    return vars ? msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : msg;
  };
}

/**
 * Renders a message containing simple tags, e.g. "Tap <b>Send</b> in WhatsApp", mapping each tag to a component:
 *   rich(t('cart.tapSend'), { b: (text) => <b>{text}</b> })
 */
export function rich(message, components) {
  const parts = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m;
  while ((m = re.exec(message))) {
    if (m.index > last) parts.push(message.slice(last, m.index));
    const render = components[m[1]];
    parts.push(<Fragment key={m.index}>{render ? render(m[2]) : m[2]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < message.length) parts.push(message.slice(last));
  return parts;
}

function detectLanguage() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLanguage(fromUrl)) return fromUrl;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* storage disabled */
  }
  for (const pref of navigator.languages || [navigator.language]) {
    const base = String(pref || '').toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

// Translator for non-React modules (e.g. the API client translating server error messages).
let activeT = makeT(DEFAULT_LANGUAGE);
export const getActiveT = () => activeT;

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage);
  const [ready, setReady] = useState(() => Boolean(catalogs[lang]));

  useEffect(() => {
    let cancelled = false;
    if (!catalogs[lang]) setReady(false);
    loadCatalog(lang).then(() => !cancelled && setReady(true));
    const meta = getLanguage(lang);
    document.documentElement.lang = lang === 'en' ? 'en-IN' : lang;
    document.documentElement.dir = meta.dir;
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!isLanguage(code)) return;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
    // Keep the URL shareable in the chosen language (and indexable via ?lang=).
    const url = new URL(window.location.href);
    if (code === DEFAULT_LANGUAGE) url.searchParams.delete('lang');
    else url.searchParams.set('lang', code);
    window.history.replaceState(window.history.state, '', url);
    setLangState(code);
  }, []);

  const value = useMemo(() => {
    const active = ready ? lang : DEFAULT_LANGUAGE;
    const locale = intlLocale(active);
    activeT = makeT(active);
    return {
      lang,
      dir: getLanguage(lang).dir,
      ready,
      setLang,
      t: activeT,
      locale,
      formatDate: (d, opts = { dateStyle: 'medium', timeStyle: 'short' }) => new Intl.DateTimeFormat(locale, opts).format(new Date(d)),
      formatTime: (d) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
      // Appointment helpers. Day keys: 'sun' … 'sat'; dates "YYYY-MM-DD" and times "HH:MM" are shop-local (IST).
      dayName: (day, style = 'long') =>
        new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
          new Date(Date.UTC(2026, 9, 18 + ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day))),
        ),
      formatDay: (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
      formatClock: (hhmm) =>
        new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2026-01-01T${hhmm}:00Z`)),
    };
  }, [lang, ready, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export const useT = () => useI18n().t;
