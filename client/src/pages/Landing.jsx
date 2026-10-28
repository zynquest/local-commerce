import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeIndianRupee, Check, Clock, Globe, ImageUp, LayoutDashboard, Minus, Plus, QrCode, ShieldCheck,
  Languages, MapPin, ShoppingBasket as StoreIcon, Smartphone, Store, UserRound, Users, WifiOff, X,
} from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import InstagramIcon from '../components/InstagramIcon.jsx';
import SiteHeader from '../components/SiteHeader.jsx';
import { useSeo } from '../lib/seo.js';
import { NearbyBar, StoreList } from './StoreDirectory.jsx';
import { PLATFORM } from '../config.js';
import { formatMoney } from '../lib/format.js';
import { buildOrderMessage, whatsappLink } from '../services/whatsappService.js';
import { rich, useI18n, useT } from '../i18n/index.jsx';

const DEMO_SLUG = 'demo';

const HERO_STORES = [
  { name: 'Gupta Kirana', tag: 'grocery', color: 'from-emerald-500 to-green-700', items: ['🌾 Atta 5kg', '🥛 Milk 1L', '🧈 Butter'] },
  { name: 'Mumbai Bakers', tag: 'bakery', color: 'from-amber-500 to-orange-700', items: ['🍞 Pav (6)', '🎂 Black Forest', '🍪 Nankhatai'] },
  { name: 'Annapoorna Mess', tag: 'restaurant', color: 'from-rose-500 to-red-700', items: ['🍛 Veg Meals', '🫓 Masala Dosa', '☕ Filter Coffee'] },
  { name: 'Sai Medicals', tag: 'pharmacy', color: 'from-sky-500 to-blue-700', items: ['💊 Paracetamol', '🩹 Bandage', '🧴 Sanitiser'] },
];

// Home-page use cases, each linking to its demo store (npm run demo:create).
const USE_CASES = [
  { key: 'grocery', emoji: '🛒', slug: 'demo' },
  { key: 'restaurant', emoji: '🍛', slug: 'demo-restaurant' },
  { key: 'bakery', emoji: '🎂', slug: 'demo-bakery' },
  { key: 'vegetables', emoji: '🥬', slug: 'demo-vegetables' },
  { key: 'flowers', emoji: '💐', slug: 'demo-flowers' },
  { key: 'electricals', emoji: '💡', slug: 'demo-electricals' },
  { key: 'salon', emoji: '💇', slug: 'demo-salon' },
  { key: 'clinic', emoji: '🦷', slug: 'demo-clinic' },
];

const demoConfig = { name: 'Shree Shivam Groceries', currency_symbol: '₹', delivery_fee: 20 };
const sandboxProducts = [
  ['GROC-ATT-001', '🌾', 'Aashirvaad Shudh Chakki Atta 5kg', 260, 235],
  ['GROC-RIC-002', '🍚', 'India Gate Basmati Rice Classic 1kg', 210, 179],
  ['GROC-DAL-003', '🫘', 'Tata Sampann Toor Dal 1kg', 199, 172],
  ['DAI-BUT-002', '🧈', 'Amul Salted Butter 500g', 285, 275],
  ['DAI-MLK-004', '🥛', 'Nandini Toned Milk 1L', 52, 52],
].map(([sku_id, emoji, name, mrp, offer_price]) => ({ sku_id, emoji, name, mrp, offer_price }));

