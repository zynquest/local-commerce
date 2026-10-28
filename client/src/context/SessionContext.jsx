// App config (feature flags) plus owner, customer and platform-admin sessions. All sessions are httpOnly
// cookies; this context only mirrors "who am I".
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PLATFORM } from '../config.js';
import { get, post, put } from '../lib/api.js';

const SessionContext = createContext(null);

const CONFIG_KEY = 'app-config';
// otpDelivery: 'sms' (Fast2SMS) | 'whatsapp' | 'whatsapp_reply' | 'manual' (WhatsApp otpHelpWhatsApp to receive the code) | 'dev' (local testing)
const defaultConfig = {
  freeSkuLimit: PLATFORM.freeSkuLimit,
  platformName: PLATFORM.name,
  otpDelivery: 'manual',
  otpHelpWhatsApp: PLATFORM.whatsappNumber,
  customerLogin: 'email', // 'email' | 'mobile' (server CUSTOMER_LOGIN)
  ownerLogin: 'email', // 'email' | 'mobile' (server OWNER_LOGIN)
  googleClientId: '', // Google Sign-In web client ID from the server ('' = off)
};

export function SessionProvider({ children }) {
  const [appConfig, setAppConfig] = useState(() => {
    try {
      return { ...defaultConfig, ...JSON.parse(localStorage.getItem(CONFIG_KEY)) };
    } catch {
      return defaultConfig;
    }
  });
  const [owner, setOwner] = useState(undefined); // undefined = not checked yet
  const [customer, setCustomer] = useState(undefined);
  const [admin, setAdmin] = useState(undefined);

  useEffect(() => {
    get('/config')
      .then((c) => {
        setAppConfig(c);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
      })
      .catch(() => {});
  }, []);

  const loadOwner = useCallback(() => get('/auth/me').then((r) => setOwner(r.user), () => setOwner(null)), []);
  const loadAdmin = useCallback(() => get('/platform/me').then((r) => setAdmin(r.admin), () => setAdmin(null)), []);
  const loadCustomer = useCallback(
    () => get('/customer/me').then((r) => setCustomer(r.customer), (err) => err.status !== 0 && setCustomer(null)),
    [],
  );

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  const value = useMemo(
    () => ({
      appConfig,
      /** Sends an OTP to { phone } (owners) or { email } (customers). Returns { delivery, devCode? } — devCode only in local dev. */
      requestOtp: (to, purpose, name, language) =>
        post('/otp/request', { ...to, purpose, ...(name ? { name } : {}), ...(language ? { language } : {}) }),

      owner,
      loadOwner,
      setOwner,
      // Owners: mobile + OTP — register { storeName, phone, code }, login { phone, code }. Customers: email + OTP.
      registerOwner: async (body) => setOwner((await post('/auth/register', body)).user),
      loginOwner: async (body) => setOwner((await post('/auth/login', body)).user),
      /** OWNER_LOGIN=email, sign-in and sign-up: { email, code, storeName?, businessType? } → { user, created } or { needsStore }. */
      authOwnerEmail: async (body) => {
        const r = await post('/auth/email', body);
        if (r.user) setOwner(r.user);
        return r;
      },
      /** Google Sign-In for owners: { credential, storeName?, businessType? } → { user, created } or { needsStore }. */
      authOwnerGoogle: async (body) => {
        const r = await post('/auth/google', body);
        if (r.user) setOwner(r.user);
        return r;
      },
      logoutOwner: async () => {
        await post('/auth/logout').catch(() => {});
        setOwner(null);
      },

      customer,
      /** One call for sign-in and sign-up: { email|phone, code, name? } → { customer } or { needsName: true }. */
      authCustomer: async (body) => {
        const r = await post('/customer/auth', body);
        if (r.customer) setCustomer(r.customer);
        return r;
      },
      /** Google Sign-In for shoppers: { credential } → { customer } (the account is created on first use). */
      authCustomerGoogle: async (body) => setCustomer((await post('/customer/google', body)).customer),
      updateCustomer: async (body) => setCustomer((await put('/customer/me', body)).customer),
      logoutCustomer: async () => {
        await post('/customer/logout').catch(() => {});
        setCustomer(null);
      },

      admin,
      loadAdmin,
      loginAdmin: async (body) => setAdmin((await post('/platform/login', body)).admin),
      logoutAdmin: async () => {
        await post('/platform/logout').catch(() => {});
        setAdmin(null);
      },
    }),
    [appConfig, owner, customer, admin, loadOwner, loadAdmin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
