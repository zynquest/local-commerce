import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, ChevronDown, Link2, Loader2, Plus, Save, Star, Trash2, X } from 'lucide-react';
import SmartImage from '../components/SmartImage.jsx';
import { discountPercent, formatMoney } from '../lib/format.js';
import { isInstagramCdn, normalizeImageUrl, uploadImage } from '../services/imageService.js';
import { rich, useT } from '../i18n/index.jsx';

const EMPTY = {
  sku_id: '',
  name: '',
  mrp: '',
  list_price: '',
  category: '',
  images: [],
  description: '',
  specs: {},
  tags: [],
  rating: '',
  review_count: '',
  in_stock: true,
};

/** Form state → API payload. Only name, MRP and list price are required; the item code is auto-assigned if blank. */
export function toPayload(f, isNew) {
  return {
    ...(isNew && f.sku_id.trim() ? { sku_id: f.sku_id.trim() } : {}),
    name: f.name.trim(),
    mrp: f.mrp,
    list_price: f.list_price,
    category: f.category.trim(),
    images: f.images,
    description: f.description.trim(),
    specs: f.specs,
    tags: f.tags,
    rating: f.rating === '' ? null : Number(f.rating),
    review_count: f.review_count === '' ? 0 : Number(f.review_count),
    in_stock: f.in_stock,
  };
}

const num = (v) => Number(String(v).replace(/[₹,\s]/g, ''));

function validate(t, f, isNew, existingSkus) {
  const e = {};
  if (!f.name.trim()) e.name = t('errors.nameRequired');
  else if (f.name.length > 100) e.name = t('errors.maxChars', { n: 100 });
  if (String(f.mrp).trim() === '') e.mrp = t('errors.fieldRequired', { field: t('errors.labelMrp') });
  else if (!(num(f.mrp) >= 0)) e.mrp = t('errors.fieldNumber', { field: t('errors.labelMrp') });
  if (String(f.list_price).trim() === '') e.list_price = t('errors.fieldRequired', { field: t('errors.labelListPrice') });
  else if (!(num(f.list_price) >= 0)) e.list_price = t('errors.fieldNumber', { field: t('errors.labelListPrice') });
  else if (!e.mrp && num(f.list_price) > num(f.mrp)) e.list_price = t('errors.listOverMrp');
  if (isNew && f.sku_id.trim()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(f.sku_id.trim())) e.sku_id = t('errors.itemCodeFormat');
    else if (existingSkus.has(f.sku_id.trim())) e.sku_id = t('pf.codeUsed');
  }
  if (f.rating !== '' && !(Number(f.rating) >= 1 && Number(f.rating) <= 5)) e.rating = t('pf.ratingRange');
  if (f.review_count !== '' && !(Number.isInteger(Number(f.review_count)) && Number(f.review_count) >= 0)) e.review_count = t('pf.wholeNumber');
  return e;
}

// Server field names → form field names.
const SERVER_FIELD = { offer_price: 'list_price' };

