import { Link } from 'react-router-dom';
import { BadgeCheck, Clock, FlaskConical, Home, MapPin, Navigation, RefreshCw, Sprout } from 'lucide-react';
import { PLATFORM } from '../config.js';
import SmartImage from './SmartImage.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { getOpenStatus, mapsLink } from '../lib/format.js';
import { useT } from '../i18n/index.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { whatsappLink } from '../services/whatsappService.js';

/** Store header: banner, logo, name, verified badge, open/closed status, address + Maps shortcut. */
export default function StoreHeader() {
  const t = useT();
  const { store: config, refreshing, basePath } = useStore();
  if (!config) return null;
  const status = getOpenStatus(config.opening_hours, config.closed_days);
  const maps = mapsLink(config.maps_url, config.address_text);

  return (
    <>
    {config.is_demo && (
      <p className="flex items-center justify-center gap-1.5 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900" role="note">
        <FlaskConical size={14} className="flex-none" /> {t('store.demoNotice')}
      </p>
    )}
    {config.is_seed && (
      <div className="bg-lime-50 px-4 py-2 text-center text-xs text-lime-950" role="note">
        <p className="flex items-center justify-center gap-1.5 font-medium">
          <Sprout size={14} className="flex-none" /> {t('store.seedNotice', { brand: PLATFORM.name })}
        </p>
        <a
          href={whatsappLink(PLATFORM.whatsappNumber, t('store.seedClaimMsg', { name: config.name, link: `${window.location.origin}${basePath}` }))}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-block font-bold text-lime-800 underline"
        >
          {t('store.seedClaim')}
        </a>
      </div>
    )}
    <header className="relative bg-white">
      {/* Platform-hosted stores (/s/<slug>) link back to the marketplace; custom-domain stores are their own home. */}
      {basePath && (
        <Link
          to="/"
          className="absolute top-3 start-3 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/55"
          aria-label={t('common.goHome')}
          title={t('common.goHome')}
        >
          <Home size={16} className="flex-none" />
          <span className="max-w-[9rem] truncate max-[359px]:hidden">{PLATFORM.name}</span>
        </Link>
      )}
      <LanguageSwitcher variant="overlay" className="absolute top-3 end-3 z-10" />
      <div className="relative aspect-[16/5] max-h-64 w-full overflow-hidden bg-gradient-to-br from-brand to-emerald-900 sm:aspect-[16/4]">
        {config.banner_url && (
          <SmartImage src={config.banner_url} alt="" width={1200} eager className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent" />
        {refreshing && (
          <span className="absolute bottom-3 start-3 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[11px] text-white">
            <RefreshCw size={12} className="animate-spin" /> {t('store.updating')}
          </span>
        )}
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-4">
        <div className="relative flex items-end gap-3">
          <SmartImage
            src={config.logo_url}
            alt={config.name}
            width={200}
            eager
            className="-mt-10 h-20 w-20 flex-none rounded-2xl border-4 border-white bg-white object-cover shadow-md"
          />
          <div className="min-w-0 pb-1">
            <h1 className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xl leading-tight font-extrabold break-words sm:text-2xl">
              <span>{config.name}</span>
              {config.verified && <BadgeCheck size={22} className="flex-none fill-sky-500 text-white" aria-label={t('store.verified')} />}
              {config.is_demo && <span className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{t('store.demoBadge')}</span>}
            </h1>
            {status && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${status.open ? 'text-emerald-700' : 'text-rose-600'}`}
              >
                <span className={`h-2 w-2 rounded-full ${status.open ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} />
                <Clock size={12} /> {t(status.key, status.vars)}
              </span>
            )}
          </div>
        </div>
        {config.description && <p className="mt-3 text-sm text-stone-600">{config.description}</p>}
        {config.address_text && (
          <div className="mt-3 flex items-start gap-2 text-sm text-stone-600">
            <MapPin size={16} className="mt-0.5 flex-none text-brand" />
            <span className="flex-1 whitespace-pre-line">{config.address_text}</span>
            {maps && (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-none items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand"
              >
                <Navigation size={12} /> {t('store.directions')}
              </a>
            )}
          </div>
        )}
      </div>
    </header>
    </>
  );
}
