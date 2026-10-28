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
 * Google's own "Continue with Google" button (logo on the left, full width of its container, up to Google's 400 px).
 * onCredential(idToken) runs after the user picks an account;
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
        const width = Math.round(Math.min(400, Math.max(200, ref.current.getBoundingClientRect().width || 320)));
        // renderButton adds a button each time it's called; an effect re-run (dev double render, language change) must
        // replace the old one, not stack a second "Continue with Google" under it.
        ref.current.replaceChildren();
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
          locale: lang,
        });
        setReady(true);
      })
      .catch(() => !cancelled && onUnavailable?.());
    return () => {
      cancelled = true;
    };
  }, [clientId, lang, onUnavailable]);

  return <div ref={ref} className={`flex min-h-11 w-full justify-center ${ready ? '' : 'animate-pulse rounded bg-stone-100'}`} data-testid="google-signin" />;
}
