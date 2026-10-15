import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, ChevronDown, LogIn, Menu, ReceiptText, Store, StoreIcon, UserPlus, X } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useT } from '../i18n/index.jsx';
import { PLATFORM } from '../config.js';

/**
 * Platform header. Shopper links (browse stores, my orders) and business links (register, merchant
 * login) are visually separated so shoppers and shop owners each find "their" entry point.
 * The language picker is always visible at the top, on phones too.
 */
export default function SiteHeader() {
  const t = useT();
  const { owner, customer, loadOwner } = useSession();
  const [bizOpen, setBizOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (owner === undefined) loadOwner();
  }, [owner, loadOwner]);

  useEffect(() => {
    if (!bizOpen) return;
    const close = (e) => !menuRef.current?.contains(e.target) && setBizOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [bizOpen]);

  const businessLinks = owner ? (
    <Link to="/merchant" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-stone-100">
      <Briefcase size={16} className="text-brand" /> {t('nav.dashboard')}
    </Link>
  ) : (
    <>
      <Link to="/register" className="flex items-start gap-2 rounded-lg px-3 py-2 hover:bg-stone-100">
        <UserPlus size={16} className="mt-0.5 text-brand" />
        <span>
          <span className="block text-sm font-semibold">{t('nav.register')}</span>
          <span className="block text-xs text-stone-500">{t('nav.registerHint', { limit: PLATFORM.freeSkuLimit })}</span>
        </span>
      </Link>
      <Link to="/login" className="flex items-start gap-2 rounded-lg px-3 py-2 hover:bg-stone-100">
        <LogIn size={16} className="mt-0.5 text-stone-500" />
        <span>
          <span className="block text-sm font-semibold">{t('nav.ownerLogin')}</span>
          <span className="block text-xs text-stone-500">{t('nav.ownerLoginHint')}</span>
        </span>
      </Link>
    </>
  );

  const ordersLabel = customer ? t('nav.myOrders') : t('nav.trackOrders');

  return (
    <nav className="sticky top-0 z-30 border-b border-stone-100 bg-white/90 backdrop-blur" aria-label={t('nav.main')}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-extrabold">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand text-white">
            <Store size={18} />
          </span>
          <span className="truncate">{PLATFORM.name}</span>
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-2 lg:flex">
          <div className="flex items-center gap-1 rounded-full bg-stone-100 p-1" role="group" aria-label={t('nav.forShoppers')}>
            <span className="px-2 text-[10px] font-bold tracking-wider text-stone-400 uppercase">{t('nav.shoppers')}</span>
            <Link to="/stores" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-white">
              <StoreIcon size={15} /> {t('nav.shopStores')}
            </Link>
            <Link to="/account" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-white">
              <ReceiptText size={15} /> {ordersLabel}
            </Link>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setBizOpen(!bizOpen)}
              aria-expanded={bizOpen}
              className="flex items-center gap-1.5 rounded-full border-2 border-brand px-4 py-1.5 text-sm font-bold text-brand hover:bg-brand hover:text-white"
            >
              <Briefcase size={15} /> {t('nav.forBusiness')} <ChevronDown size={14} className={bizOpen ? 'rotate-180' : ''} />
            </button>
            {bizOpen && (
              <div className="absolute end-0 mt-2 w-72 animate-fade-up rounded-2xl border border-stone-200 bg-white p-2 shadow-xl">
                {businessLinks}
              </div>
            )}
          </div>
          <LanguageSwitcher />
        </div>

        {/* Mobile / tablet */}
        <div className="flex items-center gap-2 lg:hidden">
          <LanguageSwitcher />
          <button onClick={() => setMobileOpen(!mobileOpen)} aria-label={t('common.menu')} aria-expanded={mobileOpen} className="rounded-lg p-1.5">
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="space-y-4 border-t border-stone-100 bg-white px-4 py-4 lg:hidden">
          <div>
            <p className="mb-1 px-3 text-[10px] font-bold tracking-wider text-stone-400 uppercase">{t('nav.forShoppers')}</p>
            <Link to="/stores" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-stone-100">
              <StoreIcon size={16} /> {t('nav.shopStores')}
            </Link>
            <Link to="/account" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-stone-100">
              <ReceiptText size={16} /> {ordersLabel}
            </Link>
          </div>
          <div>
            <p className="mb-1 px-3 text-[10px] font-bold tracking-wider text-stone-400 uppercase">{t('nav.forOwners')}</p>
            {businessLinks}
          </div>
        </div>
      )}
    </nav>
  );
}
