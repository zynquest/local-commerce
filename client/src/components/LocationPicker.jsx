import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { useSession } from '../context/SessionContext.jsx';
import { useDebounce } from '../lib/hooks.js';
import { saveLocation } from '../lib/location.js';
import { currentPosition, newSessionToken, placeDetails, reverseGeocode, searchPlaces } from '../lib/maps.js';
import { useT } from '../i18n/index.jsx';

/** Bottom sheet (phones) / dialog: set the shopper's location by GPS or by searching an area, pincode or landmark. */
export default function LocationPicker({ onClose }) {
  const t = useT();
  const { appConfig } = useSession();
  const key = appConfig.mapsKey;
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const token = useRef(null);
  const debounced = useDebounce(q.trim(), 300);

  useEffect(() => {
    if (!key || debounced.length < 2) return setSuggestions([]);
    let alive = true;
    (async () => {
      token.current ??= await newSessionToken(key);
      const list = await searchPlaces(key, debounced, { sessionToken: token.current });
      if (alive) setSuggestions(list);
    })().catch(() => alive && setProblem(t('loc.searchFailed')));
    return () => {
      alive = false;
    };
  }, [debounced, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const useGps = async () => {
    setBusy('gps');
    setProblem('');
    try {
      const pos = await currentPosition();
      let label = t('loc.currentLocation');
      if (key) {
        const r = await reverseGeocode(key, pos).catch(() => null);
        if (r?.area || r?.city) label = [r.area, r.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      }
      saveLocation({ lat: pos.lat, lng: pos.lng, label, source: 'gps' });
      onClose();
    } catch (err) {
      setProblem(err.code === 'denied' ? t('loc.gpsDeniedShopper') : t('loc.gpsFailed'));
    } finally {
      setBusy('');
    }
  };

  const choose = async (s) => {
    setBusy(s.id);
    setProblem('');
    try {
      const d = await placeDetails(s);
      saveLocation({ lat: d.lat, lng: d.lng, label: s.main, source: 'search' });
      onClose();
    } catch {
      setProblem(t('loc.searchFailed'));
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-[71] max-h-[85vh] animate-fade-up overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:top-24 sm:bottom-auto sm:mx-auto sm:w-[28rem] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('loc.pickTitle')}
        dir={document.documentElement.dir || 'ltr'}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <MapPin size={20} className="text-brand" /> {t('loc.pickTitle')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-stone-100" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-sm text-stone-600">{t('loc.pickBody', { km: appConfig.nearbyKm || 5 })}</p>
        <button type="button" onClick={useGps} disabled={Boolean(busy)} className="btn-brand w-full">
          {busy === 'gps' ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />} {t('loc.useMyLocation')}
        </button>
        {key && (
          <>
            <div className="my-3 flex items-center gap-2 text-xs text-stone-400">
              <span className="h-px flex-1 bg-stone-200" /> {t('loc.or')} <span className="h-px flex-1 bg-stone-200" />
            </div>
            <div className="relative">
              <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
              <input maxLength={120}
                className="input ps-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('loc.areaPlaceholder')}
                aria-label={t('loc.areaPlaceholder')}
                autoComplete="off"
                autoFocus
              />
            </div>
            <ul className="mt-2 space-y-1">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => choose(s)} className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-start hover:bg-stone-50">
                    {busy === s.id ? <Loader2 size={14} className="mt-1 flex-none animate-spin" /> : <MapPin size={14} className="mt-1 flex-none text-stone-400" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{s.main}</span>
                      <span className="block truncate text-xs text-stone-500">{s.secondary}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {problem && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
        <p className="mt-3 text-[11px] text-stone-400">{t('loc.privacy')}</p>
      </div>
    </>,
    document.body,
  );
}
