import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudUpload, Store, WifiOff } from 'lucide-react';
import { useOnline } from '../lib/hooks.js';
import { onOutboxChange } from '../services/orderService.js';
import { useI18n, useT } from '../i18n/index.jsx';

export function LoadingScreen({ label }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4">
      <div className="mb-4 aspect-[16/6] rounded-b-2xl bg-stone-200 sm:aspect-[16/4]" />
      <div className="mb-6 h-6 w-48 rounded bg-stone-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-2xl bg-stone-200" />
        ))}
      </div>
      <span className="sr-only">{label || t('common.loading')}</span>
    </div>
  );
}

export function MessageScreen({ title, children, action = true }) {
  const t = useT();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Store size={48} className="text-stone-300" />
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="max-w-md text-sm text-stone-600">{children}</div>
      {action && (
        <Link to="/" className="btn-brand mt-2">
          {t('common.goHome')}
        </Link>
      )}
    </div>
  );
}

/** Connectivity + catalog-freshness banner, with the number of orders waiting to sync. */
export function OfflineBanner({ expiresAt }) {
  const { t, formatTime } = useI18n();
  const online = useOnline();
  const [pending, setPending] = useState(0);
  useEffect(() => onOutboxChange(setPending), []);

  if (online && !pending) return null;
  const until = expiresAt ? formatTime(expiresAt) : null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-stone-800 px-3 py-1.5 text-center text-xs text-white">
      {online ? <CloudUpload size={14} /> : <WifiOff size={14} />}
      {online
        ? t('offline.syncing', { count: pending })
        : [
            until ? t('offline.bannerUntil', { time: until }) : t('offline.banner'),
            pending ? t('offline.pending', { count: pending }) : '',
          ].join(' ')}
    </div>
  );
}
