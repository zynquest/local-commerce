import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Minus, Plus, Share2, ShoppingBag, Star } from 'lucide-react';
import ImageCarousel from '../components/ImageCarousel.jsx';
import ProductCard from '../components/ProductCard.jsx';
import FloatingActions from '../components/FloatingActions.jsx';
import { MessageScreen } from '../components/StatusScreens.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { discountPercent, formatMoney } from '../lib/format.js';
import { useSeo } from '../lib/seo.js';
import { useT } from '../i18n/index.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';

const GUIDE_KEYS = /^(usage|how to use|directions|storage|storage guidelines|care|instructions?)$/i;

function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-3.5 text-start text-sm font-bold"
      >
        {title}
        <ChevronDown size={18} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-4 text-sm leading-relaxed whitespace-pre-line text-stone-600">{children}</div>}
    </div>
  );
}

/** Product Description Page: gallery, savings breakdown, specs table, accordions, sticky add bar. */
export default function ProductDetail() {
  const { skuId } = useParams();
  const sku = decodeURIComponent(skuId);
  const navigate = useNavigate();
  const { products, store: config, link } = useStore();
  const cart = useCart();
  const product = products.find((p) => p.sku_id === sku);
  const t = useT();
  const inCart = cart.qtyOf(sku);
  const [qty, setQty] = useState(inCart || 1);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [sku]);

  useSeo({
    title: product ? `${product.name} — ₹${product.offer_price} | ${config?.name}` : config?.name,
    description: product ? product.description || t('seo.productDesc', { name: product.name, store: config?.name }) : '',
    path: product ? link(`/p/${encodeURIComponent(product.sku_id)}`) : undefined,
    image: product?.images?.[0],
    noindex: Boolean(config?.preview || config?.is_demo),
  });

  const related = useMemo(
    () => (product ? products.filter((p) => p.category === product.category && p.sku_id !== sku).slice(0, 4) : []),
    [products, product, sku],
  );

  if (!product)
    return (
      <MessageScreen title={t('product.notFound')} action={false}>
        {t('product.notFoundBody')}
        <div className="mt-4">
          <Link to={link('')} className="btn-brand">
            {t('product.backToStore')}
          </Link>
        </div>
      </MessageScreen>
    );

  const cur = config?.currency_symbol || '₹';
  const money = (n) => formatMoney(n, cur);
  const off = discountPercent(product.mrp, product.offer_price);
  const specEntries = Object.entries(product.specs || {});
  const specs = specEntries.filter(([k]) => !GUIDE_KEYS.test(k));
  const guides = specEntries.filter(([k]) => GUIDE_KEYS.test(k));

  const share = async () => {
    const data = { title: product.name, text: t('product.shareText', { name: product.name, store: config.name }), url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(data.url);
    } catch {
      /* user cancelled */
    }
  };

  const addToBag = () => {
    cart.setQuantity(product, qty);
    cart.setOpen(true);
  };

  return (
    <div className="min-h-screen bg-white pb-28">
      <div className="sticky top-0 z-20 flex items-center justify-between bg-white/90 px-2 py-2 backdrop-blur">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(link('')))}
          aria-label={t('common.back')}
          className="rounded-full p-2 hover:bg-stone-100"
        >
          <ArrowLeft size={22} className="rtl:rotate-180" />
        </button>
        <Link to={link('')} className="truncate px-2 text-sm font-semibold">
          {config.name}
        </Link>
        <div className="flex items-center">
          <LanguageSwitcher variant="compact" />
          <button onClick={share} aria-label={t('common.share')} className="rounded-full p-2 hover:bg-stone-100">
            <Share2 size={20} />
          </button>
          <button onClick={() => cart.setOpen(true)} aria-label={t('store.openBag')} className="relative rounded-full p-2 hover:bg-stone-100">
            <ShoppingBag size={20} />
            {cart.count > 0 && (
              <span className="absolute top-0 end-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {cart.count}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl md:grid md:grid-cols-2 md:gap-8 md:px-4 md:pt-4">
        <ImageCarousel
          images={product.images}
          alt={product.name}
          width={1000}
          eager
          showArrows
          className="aspect-square bg-stone-100 md:overflow-hidden md:rounded-2xl"
        />

        <div className="px-4 pt-4 md:px-0">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">{product.category}</span>
            {(product.tags || []).map((t) => (
              <span key={t} className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 uppercase">
                {t}
              </span>
            ))}
          </div>
          <h1 className="mt-2 text-xl leading-tight font-bold sm:text-2xl">{product.name}</h1>
          {product.rating > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-sm">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  size={15}
                  className={i <= Math.round(product.rating) ? 'fill-amber-400 text-amber-400' : 'text-stone-300'}
                />
              ))}
              <span className="ms-1 font-semibold">{product.rating.toFixed(1)}</span>
              {product.review_count > 0 && (
                <span className="text-stone-500">· {t('product.reviews', { count: product.review_count, n: product.review_count.toLocaleString('en-IN') })}</span>
              )}
            </div>
          )}

          <div className="mt-4 rounded-2xl bg-stone-50 p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold">{money(product.offer_price)}</span>
              {off > 0 && (
                <>
                  <span className="text-stone-400 line-through">{money(product.mrp)}</span>
                  <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-bold text-white">{t('product.off', { pct: off })}</span>
                </>
              )}
            </div>
            {off > 0 && (
              <dl className="mt-3 space-y-1 border-t border-dashed border-stone-200 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-stone-500">{t('product.mrpIncl')}</dt>
                  <dd>{money(product.mrp)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">{t('product.storeDiscount')}</dt>
                  <dd dir="ltr" className="text-emerald-700">−{money(product.mrp - product.offer_price)}</dd>
                </div>
                <div className="flex justify-between font-semibold text-emerald-700">
                  <dt>{t('product.youSaveOn', { qty })}</dt>
                  <dd>{money((product.mrp - product.offer_price) * qty)}</dd>
                </div>
              </dl>
            )}
            {!product.in_stock && <p className="mt-2 text-sm font-semibold text-rose-600">{t('product.currentlyOut')}</p>}
          </div>

          {specs.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-sm font-bold">{t('product.specs')}</h2>
              <table className="w-full overflow-hidden rounded-xl border border-stone-200 text-sm">
                <tbody>
                  {specs.map(([k, v]) => (
                    <tr key={k} className="odd:bg-stone-50">
                      <th className="w-2/5 px-3 py-2 text-start font-medium text-stone-500">{k}</th>
                      <td className="px-3 py-2">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            {product.description && (
              <Accordion title={t('product.details')} defaultOpen>
                {product.description}
              </Accordion>
            )}
            {guides.length > 0 && (
              <Accordion title={t('product.usage')}>
                {guides.map(([k, v]) => (
                  <p key={k} className="mb-2">
                    <b className="text-stone-800">{k}:</b> {String(v)}
                  </p>
                ))}
              </Accordion>
            )}
            <Accordion title={t('product.deliveryPayment')}>
              {t('product.deliveryInfo', { store: config.name })}
              {config.minimum_order > 0 && ` ${t('product.minOrder', { amount: money(config.minimum_order) })}`}
              {config.delivery_fee > 0 && ` ${t('product.deliveryFee', { amount: money(config.delivery_fee) })}`}
            </Accordion>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mx-auto mt-8 max-w-5xl px-4">
          <h2 className="mb-3 text-base font-bold">{t('product.moreIn', { category: product.category })}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.sku_id} product={p} />
            ))}
          </div>
        </section>
      )}

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white px-4 pt-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex h-12 items-center rounded-xl border border-stone-200">
            <button
              aria-label={t('product.decrease')}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="flex h-full w-11 items-center justify-center"
              disabled={!product.in_stock}
            >
              <Minus size={18} />
            </button>
            <span className="w-8 text-center font-bold tabular-nums">{qty}</span>
            <button
              aria-label={t('product.increase')}
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              className="flex h-full w-11 items-center justify-center"
              disabled={!product.in_stock}
            >
              <Plus size={18} />
            </button>
          </div>
          <button onClick={addToBag} disabled={!product.in_stock} className="btn-brand h-12 flex-1 text-base">
            <ShoppingBag size={18} />
            {product.in_stock ? (inCart ? t('product.updateBag') : t('product.addToBag')) : t('product.outOfStock')} · {money(product.offer_price * qty)}
          </button>
        </div>
      </div>
      <FloatingActions hideCartBar raised />
    </div>
  );
}
