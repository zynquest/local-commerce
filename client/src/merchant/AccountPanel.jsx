import { Globe, Smartphone, Sparkles } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { PLATFORM } from '../config.js';
import { whatsappLink } from '../services/whatsappService.js';
import { rich, useT } from '../i18n/index.jsx';

const formatPhone = (p) => (p ? `+${p.slice(0, p.length - 10)} ${p.slice(-10, -5)} ${p.slice(-5)}` : '—');

export default function AccountPanel({ store, phone }) {
  const t = useT();
  const contact = whatsappLink(
    PLATFORM.whatsappNumber,
    t('plan.upgradeMsg', { store: store.name, url: `${window.location.origin}/s/${store.slug}`, brand: PLATFORM.name, limit: PLATFORM.freeSkuLimit }),
  );
  const usagePct = Math.min(100, (store.sku_used / store.sku_limit) * 100);

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Sparkles size={18} className="text-brand" /> {store.plan === 'free' ? t('plan.free', { limit: store.sku_limit }) : t('plan.paid', { limit: store.sku_limit })}
        </h2>
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span>{t('plan.activeProducts')}</span>
            <b>
              {store.sku_used} / {store.sku_limit}
            </b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-100">
            <div className={`h-full ${usagePct > 90 ? 'bg-rose-500' : 'bg-brand'}`} style={{ width: `${usagePct}%` }} />
          </div>
        </div>
        {store.custom_domain ? (
          <p className="flex items-center gap-2 text-sm"><Globe size={16} className="text-brand" /> {rich(t('plan.customDomain', { domain: store.custom_domain }), { b: (x) => <b>{x}</b> })}</p>
        ) : (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">{t('plan.needMore', { limit: PLATFORM.freeSkuLimit })}</p>
            <p className="mt-1 text-emerald-800">
              {rich(t('plan.paidPitch', { limit: PLATFORM.freeSkuLimit }), { b: (x) => <b>{x}</b> })}
            </p>
            <a href={contact} target="_blank" rel="noopener noreferrer" className="btn-whatsapp mt-3 py-2">
              <WhatsAppIcon size={16} /> {t('plan.upgrade')}
            </a>
          </div>
        )}
      </div>

      <div className="card space-y-2 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Smartphone size={18} className="text-brand" /> {t('plan.loginTitle')}
        </h2>
        <p className="text-sm text-stone-600">{rich(t('plan.loginInfo', { phone: formatPhone(phone) }), { b: (x) => <b dir="ltr">{x}</b> })}</p>
      </div>
    </div>
  );
}
