import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { useSession } from '../context/SessionContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { post } from '../lib/api.js';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// The VAPID public key (base64url) as the bytes pushManager.subscribe wants.
function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * "Turn on notifications" for the owner: a push on this phone for every new order or booking, and when the store is
 * approved. Hidden when the server has no push keys or the browser can't do push. On iPhone, push only works in the
 * app added to the Home Screen, so it says that instead.
 */
export default function PushOptIn({ store }) {
  const { t, lang } = useI18n();
  const { appConfig } = useSession();
  const key = appConfig.vapidPublicKey;
  const [state, setState] = useState('loading'); // loading | off | on | denied | ios | busy
  const [error, setError] = useState('');

  useEffect(() => {
    if (!key) return;
    if (!supported()) return setState(isIos() && !standalone() ? 'ios' : 'unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, [key]);

  if (!key || state === 'loading' || state === 'unsupported') return null;

  const turnOn = async () => {
    setError('');
    setState('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'denied' : 'off');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await post('/merchant/push/subscribe', { subscription: sub.toJSON(), language: lang });
      setState('on');
    } catch (err) {
      setError(err.message);
      setState('off');
    }
  };

  const turnOff = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post('/merchant/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      setState('off');
    }
  };

  const appt = store.business_type === 'appointments';
  if (state === 'on') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        <BellRing size={16} className="flex-none" />
        <span className="flex-1">{t('push.enabled')}</span>
        <button type="button" onClick={turnOff} className="flex-none text-xs font-semibold underline">{t('push.disable')}</button>
      </div>
    );
  }
  return (
    <section className="card flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand/10 text-brand">
        {state === 'denied' ? <BellOff size={18} /> : <Bell size={18} />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold">{t('push.title')}</p>
        <p className="text-sm text-stone-600">
          {state === 'ios' ? t('push.iosHint') : state === 'denied' ? t('push.denied') : t(appt ? 'push.bodyAppt' : 'push.body')}
        </p>
        {(state === 'off' || state === 'busy') && (
          <button type="button" onClick={turnOn} disabled={state === 'busy'} className="btn-brand py-2 text-sm">
            {state === 'busy' ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />} {t('push.enable')}
          </button>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </section>
  );
}
