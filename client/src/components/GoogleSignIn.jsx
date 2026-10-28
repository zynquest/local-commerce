import { useEffect, useRef, useState } from 'react';

// Google Identity Services (Sign in with Google), loaded once on demand.
let loader = null;
function loadGis() {
  loader ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error('Google sign-in could not load'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * Google's own icon-only "Sign in with Google" button. onCredential(idToken) runs after the user picks an account;
 * the server verifies the token. onUnavailable() runs when Google can't load (offline, blocked), so the caller can
 * fall back to the email code.
 */
export default function GoogleSignIn({ clientId, onCredential, onUnavailable, lang = 'en' }) {
  const ref = useRef(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => latest.current(response.credential),
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(ref.current, { type: 'icon', shape: 'circle', theme: 'outline', size: 'large', locale: lang });
        setReady(true);
      })
      .catch(() => !cancelled && onUnavailable?.());
    return () => {
      cancelled = true;
    };
  }, [clientId, lang, onUnavailable]);

  return <div ref={ref} className={`flex h-11 justify-center ${ready ? '' : 'animate-pulse'}`} data-testid="google-signin" />;
}
