import { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { useSession } from '../context/SessionContext.jsx';
import { useDebounce } from '../lib/hooks.js';
import { currentPosition, loadGoogleMaps, mapsUrlFor, newSessionToken, placeDetails, reverseGeocode, searchPlaces } from '../lib/maps.js';
import { useT } from '../i18n/index.jsx';

/** Small Google map with a draggable pin to fine-tune the exact shop entrance. */
function PinMap({ mapsKey, mapId, lat, lng, onMove }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    let alive = true;
    (async () => {
      const maps = await loadGoogleMaps(mapsKey);
      const { Map } = await maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await maps.importLibrary('marker');
      if (!alive || !el.current) return;
      if (!map.current) {
        map.current = new Map(el.current, { center: { lat, lng }, zoom: 17, mapId, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative' });
        marker.current = new AdvancedMarkerElement({ map: map.current, position: { lat, lng }, gmpDraggable: true });
        marker.current.addListener('dragend', () => {
          const p = marker.current.position;
          const pos = typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : p;
          onMoveRef.current(pos);
        });
      } else {
        marker.current.position = { lat, lng };
        map.current.panTo({ lat, lng });
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [mapsKey, mapId, lat, lng]);

  return <div ref={el} className="h-48 w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100" />;
}

/**
 * Store location for merchants: Google Maps address search (India), "use my current location", a draggable pin,
 * plus the editable address text (shop number, landmark). `value` holds address_text, city, lat, lng, place_id;
 * `onChange(patch)` receives changed fields (maps_url is kept in sync with the pin).
 */
export default function AddressPicker({ value, onChange, error }) {
  const t = useT();
  const { appConfig } = useSession();
  const key = appConfig.mapsKey;
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const token = useRef(null);
  const debounced = useDebounce(q.trim(), 300);
  const hasPin = value.lat != null && value.lng != null;

  useEffect(() => {
    if (!key || debounced.length < 3) return setSuggestions([]);
    let alive = true;
    (async () => {
      token.current ??= await newSessionToken(key);
      const near = hasPin ? { lat: value.lat, lng: value.lng } : undefined;
      const list = await searchPlaces(key, debounced, { sessionToken: token.current, near });
      if (alive) setSuggestions(list);
    })().catch(() => alive && setProblem(t('loc.searchFailed')));
    return () => {
      alive = false;
    };
  }, [debounced, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (s) => {
    setBusy('place');
    setProblem('');
    try {
      const d = await placeDetails(s);
      token.current = null; // a session ends with a details request
      // Keep the business name out of the street address when Google returns "Shop name, street…".
      onChange({ address_text: d.address, city: d.city || value.city, lat: d.lat, lng: d.lng, place_id: d.placeId, maps_url: mapsUrlFor(d) });
      setQ('');
      setSuggestions([]);
    } catch {
      setProblem(t('loc.searchFailed'));
    } finally {
      setBusy('');
    }
  };

  const useGps = async () => {
    setBusy('gps');
    setProblem('');
    try {
      const pos = await currentPosition();
      const patch = { lat: pos.lat, lng: pos.lng, place_id: null, maps_url: mapsUrlFor(pos) };
      if (key) {
        const r = await reverseGeocode(key, pos).catch(() => null);
        if (r?.address && !value.address_text) patch.address_text = r.address;
        if (r?.city && !value.city) patch.city = r.city;
      }
      onChange(patch);
    } catch (err) {
      setProblem(err.code === 'denied' ? t('loc.gpsDenied') : t('loc.gpsFailed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 p-4">
      <p className="label mb-0 flex items-center gap-1">
        <MapPin size={14} className="text-brand" /> {t('loc.title')} <span className="text-rose-500">*</span>
      </p>
      <p className="text-[11px] text-stone-500">{t('loc.why')}</p>

      {key ? (
        <div className="relative">
          <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
          <input maxLength={120}
            className="input ps-9 pe-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('loc.searchPlaceholder')}
            aria-label={t('loc.searchPlaceholder')}
            autoComplete="off"
          />
          {busy === 'place' ? (
            <Loader2 size={16} className="absolute top-1/2 end-3 -translate-y-1/2 animate-spin text-stone-400" />
          ) : (
            q && (
              <button type="button" onClick={() => setQ('')} className="absolute top-1/2 end-2 -translate-y-1/2 p-1 text-stone-400" aria-label={t('common.clearSearch')}>
                <X size={14} />
              </button>
            )
          )}
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg" role="listbox">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => choose(s)} className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-stone-50">
                    <MapPin size={14} className="mt-1 flex-none text-stone-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{s.main}</span>
                      <span className="block truncate text-xs text-stone-500">{s.secondary}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="px-3 py-1.5 text-end text-[10px] text-stone-400">Google</li>
            </ul>
          )}
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t('loc.noGoogle')}</p>
      )}

      <button type="button" onClick={useGps} disabled={Boolean(busy)} className="btn-ghost w-full py-2 text-sm">
        {busy === 'gps' ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />} {t('loc.useGps')}
      </button>

      {hasPin && key && (
        <>
          <PinMap
            mapsKey={key}
            mapId={appConfig.mapId}
            lat={value.lat}
            lng={value.lng}
            onMove={(pos) => onChange({ ...pos, place_id: null, maps_url: mapsUrlFor(pos) })}
          />
          <p className="text-[11px] text-stone-500">{t('loc.dragHint')}</p>
        </>
      )}
      <p className={`text-xs ${hasPin ? 'text-emerald-700' : 'text-stone-500'}`} data-testid="pin-status">
        {hasPin ? t('loc.pinSet', { coords: `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` }) : t('loc.noPin')}
      </p>

      <div>
        <label className="label" htmlFor="st-address_text">{t('loc.address')}</label>
        <textarea
          id="st-address_text"
          className="input min-h-20"
          value={value.address_text || ''}
          maxLength={300}
          onChange={(e) => onChange({ address_text: e.target.value })}
          placeholder={t('loc.addressPlaceholder')}
        />
        <p className="mt-1 text-[11px] text-stone-400">{t('loc.addressHint')}</p>
      </div>
      {(problem || error) && <p className="text-xs text-rose-600">{problem || error}</p>}
    </div>
  );
}
