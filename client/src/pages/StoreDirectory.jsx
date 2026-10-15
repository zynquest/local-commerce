import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, MapPin, Search, Store } from 'lucide-react';
import SmartImage from '../components/SmartImage.jsx';
import { get } from '../lib/api.js';
import { useDebounce } from '../lib/hooks.js';
import { PLATFORM } from '../config.js';
import SiteHeader from '../components/SiteHeader.jsx';
import { useSeo } from '../lib/seo.js';
import { useT } from '../i18n/index.jsx';

/** Directory of all local stores on the platform that accept WhatsApp orders. */
export function StoreList({ query = '', limit }) {
  const t = useT();
  const [state, setState] = useState({ loading: true, stores: [], error: '' });
  const q = useDebounce(query.trim(), 250);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    get(`/stores?q=${encodeURIComponent(q)}`)
      .then((r) => !cancelled && setState({ loading: false, stores: r.stores, error: '' }))
      .catch((err) => !cancelled && setState({ loading: false, stores: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [q]);

  const stores = limit ? state.stores.slice(0, limit) : state.stores;
  if (state.error) return <p className="text-center text-sm text-rose-600">{state.error}</p>;
  if (!state.loading && !stores.length) return <p className="py-8 text-center text-sm text-stone-500">{t('stores.none')}</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stores.map((s) => (
        <Link key={s.slug} to={`/s/${s.slug}`} className="card flex gap-3 p-4 transition hover:shadow-md">
          <SmartImage src={s.logo_url} alt={s.name} width={120} className="h-16 w-16 flex-none rounded-xl object-cover" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-bold">
              <span className="truncate">{s.name}</span>
              {s.verified && <BadgeCheck size={16} className="flex-none fill-sky-500 text-white" />}
              {s.is_demo && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{t('store.demoBadge')}</span>}
            </p>
            <p className="text-xs text-stone-500">
              {[s.category, t('stores.productCount', { count: s.product_count })].filter(Boolean).join(' · ')}
            </p>
            {s.city && (
              <p className="mt-1 flex items-center gap-1 text-xs text-stone-500">
                <MapPin size={12} /> {s.city}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function StoreDirectory() {
  const t = useT();
  const [query, setQuery] = useState('');
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
      <label className="relative mt-4 block">
        <Search size={18} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
        <input className="input ps-10" placeholder={t('stores.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="mt-5">
        <StoreList query={query} />
      </div>
    </div>
    </>
  );
}
