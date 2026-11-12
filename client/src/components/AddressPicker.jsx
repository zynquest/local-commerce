import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Loader2, Map as MapIcon, MapPin, Search, X } from 'lucide-react';
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

/** Where the full map opens when the store has no pin yet: the whole of India. */
const INDIA = { lat: 22.6, lng: 79.0 };

/** Address search on Google Maps (India), shared by the inline box and the full-screen map. */
function usePlaceSearch(mapsKey, q, near, onError) {
  const [suggestions, setSuggestions] = useState([]);
  const token = useRef(null);
  const debounced = useDebounce(q.trim(), 300);
  useEffect(() => {
    if (!mapsKey || debounced.length < 3) return setSuggestions([]);
    let alive = true;
    (async () => {
      token.current ??= await newSessionToken(mapsKey);
      const list = await searchPlaces(mapsKey, debounced, { sessionToken: token.current, near });
      if (alive) setSuggestions(list);
    })().catch(() => alive && onError());
    return () => {
      alive = false;
    };
  }, [debounced, mapsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const endSession = () => {
    token.current = null; // a session ends with a details request
    setSuggestions([]);
  };
  return [suggestions, endSession];
}

/**
 * Full-screen Google map to pick the shop's spot: search a place, tap the map or drag the pin. "Use this location"
 * returns { lat, lng, place } (place: the searched place's details, or null when the pin was placed by hand).
 */
function MapPicker({ mapsKey, mapId, start, onPick, onClose }) {
  const t = useT();
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const [pin, setPin] = useState(start);
  const [place, setPlace] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [suggestions, endSession] = usePlaceSearch(mapsKey, q, pin || undefined, () => setProblem(t('loc.searchFailed')));

  // Moves the pin; `focus` also brings the map to it (search and GPS jump there, a tap or drag doesn't).
  const placePin = (pos, focus = false) => {
    setPin(pos);
    if (marker.current) {
      marker.current.position = pos;
      marker.current.map = map.current;
    }
    if (focus && map.current) {
      map.current.panTo(pos);
      map.current.setZoom(18);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const maps = await loadGoogleMaps(mapsKey);
      const { Map } = await maps.importLibrary('maps');
      const { AdvancedMarkerElement } = await maps.importLibrary('marker');
      if (!alive || !el.current) return;
      map.current = new Map(el.current, {
        center: start || INDIA,
        zoom: start ? 18 : 5,
        mapId,
        gestureHandling: 'greedy',
        clickableIcons: false,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: true,
        mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
      });
      // No pin yet: the marker appears with the first tap, search or GPS fix.
      marker.current = new AdvancedMarkerElement({ map: start ? map.current : null, position: start || INDIA, gmpDraggable: true });
      marker.current.addListener('dragend', () => {
        const p = marker.current.position;
        setPin(typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng });
        setPlace(null);
      });
      map.current.addListener('click', (e) => {
        if (!e.latLng) return;
        placePin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setPlace(null);
      });
    })().catch(() => alive && setProblem(t('loc.searchFailed')));
    return () => {
      alive = false;
    };
  }, [mapsKey, mapId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const choose = async (s) => {
    setBusy('place');
    setProblem('');
    try {
      const d = await placeDetails(s);
      endSession();
      setQ('');
      setPlace(d);
      placePin({ lat: d.lat, lng: d.lng }, true);
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
      setPlace(null);
      placePin({ lat: pos.lat, lng: pos.lng }, true);
    } catch (err) {
      setProblem(err.code === 'denied' ? t('loc.gpsDenied') : t('loc.gpsFailed'));
    } finally {
      setBusy('');
    }
  };

  const confirm = async () => {
    setBusy('confirm');
    try {
      await onPick({ ...pin, place });
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={t('loc.title')} dir={document.documentElement.dir || 'ltr'}>
      <div className="flex items-center gap-2 border-b border-stone-200 p-3">
        <button type="button" onClick={onClose} className="flex-none rounded-full p-2 hover:bg-stone-100" aria-label={t('common.close')}>
          <X size={20} />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
          <input
            maxLength={120}
            className="input ps-9 pe-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('loc.searchPlaceholder')}
            aria-label={t('loc.searchPlaceholder')}
            autoComplete="off"
            autoFocus
          />
          {busy === 'place' && <Loader2 size={16} className="absolute top-1/2 end-3 -translate-y-1/2 animate-spin text-stone-400" />}
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg" role="listbox">
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
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={el} className="h-full w-full bg-stone-100" data-testid="map-picker" />
        <button
          type="button"
          onClick={useGps}
          disabled={Boolean(busy)}
          className="absolute end-3 bottom-6 flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-700 shadow-md ring-1 ring-stone-200"
          aria-label={t('loc.useMyLocation')}
          title={t('loc.useMyLocation')}
        >
          {busy === 'gps' ? <Loader2 size={18} className="animate-spin" /> : <Crosshair size={18} />}
        </button>
      </div>
      <div className="space-y-2 border-t border-stone-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {pin && <p className="text-sm font-semibold break-words text-emerald-800">{place?.address || t('loc.pinSet', { coords: `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` })}</p>}
        <p className="text-xs text-stone-500">{t('loc.mapHint')}</p>
        {problem && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{problem}</p>}
        <button type="button" onClick={confirm} disabled={!pin || Boolean(busy)} className="btn-brand w-full">
          {busy === 'confirm' ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />} {t('loc.confirmPin')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Store location for merchants: Google Maps address search (India), a full-screen map to search and pin the spot
 * (or "use my current location" when Google Maps isn't set up), a draggable pin,
 * plus the editable address text (shop number, landmark). `value` holds address_text, city, lat, lng, place_id;
 * `onChange(patch)` receives changed fields (maps_url is kept in sync with the pin).
 */
export default function AddressPicker({ value, onChange, error }) {
  const t = useT();
  const { appConfig } = useSession();
  const key = appConfig.mapsKey;
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const hasPin = value.lat != null && value.lng != null;
  const [suggestions, endSession] = usePlaceSearch(key, q, hasPin ? { lat: value.lat, lng: value.lng } : undefined, () => setProblem(t('loc.searchFailed')));

  const choose = async (s) => {
    setBusy('place');
    setProblem('');
    try {
      const d = await placeDetails(s);
      endSession();
      // Keep the business name out of the street address when Google returns "Shop name, street…".
      onChange({ address_text: d.address, city: d.city || value.city, lat: d.lat, lng: d.lng, place_id: d.placeId, maps_url: mapsUrlFor(d) });
      setQ('');
    } catch {
      setProblem(t('loc.searchFailed'));
    } finally {
      setBusy('');
    }
  };

  // From the full map: a searched place brings its address; a pin placed by hand fills only an empty address/city.
  const fromMap = async ({ lat, lng, place }) => {
    if (place) {
      onChange({ address_text: place.address, city: place.city || value.city, lat, lng, place_id: place.placeId, maps_url: mapsUrlFor({ lat, lng, placeId: place.placeId }) });
    } else {
      const patch = { lat, lng, place_id: null, maps_url: mapsUrlFor({ lat, lng }) };
      if (!value.address_text || !value.city) {
        const r = await reverseGeocode(key, { lat, lng }).catch(() => null);
        if (r?.address && !value.address_text) patch.address_text = r.address;
        if (r?.city && !value.city) patch.city = r.city;
      }
      onChange(patch);
    }
    setMapOpen(false);
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

      {key ? (
        <button type="button" onClick={() => setMapOpen(true)} disabled={Boolean(busy)} className="btn-ghost w-full py-2 text-sm">
          <MapIcon size={16} /> {t('loc.pickOnMap')}
        </button>
      ) : (
        // Without Google Maps the device's GPS is the only way to set the pin.
        <button type="button" onClick={useGps} disabled={Boolean(busy)} className="btn-ghost w-full py-2 text-sm">
          {busy === 'gps' ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />} {t('loc.useGps')}
        </button>
      )}
      {mapOpen && (
        <MapPicker mapsKey={key} mapId={appConfig.mapId} start={hasPin ? { lat: value.lat, lng: value.lng } : null} onPick={fromMap} onClose={() => setMapOpen(false)} />
      )}

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
