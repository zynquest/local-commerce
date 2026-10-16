import { useMemo, useState } from 'react';
import { CalendarCheck, Clock, UserRound } from 'lucide-react';
import StoreHeader from '../components/StoreHeader.jsx';
import StoreFooter from '../components/StoreFooter.jsx';
import SmartImage from '../components/SmartImage.jsx';
import BookingSheet from '../components/BookingSheet.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { formatMoney } from '../lib/format.js';
import { useSeo } from '../lib/seo.js';
import { whatsappLink } from '../services/whatsappService.js';
import { rich, useI18n } from '../i18n/index.jsx';

/** Public page of an appointment business: services (duration, price), the team, and "Book" → BookingSheet. */
export default function BookingStorefront() {
  const { t, dayName } = useI18n();
  const { store: config, services, specialists, basePath } = useStore();
  const [booking, setBooking] = useState(null); // null | { serviceId }
  useSeo({
    title: config.city
      ? t('seo.storeTitleCity', { name: config.name, category: config.category || t('seo.storeWord'), city: config.city })
      : t('seo.storeTitle', { name: config.name }),
    description: config.description || t('book.seoDesc', { name: config.name }),
    path: basePath || '/',
    image: config.banner_url || config.logo_url,
    noindex: Boolean(config.preview || config.is_demo),
  });

  const groups = useMemo(() => {
    const map = new Map();
    for (const s of services) map.set(s.category || 'Other', [...(map.get(s.category || 'Other') || []), s]);
    return [...map.entries()];
  }, [services]);
  const canBook = !config.preview && services.length > 0 && specialists.length > 0;

  return (
    <div className="min-h-screen">
      <StoreHeader />
      {config.preview && (
        <div className="mx-auto mt-2 max-w-3xl px-4">
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {rich(t('store.previewBanner', { status: t(`review.status.${config.status}`) }), { b: (x) => <b>{x}</b> })}
          </p>
        </div>
      )}

      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4 pb-28">
        <section className="card flex items-center gap-3 border-violet-100 bg-violet-50/60 p-4">
          <CalendarCheck className="flex-none text-violet-600" />
          <p className="flex-1 text-sm text-violet-900">{t('book.howItWorks')}</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold">{t('book.services')}</h2>
          {groups.map(([category, items]) => (
            <div key={category} className="mb-4">
              {groups.length > 1 && <h3 className="mb-1.5 text-xs font-bold tracking-wide text-stone-500 uppercase">{category}</h3>}
              <ul className="card divide-y divide-stone-100">
                {items.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.name}</p>
                      {s.description && <p className="line-clamp-2 text-xs text-stone-500">{s.description}</p>}
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><Clock size={11} /> {t('appt.minutes', { count: s.duration_min })}</p>
                    </div>
                    <span className="flex-none font-bold">{formatMoney(s.price, config.currency_symbol)}</span>
                    <button type="button" disabled={!canBook} onClick={() => setBooking({ serviceId: s.id })} className="btn-brand flex-none px-3 py-1.5 text-sm">
                      {t('book.book')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!services.length && <p className="card p-6 text-center text-sm text-stone-500">{t('book.noServices')}</p>}
        </section>

        {specialists.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-bold">{t('book.team')}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {specialists.map((sp) => (
                <div key={sp.id} className="card flex flex-col items-center p-3 text-center">
                  {sp.photo_url ? (
                    <SmartImage src={sp.photo_url} alt={sp.name} width={128} className="h-16 w-16 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-stone-500"><UserRound size={28} /></span>
                  )}
                  <p className="mt-2 text-sm font-semibold">{sp.name}</p>
                  {sp.title && <p className="text-xs text-stone-500">{sp.title}</p>}
                  <p className="mt-1 text-[10px] text-stone-400">{['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((d) => sp.days.includes(d)).map((d) => dayName(d, 'short')).join(' ')}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <StoreFooter />
      {/* Bottom bar instead of a floating chat bubble, which would cover the "Book" buttons on phones. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2">
          <button type="button" disabled={!canBook} onClick={() => setBooking({})} className="btn-brand flex-1 py-3">
            <CalendarCheck size={18} /> {t('book.bookNow')}
          </button>
          {config.whatsapp_number && (
            <a
              href={whatsappLink(config.whatsapp_number, t('store.chatGreeting', { name: config.name }))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('store.chatOnWhatsApp')}
              className="btn-whatsapp px-4"
            >
              <WhatsAppIcon size={22} />
            </a>
          )}
        </div>
      </div>
      {booking && <BookingSheet initialServiceId={booking.serviceId} onClose={() => setBooking(null)} />}
    </div>
  );
}