function PhoneMockup() {
  const t = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((n) => (n + 1) % HERO_STORES.length), 2800);
    return () => clearInterval(timer);
  }, []);
  const s = HERO_STORES[i];
  return (
    <div className="relative mx-auto w-64 animate-float">
      <div className="rounded-[2.5rem] border-[10px] border-stone-900 bg-white shadow-2xl">
        <div className="overflow-hidden rounded-[1.8rem]">
          <div key={s.name} className={`animate-fade-up bg-gradient-to-br ${s.color} p-4 pt-8 text-white`}>
            <p className="text-[10px] font-semibold tracking-widest uppercase opacity-80">{t(`landing.mock.${s.tag}`)}</p>
            <p className="text-lg font-extrabold">{s.name}</p>
            <p className="mt-1 flex items-center gap-1 text-[10px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {t('landing.mock.openNow')}
            </p>
          </div>
          <div key={`${s.name}-grid`} className="grid animate-fade-up grid-cols-2 gap-2 bg-stone-50 p-3">
            {s.items.concat(`➕ ${t('cart.customList')}`).map((it) => (
              <div key={it} className="rounded-xl bg-white p-2 text-center shadow-sm">
                <div className="text-2xl">{it.split(' ')[0]}</div>
                <div className="truncate text-[10px] font-medium text-stone-600">{it.split(' ').slice(1).join(' ')}</div>
                <div className="mt-1 rounded-md border border-emerald-600 text-[9px] font-bold text-emerald-700">{t('product.add')}</div>
              </div>
            ))}
          </div>
          <div className="bg-stone-50 px-3 pb-4">
            <div className="flex items-center justify-center gap-1 rounded-xl bg-whatsapp py-2 text-[11px] font-bold text-white">
              <WhatsAppIcon size={12} /> {t('cart.placeOrder')}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute top-24 -end-16 hidden w-44 rotate-3 rounded-2xl rounded-se-none bg-[#dcf8c6] p-3 text-[10px] shadow-xl sm:block">
        <p className="font-bold">🛍️ {t('wa.newOrder', { code: 'ORD-7K2Q' })}</p>
        <p>1. Atta 5kg × 1 = ₹235</p>
        <p>2. Milk 1L × 2 = ₹104</p>
        <p className="mt-1 font-bold">💰 {t('wa.total')}: ₹359</p>
      </div>
      <div className="absolute bottom-16 -start-14 hidden -rotate-3 rounded-2xl bg-white px-3 py-2 text-[11px] font-bold shadow-xl sm:block">
        {rich(t('landing.mock.zero'), { b: (x) => <span className="text-emerald-600">{x}</span> })} ✨
      </div>
    </div>
  );
}

function SavingsCalculator() {
  const t = useT();
  const [orders, setOrders] = useState(40);
  const [aov, setAov] = useState(450);
  const monthlyRevenue = orders * aov * 30;
  const lost = monthlyRevenue * PLATFORM.aggregatorCommission;
  const fmt = (n) => formatMoney(Math.round(n));

  return (
    <div className="card grid gap-6 p-6 md:grid-cols-2 md:p-8">
      <div className="space-y-6">
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <label htmlFor="calc-orders" className="font-semibold">{t('landing.calc.orders')}</label>
            <b className="text-brand">{orders}</b>
          </div>
          <input id="calc-orders" type="range" min="5" max="300" step="5" value={orders} onChange={(e) => setOrders(+e.target.value)} className="w-full accent-[var(--brand)]" />
        </div>
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <label htmlFor="calc-aov" className="font-semibold">{t('landing.calc.aov')}</label>
            <b className="text-brand">{fmt(aov)}</b>
          </div>
          <input id="calc-aov" type="range" min="100" max="3000" step="50" value={aov} onChange={(e) => setAov(+e.target.value)} className="w-full accent-[var(--brand)]" />
        </div>
        <p className="text-sm text-stone-500">
          {rich(t('landing.calc.monthly', { amount: fmt(monthlyRevenue) }), { b: (x) => <b className="text-stone-800">{x}</b> })}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-2xl bg-rose-50 p-4">
          <p className="text-xs font-semibold text-rose-700 uppercase">{t('landing.calc.aggregators')}</p>
          <p className="text-[11px] text-rose-600">{t('landing.calc.commission', { pct: PLATFORM.aggregatorCommission * 100 })}</p>
          <p className="mt-3 text-2xl font-extrabold text-rose-700">−{fmt(lost)}</p>
          <p className="text-xs text-rose-600">{t('landing.calc.lost')}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-700 uppercase">{PLATFORM.name}</p>
          <p className="text-[11px] text-emerald-600">{t('landing.calc.commission', { pct: 0 })}</p>
          <p className="mt-3 text-2xl font-extrabold text-emerald-700">₹0</p>
          <p className="text-xs text-emerald-600">{t('landing.calc.keep')}</p>
        </div>
        <div className="col-span-2 rounded-2xl bg-stone-900 p-4 text-white">
          <p className="text-xs uppercase opacity-70">{t('landing.calc.perYear')}</p>
          <p className="text-3xl font-extrabold text-emerald-400">{fmt(lost * 12)}</p>
        </div>
      </div>
    </div>
  );
}

