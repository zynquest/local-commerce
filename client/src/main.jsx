import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './lib/install.js'; // captures beforeinstallprompt before React mounts (InstallBanner)
import App from './App.jsx';
import { SessionProvider } from './context/SessionContext.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { purgeStaleCatalogs } from './services/catalogService.js';
import { startOutboxSync } from './services/orderService.js';
import './index.css';

// PWA updates: the precached shell means a visit right after a deploy still runs the previous build, which can
// call API routes that no longer exist ("Unknown API route"). When the new service worker takes control, reload
// so the fresh build runs — unless someone is typing (then reload once they leave the field or the tab).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000); // long-lived installed app sessions
  },
});
if ('serviceWorker' in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const reload = () => window.location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // first install: this page is already the latest build
      return;
    }
    if (!typing()) return reload();
    document.addEventListener('visibilitychange', reload, { once: true });
    document.activeElement.addEventListener('blur', reload, { once: true });
  });
}
purgeStaleCatalogs().catch(() => {});
startOutboxSync();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);
