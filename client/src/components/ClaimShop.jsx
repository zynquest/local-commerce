import { useEffect, useState } from 'react';
import { ArrowLeft, Camera, ExternalLink, FileText, Loader2, MapPin, Search, Sprout } from 'lucide-react';
import LocationPicker from './LocationPicker.jsx';
import MobileInput, { isMobile10 } from './MobileInput.jsx';
import SmartImage from './SmartImage.jsx';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { NearbyBar } from '../pages/StoreDirectory.jsx';
import { PLATFORM } from '../config.js';
import { useI18n } from '../i18n/index.jsx';
import { get, post } from '../lib/api.js';
import { useDebounce } from '../lib/hooks.js';
import { useShopperLocation } from '../lib/location.js';
import { whatsappLink } from '../services/whatsappService.js';

/** WhatsApp message to the platform number: the claim code, the shop and the proof the owner attaches. */
export const claimWhatsAppLink = (t, claim, email) =>
  whatsappLink(
    PLATFORM.whatsappNumber,
    t('claim.waMsg', { brand: PLATFORM.name, code: claim.code, name: claim.store.name, link: `${window.location.origin}/s/${claim.store.slug}`, email, phone: claim.phone }),
  );

const place = (s) => [s.locality, s.city].filter(Boolean).join(', ');

/**
 * A new owner finds their shop among the unclaimed seeded listings near a location and asks for it.
 * `proof` is what signed them in: { email, code } or { credential } (Google). onClaimed(claim) once it's recorded.
 */
export default function ClaimShop({ proof, initialSlug = '', onClaimed, onNewStore }) {
  const { t, lang } = useI18n();
  const loc = useShopperLocation();
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 250);
  const [list, setList] = useState({ loading: false, stores: [], error: '' });
  const [picked, setPicked] = useState(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});

  // Came from a listing's "Claim it free" link: open that shop straight away.
  useEffect(() => {
    if (!initialSlug) return;
    get(`/stores/${encodeURIComponent(initialSlug)}`)
      .then((r) => r.store?.is_seed && setPicked({ slug: r.store.slug, name: r.store.name, category: r.store.category, locality: r.store.locality, city: r.store.city, logo_url: r.store.logo_url }))
      .catch(() => {});
  }, [initialSlug]);

  useEffect(() => {
    if (!loc) return;
    let live = true;
    setList((l) => ({ ...l, loading: true }));
    const params = new URLSearchParams({ q, lat: loc.lat.toFixed(5), lng: loc.lng.toFixed(5) });
    get(`/auth/claimable?${params}`)
      .then((r) => live && setList({ loading: false, stores: r.stores, error: '' }))
      .catch((err) => live && setList({ loading: false, stores: [], error: err.message }));
    return () => {
      live = false;
    };
  }, [q, loc]);

  const submit = async () => {
    setError('');
    setFields({});
    if (!isMobile10(phone)) return setFields({ phone: t('errors.validMobile10') });
    setBusy(true);
    try {
      const { claim } = await post('/auth/claim', { slug: picked.slug, phone, language: lang, ...proof });
      onClaimed(claim);
    } catch (err) {
      setError(err.message);
      setFields(err.fields || {});
    } finally {
      setBusy(false);
    }
  };

  if (picked)
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 text-sm font-semibold text-stone-600">
          <ArrowLeft size={16} className="rtl:rotate-180" /> {t('claim.back')}
        </button>
        <div className="flex gap-3 rounded-xl border border-stone-200 p-3">
          <SmartImage src={picked.logo_url} alt={picked.name} hint={picked.category} width={96} className="h-12 w-12 flex-none rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="leading-snug font-bold break-words">{picked.name}</p>
            <p className="text-xs text-stone-500">{[picked.category, place(picked)].filter(Boolean).join(' · ')}</p>
            <a href={`/s/${picked.slug}`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand">
              {t('claim.viewListing')} <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <MobileInput id="claim-phone" value={phone} onChange={setPhone} label={t('claim.waLabel')} hint={t('claim.waHint')} error={fields.phone} autoFocus />
        <div className="rounded-xl bg-stone-50 p-3 text-sm">
          <p className="font-semibold">{t('claim.proofTitle')}</p>
          <p className="mt-1 text-stone-600">{t('claim.proofIntro', { brand: PLATFORM.name })}</p>
          <ul className="mt-2 space-y-1.5 text-stone-700">
            <li className="flex gap-2"><Camera size={16} className="mt-0.5 flex-none text-brand" /> {t('claim.proofPhoto')}</li>
            <li className="flex gap-2"><FileText size={16} className="mt-0.5 flex-none text-brand" /> {t('claim.proofDoc')}</li>
          </ul>
        </div>
        {error && !Object.values(fields).some(Boolean) && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button type="button" onClick={submit} disabled={busy} className="btn-brand w-full py-3">
          {busy && <Loader2 size={16} className="animate-spin" />} {t('claim.submit')}
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">{t('claim.findTitle')}</h2>
        <p className="text-sm text-stone-600">{t('claim.findBody')}</p>
      </div>
      <NearbyBar />
      {loc ? (
        <>
          <label className="relative block">
            <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
            <input
              maxLength={60}
              className="input ps-9"
              placeholder={t('claim.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Inside the sign-in form: Enter must not submit it.
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
          </label>
          {list.error && <p className="text-sm text-rose-600">{list.error}</p>}
          <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto rounded-xl border border-stone-200">
            {list.stores.map((s) => (
              <li key={s.slug}>
                <button type="button" onClick={() => setPicked(s)} className="flex w-full items-center gap-3 p-3 text-start hover:bg-stone-50">
                  <SmartImage src={s.logo_url} alt={s.name} hint={s.category} width={80} className="h-10 w-10 flex-none rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug font-semibold break-words">{s.name}</span>
                    <span className="block text-xs text-stone-500">
                      {[s.category, place(s)].filter(Boolean).join(' · ')}
                      {s.distance_km != null && <span dir="ltr"> · {t('loc.km', { km: s.distance_km })}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {list.loading && !list.stores.length && <li className="flex justify-center p-4"><Loader2 className="animate-spin text-stone-400" /></li>}
            {!list.loading && !list.stores.length && <li className="p-4 text-center text-sm text-stone-500">{t('claim.none')}</li>}
          </ul>
        </>
      ) : (
        <button type="button" onClick={() => setPicker(true)} className="btn-brand w-full">
          <MapPin size={16} /> {t('loc.setLocation')}
        </button>
      )}
      {picker && <LocationPicker onClose={() => setPicker(false)} />}
      <button type="button" onClick={onNewStore} className="btn-ghost w-full text-sm">{t('claim.newStoreInstead')}</button>
    </div>
  );
}

/** After asking: the claim code, the WhatsApp button for the proof, and what happens next. */
export function ClaimSent({ claim, email, fresh, onNewStore }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-lime-50 p-4 text-lime-950">
        <p className="flex items-center gap-1.5 font-bold"><Sprout size={18} className="flex-none" /> {t(fresh ? 'claim.sentTitle' : 'claim.pendingTitle')}</p>
        <p className="mt-1 text-sm">{t('claim.sentBody', { code: claim.code, name: claim.store.name })}</p>
      </div>
      <a href={claimWhatsAppLink(t, claim, email)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full py-3">
        <WhatsAppIcon size={18} /> {t('claim.sendWa')}
      </a>
      <p className="text-sm text-stone-600">{t('claim.afterApproval', { email })}</p>
      <button type="button" onClick={onNewStore} className="btn-ghost w-full text-sm">{t('claim.newStoreInstead')}</button>
    </div>
  );
}