function Sandbox() {
  const { t, lang } = useI18n();
  const [qty, setQty] = useState({ [sandboxProducts[0].sku_id]: 1, [sandboxProducts[3].sku_id]: 2 });
  const [notes, setNotes] = useState(null); // null = show the translated sample note
  const items = sandboxProducts.filter((p) => qty[p.sku_id] > 0).map((p) => ({ ...p, quantity: qty[p.sku_id] }));
  const noteText = notes ?? t('landing.sandbox.sampleNote');
  const order = useMemo(
    () => buildOrderMessage({ ...demoConfig, order_language: lang }, items, noteText, { name: t('landing.sandbox.customer') }, { orderId: 'ORD-DEMO01', t }),
    [items, noteText, lang, t],
  );
  const bump = (sku, d) => setQty((q) => ({ ...q, [sku]: Math.max(0, Math.min(9, (q[sku] || 0) + d)) }));

  // Render WhatsApp markdown (*bold*, _italic_) for the preview bubble.
  const preview = order.message.split('\n').map((line, i) => (
    <p key={i} className="min-h-[1em] whitespace-pre-wrap">
      {line.split(/(\*[^*]+\*|_[^_]+_)/g).map((part, j) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <b key={j}>{part.slice(1, -1)}</b>
        ) : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? (
          <i key={j}>{part.slice(1, -1)}</i>
        ) : (
          part
        ),
      )}
    </p>
  ));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card min-w-0 p-4">
        <p className="mb-3 text-sm font-bold">{t('landing.sandbox.step1')}</p>
        <ul className="divide-y divide-stone-100">
          {sandboxProducts.map((p) => (
            <li key={p.sku_id} className="flex items-center gap-3 py-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-xl">{p.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-stone-500">{formatMoney(p.offer_price)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => bump(p.sku_id, -1)} className="rounded-lg border border-stone-200 p-1" aria-label={t('product.decrease')}>
                  <Minus size={14} />
                </button>
                <span className="w-4 text-center text-sm font-bold tabular-nums">{qty[p.sku_id] || 0}</span>
                <button onClick={() => bump(p.sku_id, 1)} className="rounded-lg border border-stone-200 p-1" aria-label={t('product.increase')}>
                  <Plus size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 mb-2 text-sm font-bold">{t('landing.sandbox.step2')}</p>
        <textarea value={noteText} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" />
      </div>
      <div className="flex min-w-0 flex-col rounded-2xl bg-[#efeae2] p-4">
        <p className="mb-3 text-sm font-bold">{t('landing.sandbox.step3')}</p>
        <div className="max-h-96 flex-1 overflow-y-auto rounded-2xl rounded-se-none bg-[#dcf8c6] p-3 font-sans text-[13px] leading-snug shadow-sm">
          {preview}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href={whatsappLink(PLATFORM.whatsappNumber, order.message)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
            <WhatsAppIcon size={18} /> {t('landing.sandbox.send')}
          </a>
          <Link to={`/s/${DEMO_SLUG}`} className="btn-ghost">
            {t('landing.sandbox.openDemo')} <ArrowRight size={16} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// FAQ text lives in the locale files (landing.faq.qN / aN) and is also rendered as FAQPage JSON-LD by the server.
const FAQ_COUNT = 9;
// Where the platform was built: Sonsari village, Janjgir-Champa district, Chhattisgarh (pincode 495553).
export const SONSARI = { lat: 21.9415764, lng: 82.3926376 };
const SONSARI_MAP_EMBED = `https://maps.google.com/maps?q=${SONSARI.lat},${SONSARI.lng}&z=13&output=embed`;
const SONSARI_MAP_LINK = `https://www.google.com/maps/search/?api=1&query=${SONSARI.lat},${SONSARI.lng}`;
const COMPARISON = ['commission', 'payouts', 'data', 'pricing', 'tools'];
const FEATURES = [
  ['console', LayoutDashboard],
  ['whatsapp', WhatsAppIcon],
  ['app', Smartphone],
  ['offline', WifiOff],
  ['photos', ImageUp],
  ['dashboard', ShieldCheck],
  ['guests', UserRound],
  ['qr', QrCode],
  ['languages', Languages],
];

export default function Landing() {
  const { t } = useI18n();
  useSeo({
    title: t('seo.homeTitle', { brand: PLATFORM.name }),
    description: t('seo.homeDesc'),
    path: '/',
    image: '/og-image.png',
    localized: true,
  });
  const contact = whatsappLink(PLATFORM.whatsappNumber, t('landing.customMsg', { brand: PLATFORM.name }));
  const feats = (k, n) => Array.from({ length: n }, (_, i) => t(`landing.pricing.${k}${i + 1}`, { limit: PLATFORM.freeSkuLimit }));

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50 to-white">
        <div className="pointer-events-none absolute -top-24 -end-24 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -start-24 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 md:grid-cols-2 md:py-24">
          <div className="animate-fade-up">
            <h1 className="text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
              {t('landing.hero.line1')}
              <br />
              <span className="text-brand">{t('landing.hero.line2')}</span>
              <br />
              {t('landing.hero.line3')}
            </h1>
            <p className="mt-5 max-w-lg text-lg text-stone-600">
              {t('landing.hero.body')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:flex-nowrap lg:whitespace-nowrap">
              <Link to="/register" className="btn-brand px-6 py-3.5 text-base">
                <Store size={20} /> {t('nav.register')}
              </Link>
              {/* Shoppers' way in on phones and tablets, where the header keeps it in the menu (desktop header shows it). */}
              <Link to="/stores" className="btn border-2 border-brand bg-white px-6 py-3.5 text-base text-brand hover:bg-emerald-50 lg:hidden">
                <StoreIcon size={20} /> {t('nav.shopStores')}
              </Link>
              <Link to={`/s/${DEMO_SLUG}`} className="btn-ghost px-6 py-3.5 text-base">
                {t('landing.hero.demo')} <ArrowRight size={18} className="rtl:rotate-180" />
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-stone-600">
              <span className="flex items-center gap-1.5"><BadgeIndianRupee size={18} className="text-brand" /> {t('landing.hero.p1')}</span>
              <span className="flex items-center gap-1.5"><Clock size={18} className="text-brand" /> {t('landing.hero.p2')}</span>
              <span className="flex items-center gap-1.5"><Users size={18} className="text-brand" /> {t('landing.hero.p3')}</span>
            </div>
          </div>
          <PhoneMockup />
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-stone-50 py-16" aria-labelledby="use-cases">
        <div className="mx-auto max-w-6xl px-4">
        <h2 id="use-cases" className="text-center text-3xl font-extrabold">{t('landing.useCases.title')}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-stone-600">{t('landing.useCases.subtitle')}</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((u) => (
            <Link
              key={u.key}
              to={`/s/${u.slug}`}
              className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="text-4xl" aria-hidden="true">{u.emoji}</span>
              <h3 className="mt-3 font-bold">{t(`landing.useCases.${u.key}Title`)}</h3>
              <p className="mt-1 flex-1 text-sm text-stone-600">{t(`landing.useCases.${u.key}Body`)}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                {t('landing.useCases.demo')} <ArrowRight size={14} className="transition group-hover:translate-x-0.5 rtl:rotate-180" />
              </span>
            </Link>
          ))}
        </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold">{t('landing.how.title')}</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-extrabold text-white">{n}</span>
              <h3 className="mt-4 font-bold">{t(`landing.how.s${n}Title`)}</h3>
              <p className="mt-1 text-sm text-stone-600">{t(`landing.how.s${n}Body`, { limit: PLATFORM.freeSkuLimit })}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Calculator */}
      <section className="bg-stone-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-extrabold">{t('landing.calc.title')}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-stone-600">
            {t('landing.calc.subtitle')}
          </p>
          <div className="mt-10">
            <SavingsCalculator />
          </div>
        </div>
      </section>

      {/* Sandbox */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold">{t('landing.sandbox.title')}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-stone-600">
          {t('landing.sandbox.subtitle')}
        </p>
        <div className="mt-10">
          <Sandbox />
        </div>
      </section>

      {/* Comparison */}
      <section className="bg-stone-50 py-16">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="text-center text-3xl font-extrabold">{t('landing.compare.title')}</h2>
          <div className="card mt-10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-100 text-start">
                  <th className="p-3 sm:p-4" />
                  <th className="p-3 sm:p-4">{t('landing.compare.them')}</th>
                  <th className="p-3 text-brand sm:p-4">{PLATFORM.name}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((k) => (
                  <tr key={k} className="border-t border-stone-100">
                    <th className="p-3 text-start font-semibold sm:p-4">{t(`landing.compare.${k}`)}</th>
                    <td className="p-3 text-stone-600 sm:p-4">
                      <X size={14} className="me-1 inline text-rose-500" />
                      {t(`landing.compare.${k}Them`)}
                    </td>
                    <td className="p-3 font-medium sm:p-4">
                      <Check size={14} className="me-1 inline text-emerald-600" />
                      {t(`landing.compare.${k}Us`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Stores */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-extrabold">{t('landing.stores.title')}</h2>
            <p className="mt-1 text-stone-600">{t('landing.stores.subtitle')}</p>
          </div>
          <Link to="/stores" className="flex-none text-sm font-semibold text-brand">{t('common.seeAll')} <span className="inline-block rtl:rotate-180">→</span></Link>
        </div>
        <NearbyBar className="mt-4" />
        <div className="mt-4">
          <StoreList limit={6} />
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-stone-50 py-16">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="text-center text-3xl font-extrabold">{t('landing.pricing.title')}</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="card flex flex-col p-6">
              <p className="text-sm font-bold text-brand uppercase">{t('landing.pricing.free')}</p>
              <p className="mt-2 text-4xl font-extrabold">₹0<span className="text-base font-medium text-stone-500"> / {t('landing.pricing.forever')}</span></p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {feats('freeF', 5).map((f) => (
                  <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 flex-none text-emerald-600" /> {f}</li>
                ))}
              </ul>
              <Link to="/register" className="btn-brand mt-6 w-full py-3">{t('landing.pricing.registerFree')}</Link>
            </div>
            <div className="card flex flex-col border-2 border-brand p-6">
              <p className="text-sm font-bold text-brand uppercase">{t('landing.pricing.paid')}</p>
              <p className="mt-2 text-4xl font-extrabold">{t('landing.pricing.paidHeadline', { limit: PLATFORM.freeSkuLimit })}</p>
              <p className="text-sm text-stone-500">{t('landing.pricing.contactPricing')}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {feats('paidF', 4).map((f) => (
                  <li key={f} className="flex gap-2"><Globe size={16} className="mt-0.5 flex-none text-brand" /> {f}</li>
                ))}
              </ul>
              <a href={contact} target="_blank" rel="noopener noreferrer" className="btn-whatsapp mt-6 w-full py-3">
                <WhatsAppIcon size={18} /> {t('landing.pricing.contact')}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold">{t('landing.features.title')}</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([k, Icon]) => (
            <div key={k} className="card p-5">
              <Icon size={24} className="text-brand" />
              <h3 className="mt-3 font-bold">{t(`landing.features.${k}Title`)}</h3>
              <p className="mt-1 text-sm text-stone-600">{t(`landing.features.${k}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SEO / keyword-rich explainer */}
      <section className="bg-stone-50 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <h2 className="text-lg font-bold">{t(`landing.seo.t${n}`)}</h2>
              <p className="mt-1 text-sm text-stone-600">{t(`landing.seo.d${n}`, { limit: PLATFORM.freeSkuLimit })}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ (mirrors the FAQPage JSON-LD rendered by the server) */}
      <section className="mx-auto max-w-3xl px-4 py-16" aria-labelledby="faq">
        <h2 id="faq" className="text-center text-3xl font-extrabold">{t('landing.faq.title')}</h2>
        <div className="mt-8 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
          {Array.from({ length: FAQ_COUNT }, (_, i) => [t(`landing.faq.q${i + 1}`), t(`landing.faq.a${i + 1}`)]).map(([q, a]) => (
            <details key={q} className="group p-4">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-2">
                  {q} <Plus size={16} className="flex-none transition group-open:rotate-45" />
                </span>
              </summary>
              <p className="mt-2 text-sm text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Our story: built in Sonsari, Chhattisgarh */}
      <section className="bg-stone-50 py-16" aria-labelledby="story">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-bold tracking-wide text-brand uppercase">🇮🇳 {t('landing.story.eyebrow')}</p>
            <h2 id="story" className="mt-2 text-3xl font-extrabold">{t('landing.story.title')}</h2>
            <p className="mt-4 text-stone-600">{t('landing.story.p1')}</p>
            <p className="mt-3 text-stone-600">{t('landing.story.p2')}</p>
            <p className="mt-3 text-stone-600">{t('landing.story.p3')}</p>
          </div>
          <figure className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <iframe
              title={t('landing.story.mapTitle')}
              src={SONSARI_MAP_EMBED}
              className="block h-72 w-full md:h-96"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            <figcaption className="flex items-center gap-2 px-4 py-3 text-sm text-stone-600">
              <MapPin size={16} className="flex-none text-brand" />
              <a href={SONSARI_MAP_LINK} target="_blank" rel="noopener noreferrer" className="hover:text-brand" dir="ltr">{t('landing.story.place')}</a>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-16">
        <div className="mx-auto max-w-4xl rounded-3xl bg-gradient-to-br from-emerald-700 to-emerald-950 p-8 text-center text-white md:p-12">
          <h2 className="text-3xl font-extrabold">{t('landing.cta.title')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-emerald-100">
            {t('landing.cta.body')}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/register" className="btn bg-white px-8 py-4 text-base text-emerald-800 hover:bg-emerald-50">
              <Store size={20} /> {t('landing.cta.register')}
            </Link>
            <a href={contact} target="_blank" rel="noopener noreferrer" className="btn-whatsapp px-8 py-4 text-base">
              <WhatsAppIcon size={22} /> {t('landing.cta.chat')}
            </a>
          </div>
          <p className="mt-3 text-sm text-emerald-200">+91 {PLATFORM.whatsappNumber.slice(2, 7)} {PLATFORM.whatsappNumber.slice(7)}</p>
        </div>
      </section>

      <footer className="border-t border-stone-100 py-8 text-center text-xs text-stone-500">
        <a
          href={PLATFORM.instagramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-stone-700 hover:text-brand"
        >
          <span className="rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-2 text-white">
            <InstagramIcon size={18} />
          </span>
          @{PLATFORM.instagramHandle}
        </a>
        <p>🇮🇳 {t('landing.madeIn')}</p>
        <p className="mt-1">
          © {new Date().getFullYear()} {PLATFORM.name} · {t('landing.tagline')} ·{' '}
          <a href="/privacy" className="underline hover:text-brand">{t('common.privacy')}</a>
        </p>
      </footer>
    </div>
  );
}
