// Client-side head management for SPA navigation (the server injects the same tags on first load).
import { useEffect } from 'react';
import { LANGUAGES } from '../i18n/languages.js';

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) return el?.remove();
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) return el?.remove();
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/** hreflang links: every language version of a translated page, or none (also clears tags from the previous page). */
function setAlternates(path) {
  document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
  if (path === null) return;
  const url = (code) => {
    const u = new URL(path, window.location.origin);
    if (code !== 'en') u.searchParams.set('lang', code);
    return u.href;
  };
  for (const [hreflang, code] of [...LANGUAGES.map((l) => [l.code === 'en' ? 'en-IN' : l.code, l.code]), ['x-default', 'en']]) {
    const el = document.createElement('link');
    el.rel = 'alternate';
    el.hreflang = hreflang;
    el.href = url(code);
    document.head.appendChild(el);
  }
}

/**
 * Sets title, description, canonical, robots, hreflang and Open Graph tags for the current page (mirrors server/src/seo.js).
 * `localized`: the page content itself is translated (home, directory, register), so each ?lang= version is its own
 * canonical URL with hreflang alternates. Store/product pages are merchant-written: one canonical URL, no hreflang.
 */
export function useSeo({ title, description, path, image, noindex = false, localized = false }) {
  useEffect(() => {
    if (title) document.title = title;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    if (image) setMeta('property', 'og:image', new URL(image, window.location.origin).href);
    // Language versions are separate URLs (?lang=xx) so search engines can index each one.
    let canonical = null;
    if (path !== undefined) {
      const url = new URL(path, window.location.origin);
      const lang = new URLSearchParams(window.location.search).get('lang');
      if (localized && lang && lang !== 'en' && LANGUAGES.some((l) => l.code === lang)) url.searchParams.set('lang', lang);
      canonical = url.href;
    }
    setCanonical(noindex ? null : canonical);
    setAlternates(!noindex && localized && path !== undefined ? path : null);
    setMeta('property', 'og:url', canonical);
  }, [title, description, path, image, noindex, localized, typeof window !== 'undefined' && window.location.search]);
}
