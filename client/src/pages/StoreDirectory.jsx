import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarClock, MapPin, Navigation, Search, Store } from 'lucide-react';
import LocationPicker from '../components/LocationPicker.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useShopperLocation } from '../lib/location.js';
import SmartImage from '../components/SmartImage.jsx';
import { get } from '../lib/api.js';
import { useDebounce } from '../lib/hooks.js';
import { PLATFORM } from '../config.js';
import SiteHeader from '../components/SiteHeader.jsx';
import { useSeo } from '../lib/seo.js';
import { useT } from '../i18n/index.jsx';

/** "Near Indiranagar · within 5 km · Change" — opens the location picker. */
export function NearbyBar({ className = '' }) {
  const t = useT();
  const { appConfig } = useSession();
  const loc = useShopperLocation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm hover:border-brand ${className}`}
      >
        <MapPin size={15} className="flex-none text-brand" />
        <span className="truncate">
          {loc ? t('loc.near', { place: loc.label || t('loc.currentLocation'), km: appConfig.nearbyKm || 5 }) : t('loc.setLocation')}
        </span>
        <span className="flex-none font-semibold text-brand">{loc ? t('loc.change') : ''}</span>
      </button>
      {open && <LocationPicker onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Businesses near the shopper (within appConfig.nearbyKm). Without a location yet, asks for one first —
 * far-away stores aren't useful. Demo stores are always included (labelled) so anyone can try the app.
 */
export function StoreList({ query = '', limit, type = '' }) {
  const t = useT();
  const { appConfig } = useSession();
  const loc = useShopperLocation();
  const [picker, setPicker] = useState(false);
  const [state, setState] = useState({ loading: true, stores: [], error: '' });
  const q = useDebounce(query.trim(), 250);
  const km = appConfig.nearbyKm || 5;

  useEffect(() => {
    if (!loc) return setState({ loading: false, stores: [], error: '' });
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const params = new URLSearchParams({ q, lat: loc.lat.toFixed(5), lng: loc.lng.toFixed(5), ...(type ? { type } : {}) });
    get(`/stores?${params}`)
      .then((r) => !cancelled && setState({ loading: false, stores: r.stores, error: '' }))
      .catch((err) => !cancelled && setState({ loading: false, stores: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [q, loc, type]);

  if (!loc)
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-brand"><MapPin size={24} /></span>
        <p className="font-bold">{t('loc.askTitle')}</p>
        <p className="max-w-md text-sm text-stone-600">{t('loc.askBody', { km })}</p>
        <button type="button" onClick={() => setPicker(true)} className="btn-brand">
          <MapPin size={16} /> {t('loc.setLocation')}
        </button>
        {picker && <LocationPicker onClose={() => setPicker(false)} />}
      </div>
    );

  const all = limit ? state.stores.slice(0, limit) : state.stores;
  const realNearby = state.stores.filter((s) => !s.is_demo).length;
  if (state.error) return <p className="text-center text-sm text-rose-600">{state.error}</p>;

  return (
    <div className="space-y-3">
      {!state.loading && realNearby === 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('loc.noneNearby', { km, place: loc.label || t('loc.currentLocation') })}
        </p>
      )}
      {!state.loading && !all.length && <p className="py-8 text-center text-sm text-stone-500">{t('stores.none')}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((s) => (
          <Link key={s.slug} to={`/s/${s.slug}`} className="card flex min-w-0 gap-3 p-4 transition hover:shadow-md">
            <SmartImage src={s.logo_url} alt={s.name} width={120} className="h-16 w-16 flex-none rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 font-bold">
                <span className="truncate">{s.name}</span>
                {s.verified && <BadgeCheck size={16} className="flex-none fill-sky-500 text-white" />}
                {s.is_demo && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{t('store.demoBadge')}</span>}
                {s.is_seed && <span className="flex-none rounded-full bg-lime-100 px-1.5 py-0.5 text-[10px] font-bold text-lime-800">{t('store.seedBadge')}</span>}
              </p>
              <p className="text-xs text-stone-500">
                {[
                  s.category,
                  s.business_type === 'appointments' ? t('appt.serviceCount', { count: s.product_count }) : t('stores.productCount', { count: s.product_count }),
                ].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
                {s.distance_km != null && (
                  <span className="flex items-center gap-1 font-semibold text-brand">
                    <Navigation size={11} /> <span dir="ltr">{s.distance_km < 0.1 ? `<${t('loc.km', { km: 0.1 })}` : t('loc.km', { km: s.distance_km })}</span>
                  </span>
                )}
                {(s.locality || s.city) && <span className="flex items-center gap-1"><MapPin size={12} /> {[s.locality, s.city].filter(Boolean).join(', ')}</span>}
                {s.business_type === 'appointments' && (
                  <span className="flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                    <CalendarClock size={11} /> {t('appt.badge')}
                  </span>
                )}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const TYPES = ['', 'shop', 'appointments'];

export default function StoreDirectory() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  useSeo({
    title: t('seo.storesTitle', { brand: PLATFORM.name }),
    description: t('seo.storesDesc'),
    path: '/stores',
    localized: true,
  });
  return (
    <>
    <SiteHeader />
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold">
        <Store className="text-brand" /> {t('stores.title')}
      </h1>
      <p className="text-sm text-stone-600">{t('stores.subtitle')}</p>
      <NearbyBar className="mt-3" />
      <label className="relative mt-3 block">
        <Search size={18} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
        <input className="input ps-10" placeholder={t('stores.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {TYPES.map((ty) => (
          <button
            key={ty || 'all'}
            type="button"
            onClick={() => setType(ty)}
            className={`flex-none rounded-full border px-3 py-1.5 text-sm font-semibold ${type === ty ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-700'}`}
          >
            {t(`loc.type.${ty || 'all'}`)}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <StoreList query={query} type={type} />
      </div>
    </div>
    </>
  );
}