export default function ProductForm({ product, categories, existingSkus, onSave, onCancel }) {
  const t = useT();
  const isNew = !product;
  const [f, setF] = useState(() =>
    product
      ? {
          ...EMPTY,
          ...product,
          sku_id: product.sku_id,
          mrp: String(product.mrp ?? ''),
          list_price: String(product.offer_price ?? ''),
          rating: product.rating ? String(product.rating) : '',
          review_count: product.review_count ? String(product.review_count) : '',
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState({});
  const [showOptional, setShowOptional] = useState(!isNew);
  const [specRows, setSpecRows] = useState(() => Object.entries(product?.specs || {}).map(([k, v]) => [k, String(v)]));
  const [tagInput, setTagInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef(null);

  const set = (k) => (e) => {
    setF((s) => ({ ...s, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
    // Clear a field's error as soon as the merchant edits it (MRP edits can also fix the list-price error).
    setErrors((prev) => {
      if (!prev[k] && !(k === 'mrp' && prev.list_price)) return prev;
      const next = { ...prev };
      delete next[k];
      if (k === 'mrp') delete next.list_price;
      return next;
    });
  };
  const off = discountPercent(num(f.mrp), num(f.list_price));

  const addImageUrl = () => {
    const url = normalizeImageUrl(urlInput);
    setMediaError('');
    if (!/^https:\/\//i.test(url)) return setMediaError(t('pf.httpsOnly'));
    if (isInstagramCdn(url)) return setMediaError(t('pf.instagram'));
    setF((s) => ({ ...s, images: [...s.images, url].slice(0, 8) }));
    setUrlInput('');
  };

  const onFiles = async (files) => {
    setMediaError('');
    for (const file of Array.from(files || []).slice(0, 8 - f.images.length)) {
      setUploading((n) => n + 1);
      try {
        const url = await uploadImage(file);
        setF((s) => ({ ...s, images: [...s.images, url].slice(0, 8) }));
      } catch (err) {
        setMediaError(err.message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const moveImage = (i, dir) =>
    setF((s) => {
      const imgs = [...s.images];
      const j = i + dir;
      if (j < 0 || j >= imgs.length) return s;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...s, images: imgs };
    });

  const addTag = () => {
    const t = tagInput.trim().replace(/,/g, '');
    if (t && !f.tags.includes(t)) setF((s) => ({ ...s, tags: [...s.tags, t].slice(0, 10) }));
    setTagInput('');
  };

  const submit = async (e) => {
    e.preventDefault();
    const specs = Object.fromEntries(specRows.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v.trim()]));
    const next = { ...f, specs };
    const errs = validate(t, next, isNew, existingSkus);
    setErrors(errs);
    if (Object.keys(errs).length) {
      if (errs.sku_id || errs.rating || errs.review_count) setShowOptional(true);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onSave(toPayload(next, isNew), isNew);
    } catch (err) {
      setSaveError(err.message);
      if (err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [SERVER_FIELD[k] || k, v])));
    } finally {
      setSaving(false);
    }
  };

  const err = (k) => errors[k] && <p className="mt-1 text-xs font-medium text-rose-600">{errors[k]}</p>;
  const reqLabel = (htmlFor, text) => (
    <label className="label" htmlFor={htmlFor}>
      {text} <span className="text-rose-500">*</span>
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{isNew ? t('merchant.addProduct') : t('pf.editProduct')}</h2>
        <button type="button" onClick={onCancel} className="rounded-full p-2 hover:bg-stone-100" aria-label={t('common.close')}>
          <X size={20} />
        </button>
      </div>

      {/* Required */}
      <section className="rounded-2xl border-2 border-brand/40 bg-emerald-50/60 p-4 sm:p-5" aria-labelledby="pf-required">
        <h3 id="pf-required" className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-900">
          <Star size={16} className="fill-current" /> {t('pf.required')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {reqLabel('pf-name', t('pf.name'))}
            <input id="pf-name" className="input" value={f.name} onChange={set('name')} placeholder={t('pf.namePlaceholder')} maxLength={100} aria-invalid={!!errors.name} />
            {err('name')}
          </div>
          <div>
            {reqLabel('pf-mrp', t('pf.mrp'))}
            <input id="pf-mrp" className="input" value={f.mrp} onChange={set('mrp')} inputMode="decimal" placeholder="260" aria-invalid={!!errors.mrp} />
            {err('mrp')}
          </div>
          <div>
            {reqLabel('pf-list_price', t('pf.listPrice'))}
            <input id="pf-list_price" className="input" value={f.list_price} onChange={set('list_price')} inputMode="decimal" placeholder="235" aria-invalid={!!errors.list_price} />
            {err('list_price')}
          </div>
        </div>
        {off > 0 && !errors.list_price && (
          <p className="mt-3 text-xs text-emerald-800">
            {rich(t('pf.discountPreview', { pct: off, amount: formatMoney(num(f.mrp) - num(f.list_price)) }), { b: (x) => <b>{x}</b> })}
          </p>
        )}
      </section>

      {/* Optional */}
      <section className="card overflow-hidden">
        <button
          type="button"
          onClick={() => setShowOptional(!showOptional)}
          aria-expanded={showOptional}
          className="flex w-full items-center justify-between px-4 py-3 text-start sm:px-5"
        >
          <span>
            <span className="block text-sm font-bold">{t('pf.optional')}</span>
            <span className="block text-xs text-stone-500">{t('pf.optionalHint')}</span>
          </span>
          <ChevronDown size={18} className={`transition ${showOptional ? 'rotate-180' : ''}`} />
        </button>

        {showOptional && (
          <div className="space-y-5 border-t border-stone-100 px-4 py-4 sm:px-5">
            <div>
              <span className="label">{t('pf.photos')}</span>
              <div className="flex flex-wrap gap-2">
                {f.images.map((src, i) => (
                  <div key={`${src}-${i}`} className="relative h-24 w-24 overflow-hidden rounded-xl border border-stone-200">
                    <SmartImage src={src} alt="" width={200} className="h-full w-full object-cover" />
                    {i === 0 && <span className="absolute top-1 start-1 rounded bg-brand px-1 text-[9px] font-bold text-white">COVER</span>}
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-0.5 text-white">
                      <button type="button" onClick={() => moveImage(i, -1)} aria-label={t('pf.moveLeft')}><ArrowUp size={14} className="-rotate-90" /></button>
                      <button type="button" onClick={() => setF((s) => ({ ...s, images: s.images.filter((_, j) => j !== i) }))} aria-label={t('pf.removePhoto')}>
                        <Trash2 size={14} />
                      </button>
                      <button type="button" onClick={() => moveImage(i, 1)} aria-label={t('pf.moveRight')}><ArrowDown size={14} className="-rotate-90" /></button>
                    </div>
                  </div>
                ))}
                {f.images.length < 8 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 text-xs text-stone-500 hover:border-brand hover:text-brand"
                  >
                    {uploading ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
                    {uploading ? t('pf.uploading') : t('pf.addPhoto')}
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
              </div>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Link2 size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
                  <input
                    className="input ps-9"
                    placeholder={t('pf.pasteLink')}
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addImageUrl())}
                  />
                </div>
                <button type="button" onClick={addImageUrl} className="btn-ghost">{t('common.add')}</button>
              </div>
              {mediaError && <p className="mt-1 text-xs text-rose-600">{mediaError}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pf-category">{t('pf.category')}</label>
                <input id="pf-category" className="input" list="pf-categories" value={f.category} onChange={set('category')} placeholder={t('pf.categoryPlaceholder')} />
                <datalist id="pf-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <label className="flex items-center gap-3 self-end rounded-xl bg-stone-50 p-3">
                <input type="checkbox" checked={f.in_stock} onChange={set('in_stock')} className="h-5 w-5 accent-[var(--brand)]" />
                <span className="text-sm font-medium">{t('pf.inStock')}</span>
              </label>
            </div>

            <div>
              <label className="label" htmlFor="pf-description">{t('pf.description')}</label>
              <textarea id="pf-description" rows={3} className="input" value={f.description} onChange={set('description')} />
            </div>

            <div>
              <span className="label">{t('pf.tags')}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {f.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                    {tag}
                    <button type="button" onClick={() => setF((s) => ({ ...s, tags: s.tags.filter((x) => x !== tag) }))} aria-label={t('pf.removeTag', { tag })}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  className="input max-w-48 py-1.5"
                  placeholder={t('pf.tagPlaceholder')}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addTag())}
                  onBlur={addTag}
                />
              </div>
            </div>

            <div>
              <span className="label">{t('pf.details')}</span>
              <div className="space-y-2">
                {specRows.map(([k, v], i) => (
                  <div key={i} className="flex gap-2">
                    <input className="input w-2/5" placeholder={t('pf.detailKey')} value={k} onChange={(e) => setSpecRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
                    <input className="input flex-1" placeholder={t('pf.detailValue')} value={v} onChange={(e) => setSpecRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
                    <button type="button" onClick={() => setSpecRows((rows) => rows.filter((_, j) => j !== i))} className="p-2 text-stone-400 hover:text-rose-600" aria-label={t('pf.removeDetail')}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setSpecRows((r) => [...r, ['', '']])} className="btn-ghost py-1.5 text-xs">
                  <Plus size={14} /> {t('pf.addDetail')}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="pf-sku">{t('pf.itemCode')}</label>
                <input id="pf-sku" className="input" value={f.sku_id} onChange={set('sku_id')} disabled={!isNew} placeholder={isNew ? t('pf.auto') : ''} />
                {err('sku_id') || <p className="mt-1 text-[11px] text-stone-400">{isNew ? t('pf.itemCodeNew') : t('pf.itemCodeInternal')}</p>}
              </div>
              <div>
                <label className="label" htmlFor="pf-rating">{t('pf.rating')}</label>
                <input id="pf-rating" className="input" value={f.rating} onChange={set('rating')} inputMode="decimal" />
                {err('rating')}
              </div>
              <div>
                <label className="label" htmlFor="pf-review_count">{t('pf.reviewCount')}</label>
                <input id="pf-review_count" className="input" value={f.review_count} onChange={set('review_count')} inputMode="numeric" />
                {err('review_count')}
              </div>
            </div>
          </div>
        )}
      </section>

      {saveError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">{t('common.cancel')}</button>
        <button disabled={saving || uploading > 0} className="btn-brand flex-1">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {saving ? t('common.saving') : t('pf.save')}
        </button>
      </div>
    </form>
  );
}
