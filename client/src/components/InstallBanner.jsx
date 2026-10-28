import { useEffect, useMemo, useReducer, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Share, X } from 'lucide-react';
import { rich, useT } from '../i18n/index.jsx';
import { PLATFORM } from '../config.js';
import { canPrompt, devicePlatform, isStandalone, promptInstall, subscribe, wasInstalled } from '../lib/install.js';

const DISMISS_KEY = 'pwa.installDismissedAt';
const SNOOZE_MS = 14 * 24 * 3600 * 1000;
// Merchant / admin / auth screens: no install nag there.
const HIDDEN_PATHS = /^\/(merchant|motiveboss|login|register)(\/|$)/;

const readDismissed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < SNOOZE_MS;
  } catch {
    return false;
  }
};

/**
 * "Install the app" bar at the very top of the page on phones (Android + iOS), on the platform's own hosts.
 *   - Android Chrome/Edge/Samsung: an Install button that opens the native dialog (beforeinstallprompt).
 *   - iOS (and Android browsers without the prompt): the "Share → Add to Home Screen" steps.
 * Hidden when already installed/standalone, on desktop, on merchant/admin/auth pages, and for 14 days after dismissal.
 */
export default function InstallBanner({ enabled = true }) {
  const t = useT();
  const { pathname } = useLocation();
  const [, rerender] = useReducer((n) => n + 1, 0);
  const [dismissed, setDismissed] = useState(readDismissed);
  const platform = useMemo(devicePlatform, []);
  useEffect(() => subscribe(rerender), []);

  if (!enabled || !platform || dismissed || HIDDEN_PATHS.test(pathname) || isStandalone() || wasInstalled()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: just hide for this page view */
    }
    setDismissed(true);
  };
  const install = async () => {
    const outcome = await promptInstall();
    if (outcome !== 'accepted') dismiss();
  };
  const prompt = canPrompt();
  const bold = { b: (x) => <b className="font-semibold text-stone-900">{x}</b> };

  return (
    <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950" role="region" aria-label={t('install.title', { brand: PLATFORM.name })}>
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width="40" height="40" className="h-10 w-10 flex-none rounded-xl shadow-sm" />
        <div className="min-w-0 flex-1 text-xs leading-snug">
          <p className="truncate text-sm font-bold">{t('install.title', { brand: PLATFORM.name })}</p>
          {prompt ? (
            <p className="text-stone-600">{t('install.body')}</p>
          ) : (
            <p className="text-stone-600">
              {platform === 'ios' && <Share size={12} className="me-1 inline -mt-0.5" aria-hidden="true" />}
              {rich(t(platform === 'ios' ? 'install.ios' : 'install.android'), bold)}
            </p>
          )}
        </div>
        {prompt && (
          <button type="button" onClick={install} className="btn-brand flex-none px-3 py-2 text-xs">
            <Download size={14} /> {t('install.button')}
          </button>
        )}
        <button type="button" onClick={dismiss} aria-label={t('install.dismiss')} className="flex-none rounded-full p-1.5 text-stone-500 hover:bg-emerald-100 hover:text-stone-800">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
