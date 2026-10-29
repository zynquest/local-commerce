import { useMemo, useState } from 'react';
import { PackageSearch, RefreshCw, Search, ShoppingBag, X } from 'lucide-react';
import StoreHeader from '../components/StoreHeader.jsx';
import StoreFooter from '../components/StoreFooter.jsx';
import ProductCard from '../components/ProductCard.jsx';
import UnlistedItemsBox from '../components/UnlistedItemsBox.jsx';
import FloatingActions from '../components/FloatingActions.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useDebounce } from '../lib/hooks.js';
import { useSeo } from '../lib/seo.js';
import { rich, useI18n } from '../i18n/index.jsx';

const ALL = '__all__'; // sentinel; displayed via t('store.all')

function matches(product, terms) {
  const hay = `${product.name} ${product.category} ${(product.tags || []).join(' ')} ${product.description}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Storefront: header, debounced search, category/tag pills, product grid, unlisted items box. */
export default function Storefront() {
  const { t, formatTime } = useI18n();
  const { store: config, products, fetchedAt, refresh, refreshing, basePath } = useStore();
  useSeo({
    title: config.city
      ? t('seo.storeTitleCity', { name: config.name, category: config.category || t('seo.storeWord'), city: config.city })
      : t('seo.storeTitle', { name: config.name }),
    description: config.description || t('seo.storeDesc', { name: config.name }),
    path: basePath || '/',
    image: config.banner_url || config.logo_url,
    noindex: Boolean(config.preview || config.is_demo || config.is_seed),
  });
  const cart = useCart();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const debounced = useDebounce(query.trim(), 250);

  const categories = useMemo(() => {
    const counts = new Map();
    for (const p of products) counts.set(p.category, (counts.get(p.category) || 0) + 1);
    const tags = new Set(products.flatMap((p) => p.tags || []));
    return [ALL, ...[...counts.keys()].sort(), ...[...tags].filter((t) => !counts.has(t)).map((t) => `#${t}`)];
  }, [products]);

  const visible = useMemo(() => {
    const terms = debounced.toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        if (category === ALL) return true;
        if (category.startsWith('#')) return p.tags.includes(category.slice(1));
        return p.category === category;
      })
      .filter((p) => !terms.length || matches(p, terms))
      .sort((a, b) => Number(b.in_stock) - Number(a.in_stock));
  }, [products, category, debounced]);

  return (
    <div className="min-h-screen">
      <StoreHeader />

      {config.preview && (
        <div className="mx-auto mt-2 max-w-6xl px-4">
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {rich(t('store.previewBanner', { status: t(`review.status.${config.status}`) }), { b: (x) => <b>{x}</b> })}
          </p>
        </div>
      )}
      {!config.accepting_orders && !config.preview && !config.temporarily_closed && (
        <div className="mx-auto mt-2 max-w-6xl px-4">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('store.notAccepting')}
          </p>
        </div>
      )}

      <div className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search size={18} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
              <input maxLength={60}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('store.searchPlaceholder', { count: products.length })}
                className="input ps-10"
                aria-label={t('store.searchLabel')}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label={t('common.clearSearch')}
                  className="absolute top-1/2 end-2 -translate-y-1/2 rounded-full p-1 text-stone-400 hover:bg-stone-100"
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <button onClick={() => cart.setOpen(true)} className="btn-ghost relative px-3" aria-label={t('store.openBag')}>
              <ShoppingBag size={20} />
              {cart.count > 0 && (
                <span className="absolute -top-1.5 -end-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-white">
                  {cart.count}
                </span>
              )}
            </button>
          </div>
          <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-3" aria-label={t('store.categories')}>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex-none rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                  category === c ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-brand'
                }`}
              >
                {c === ALL ? t('store.all') : c}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-4">

        {visible.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((p) => (
              <ProductCard key={p.sku_id} product={p} />
            ))}
          </div>
        ) : (
          <div className="py-14 text-center text-stone-500">
            <PackageSearch size={48} className="mx-auto mb-3 text-stone-300" />
            <p className="font-semibold text-stone-700">{debounced ? t('store.noResultsFor', { q: debounced }) : t('store.noResults')}</p>
            <p className="mt-1 text-sm">{t('store.noResultsHint')}</p>
          </div>
        )}

        <section className="mt-8">
          <UnlistedItemsBox />
        </section>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-stone-400">
          <span>
            {t('store.pricesUpdated', { time: fetchedAt ? formatTime(fetchedAt) : '—' })}
          </span>
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1 font-semibold text-brand">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
        </div>
      </main>

      <StoreFooter />
      <FloatingActions />
    </div>
  );
}
