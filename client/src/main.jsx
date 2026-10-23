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

registerSW({ immediate: true });
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
