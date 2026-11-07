// Google Ads tag (gtag.js) for measuring ads: loaded only on the live site (sonsari.in, production build), never on a
// store's own custom domain, in local development, or on the admin console. Pages are reported by path only (no
// query string), one page view per route change since this is a single-page app.
import { PLATFORM } from '../config.js';

const ID = PLATFORM.googleAdsId;
const ADS_HOSTS = new Set(['sonsari.in', 'www.sonsari.in']);
const skipped = (path) => path === '/motiveboss' || path.startsWith('/motiveboss/');

const enabled = () => Boolean(ID) && import.meta.env.PROD && ADS_HOSTS.has(window.location.hostname);

function load() {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the arguments object itself, so this must stay a plain function using `arguments`.
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', ID, { send_page_view: false });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
  document.head.appendChild(script);
}

/** Reports a page view for this path (loading the tag on the first one). */
export function trackPageView(path) {
  if (!enabled() || skipped(path)) return;
  load();
  window.gtag('event', 'page_view', { send_to: ID, page_path: path, page_location: `${window.location.origin}${path}`, page_title: document.title });
}
