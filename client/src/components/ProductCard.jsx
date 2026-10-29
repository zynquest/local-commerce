import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import ImageCarousel from './ImageCarousel.jsx';
import QuantityStepper from './QuantityStepper.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { discountPercent, formatMoney } from '../lib/format.js';
import { useT } from '../i18n/index.jsx';

/** Product Listing Page card: image carousel, pricing, discount, tags, and cart stepper. */
export default function ProductCard({ product }) {
  const t = useT();
  const { store: config, link } = useStore();
  const cart = useCart();
  const cur = config?.currency_symbol || '₹';
  const off = discountPercent(product.mrp, product.offer_price);
  const qty = cart.qtyOf(product.sku_id);

  return (
    <Link
      to={link(`/p/${encodeURIComponent(product.sku_id)}`)}
      className={`card group flex flex-col overflow-hidden transition hover:shadow-lg ${product.in_stock ? '' : 'opacity-70'}`}
    >
      <div className="relative aspect-square bg-stone-100">
        <ImageCarousel images={product.images} alt={product.name} hint={config?.category} width={400} className="h-full" />
        {off > 0 && (
          <span className="absolute top-2 start-2 rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
            {t('product.off', { pct: off })}
          </span>
        )}
        {product.tags?.[0] && (
          <span className="absolute top-2 end-2 max-w-[60%] truncate rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950 uppercase">
            {product.tags[0]}
          </span>
        )}
        {!product.in_stock && (
          <span className="absolute inset-x-0 bottom-0 bg-stone-900/70 py-1 text-center text-xs font-semibold text-white">
            {t('product.unavailable')}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5 sm:p-3">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm leading-tight font-medium text-stone-800">{product.name}</h3>
        {product.rating > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-stone-500">
            <Star size={12} className="fill-amber-400 text-amber-400" />
            <span className="font-semibold text-stone-700">{product.rating.toFixed(1)}</span>
            {product.review_count > 0 && <span>({product.review_count.toLocaleString('en-IN')})</span>}
          </div>
        )}
        <div className="mt-auto flex items-baseline gap-1.5 pt-1">
          <span className="text-base font-bold">{formatMoney(product.offer_price, cur)}</span>
          {off > 0 && <span className="text-xs text-stone-400 line-through">{formatMoney(product.mrp, cur)}</span>}
        </div>
        <QuantityStepper
          quantity={qty}
          disabled={!product.in_stock}
          onAdd={() => cart.add(product)}
          onRemove={() => cart.remove(product)}
        />
      </div>
    </Link>
  );
}
