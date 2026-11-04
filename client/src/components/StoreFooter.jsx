import { MapPin, Sprout } from 'lucide-react';
import InstagramIcon from './InstagramIcon.jsx';
import { Link } from 'react-router-dom';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { whatsappLink } from '../services/whatsappService.js';
import { mapsLink } from '../lib/format.js';
import { PLATFORM } from '../config.js';
import { rich, useT } from '../i18n/index.jsx';

export default function StoreFooter() {
  const t = useT();
  const { store: config, basePath } = useStore();
  if (!config) return null;
  const maps = mapsLink(config.maps_url, config.address_text);
  const whitelabel = basePath === '';

  return (
    <footer className="mt-10 border-t border-stone-200 bg-white pb-28">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 text-center">
        {/* Unclaimed seeded listing: where it came from, why it's here, and how the owner takes it over or removes it. */}
        {config.is_seed && (
          <div className="w-full max-w-xl rounded-2xl border border-lime-200 bg-lime-50 p-4 text-start text-sm text-lime-950" role="note">
            <p className="flex items-center gap-1.5 font-bold"><Sprout size={16} className="flex-none" /> {t('store.seedAboutTitle')}</p>
            <p className="mt-1">{t(config.seed_source === 'osm' ? 'store.seedAbout' : 'store.seedAboutPublic', { brand: PLATFORM.name })}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/register?claim=${encodeURIComponent(config.slug)}`} className="btn-brand px-4 py-2 text-sm">{t('store.seedClaimCta')}</Link>
              <a
                href={whatsappLink(PLATFORM.whatsappNumber, t('store.seedRemoveMsg', { name: config.name, link: `${window.location.origin}${basePath}`, brand: PLATFORM.name }))}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost px-4 py-2 text-sm"
              >
                <WhatsAppIcon size={16} /> {t('store.seedRemoveCta')}
              </a>
            </div>
          </div>
        )}
        <p className="font-bold">{config.name}</p>
        <div className="flex gap-3">
          {config.whatsapp_number && (
            <a
              href={whatsappLink(config.whatsapp_number, t('store.question', { name: config.name }))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="rounded-full bg-whatsapp p-3 text-white"
            >
              <WhatsAppIcon size={20} />
            </a>
          )}
          {config.instagram_handle && (
            <a
              href={`https://instagram.com/${encodeURIComponent(config.instagram_handle)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-3 text-white"
            >
              <InstagramIcon size={20} />
            </a>
          )}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" aria-label="Google Maps" className="rounded-full bg-sky-600 p-3 text-white">
              <MapPin size={20} />
            </a>
          )}
        </div>
        {config.instagram_handle && <p className="text-xs text-stone-500">@{config.instagram_handle}</p>}
        {!whitelabel && (
          <Link to="/" className="text-xs text-stone-400 hover:text-brand">
            {rich(t('store.poweredBy', { brand: PLATFORM.name }), { b: (x) => <b>{x}</b> })}
          </Link>
        )}
        {!whitelabel && <p className="text-[11px] text-stone-400">🇮🇳 {t('landing.madeIn')}</p>}
        {config.seed_source === 'osm' && (
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-[11px] text-stone-400 underline" dir="ltr">
            Listing data © OpenStreetMap contributors
          </a>
        )}
        {!whitelabel && (
          <a href="/privacy" className="text-[11px] text-stone-400 underline hover:text-brand">{t('common.privacy')}</a>
        )}
      </div>
    </footer>
  );
}
