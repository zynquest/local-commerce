import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarCheck, Check, Clock, Loader2, UserRound, Users, X } from 'lucide-react';
import SmartImage from './SmartImage.jsx';
import WhatsAppIcon from './WhatsAppIcon.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useStore } from '../context/StoreContext.jsx';
import { get, post } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { buildBookingMessage, orderMessageLanguage, whatsappLink } from '../services/whatsappService.js';
import { loadCatalog, makeT, useI18n } from '../i18n/index.jsx';

const ANY = 'any';

/**
 * Booking flow: service → specialist (or any) → date → free time → name + mobile → slot held → send on WhatsApp.
 * The slot is reserved as soon as the request is created; the business confirms it on WhatsApp / in its dashboard.
 */
export default function BookingSheet({ initialServiceId, onClose }) {
  const { t, lang, formatDay, formatClock } = useI18n();
  const { store, services, specialists, slug } = useStore();
  const { customer } = useSession();
  const [serviceId, setServiceId] = useState(initialServiceId || null);
  const [specialistId, setSpecialistId] = useState(null);
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [days, setDays] = useState({ loading: false, list: [] });
  const [slots, setSlots] = useState({ loading: false, list: [] });
  const [details, setDetails] = useState({ name: customer?.name || '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [booked, setBooked] = useState(null);

  const service = services.find((s) => s.id === serviceId);
  const team = useMemo(() => specialists.filter((sp) => sp.service_ids.includes(serviceId)), [specialists, serviceId]);
  const spParam = specialistId && specialistId !== ANY ? `&specialist=${specialistId}` : '';
  const step = booked ? 'done' : !service ? 'service' : !specialistId ? 'specialist' : !date ? 'date' : !time ? 'time' : 'details';

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Skip the specialist step when only one person offers the service.
  useEffect(() => {
    if (service && !specialistId && team.length === 1) setSpecialistId(team[0].id);
  }, [service, team, specialistId]);

  useEffect(() => {
    if (!service || !specialistId) return;
    let alive = true;
    setDays({ loading: true, list: [] });
    get(`/stores/${slug}/availability?service=${service.id}${spParam}`)
      .then((r) => alive && setDays({ loading: false, list: r.days }))
      .catch((err) => alive && (setDays({ loading: false, list: [] }), setError(err.message)));
    return () => {
      alive = false;
    };
  }, [service, specialistId, slug, spParam]);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setSlots({ loading: true, list: [] });
    get(`/stores/${slug}/availability?service=${service.id}&date=${date}${spParam}`)
      .then((r) => alive && setSlots({ loading: false, list: r.slots }))
      .catch((err) => alive && (setSlots({ loading: false, list: [] }), setError(err.message)));
    return () => {
      alive = false;
    };
  }, [date, service, slug, spParam]);

  const back = () => {
    setError('');
    if (step === 'details') setTime(null);
    else if (step === 'time') setDate(null);
    else if (step === 'date') {
      // With a single specialist that step was skipped automatically, so go back to the service list.
      if (team.length === 1) {
        if (initialServiceId) return onClose();
        setServiceId(null);
      }
      setSpecialistId(null);
    } else if (step === 'specialist') setServiceId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!details.name.trim()) return setError(t('book.enterName'));
    setBusy(true);
    setError('');
    try {
      const { appointment } = await post(`/stores/${slug}/appointments`, {
        service_id: service.id,
        ...(specialistId !== ANY ? { specialist_id: specialistId } : {}),
        date,
        time,
        name: details.name,
        // No number asked: the request is sent on WhatsApp. A signed-in customer's number is passed along.
        ...(customer?.phone ? { phone: customer.phone.slice(-10) } : {}),
        notes: details.notes,
        language: lang,
      });
      const msgLang = orderMessageLanguage(store, lang);
      await loadCatalog(msgLang).catch(() => {});
      const locale = msgLang === 'en' ? 'en-IN' : msgLang;
      const message = buildBookingMessage(store, { ...appointment, duration_min: service.duration_min }, {
        t: makeT(msgLang),
        formatDay: (d) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)),
        formatClock: (x) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2026-01-01T${x}:00Z`)),
      });
      setBooked({ appointment, url: whatsappLink(store.whatsapp_number, message) });
    } catch (err) {
      setError(err.message);
      if (err.status === 409) {
        setTime(null); // slot taken meanwhile → back to the time list, refreshed
        setSlots({ loading: true, list: [] });
        get(`/stores/${slug}/availability?service=${service.id}&date=${date}${spParam}`).then((r) => setSlots({ loading: false, list: r.slots })).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  const chosenSpecialist = specialists.find((s) => s.id === specialistId);
  const summary = service && (
    <div className="rounded-xl bg-stone-50 p-3 text-sm">
      <p className="font-semibold">{service.name}</p>
      <p className="text-xs text-stone-500">
        {t('appt.minutes', { count: service.duration_min })} · {formatMoney(service.price, store.currency_symbol)}
        {specialistId && <> · {specialistId === ANY ? t('book.anySpecialist') : chosenSpecialist?.name}</>}
        {date && <> · {formatDay(date)}</>}
        {time && <> · <span dir="ltr">{formatClock(time)}</span></>}
      </p>
    </div>
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={booked ? undefined : onClose} aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[92vh] animate-fade-up flex-col rounded-t-3xl bg-white shadow-2xl sm:top-12 sm:bottom-auto sm:mx-auto sm:w-[30rem] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('book.title')}
        dir={document.documentElement.dir || 'ltr'}
      >
        <div className="flex items-center gap-2 border-b border-stone-100 p-4">
          {!['service', 'done'].includes(step) && !(step === 'specialist' && initialServiceId) && (
            <button type="button" onClick={back} className="rounded-full p-1.5 hover:bg-stone-100" aria-label={t('common.back')}>
              <ArrowLeft size={18} className="rtl:rotate-180" />
            </button>
          )}
          <h2 className="flex-1 text-lg font-bold">{step === 'done' ? t('book.heldTitle') : t(`book.step.${step}`)}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-stone-100" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step !== 'service' && step !== 'done' && summary}

          {step === 'service' && (
            <ul className="space-y-2">
              {services.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setServiceId(s.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 p-3 text-start hover:border-brand">
                    <span className="min-w-0">
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-xs text-stone-500">{t('appt.minutes', { count: s.duration_min })}</span>
                    </span>
                    <span className="flex-none font-bold">{formatMoney(s.price, store.currency_symbol)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {step === 'specialist' && (
            <ul className="space-y-2">
              {team.length > 1 && (
                <li>
                  <button type="button" onClick={() => setSpecialistId(ANY)} className="flex w-full items-center gap-3 rounded-xl border-2 border-brand/40 bg-emerald-50/50 p-3 text-start hover:border-brand">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-brand"><Users size={20} /></span>
                    <span>
                      <span className="block font-semibold">{t('book.anySpecialist')}</span>
                      <span className="block text-xs text-stone-500">{t('book.anyHint')}</span>
                    </span>
                  </button>
                </li>
              )}
              {team.map((sp) => (
                <li key={sp.id}>
                  <button type="button" onClick={() => setSpecialistId(sp.id)} className="flex w-full items-center gap-3 rounded-xl border border-stone-200 p-3 text-start hover:border-brand">
                    {sp.photo_url ? (
                      <SmartImage src={sp.photo_url} alt="" width={88} className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-stone-500"><UserRound size={20} /></span>
                    )}
                    <span>
                      <span className="block font-semibold">{sp.name}</span>
                      {sp.title && <span className="block text-xs text-stone-500">{sp.title}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {!team.length && <p className="text-sm text-stone-500">{t('book.noSpecialist')}</p>}
            </ul>
          )}

          {step === 'date' && (
            <>
              {days.loading && <div className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></div>}
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {days.list.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!d.available}
                    onClick={() => setDate(d.date)}
                    className="flex flex-col items-center rounded-xl border border-stone-200 p-2 text-center enabled:hover:border-brand disabled:opacity-35"
                    data-date={d.date}
                  >
                    <span className="text-[11px] text-stone-500">{formatDay(d.date, { weekday: 'short' })}</span>
                    <span className="text-lg font-bold">{formatDay(d.date, { day: 'numeric' })}</span>
                    <span className="text-[10px] text-stone-500">{formatDay(d.date, { month: 'short' })}</span>
                  </button>
                ))}
              </div>
              {!days.loading && days.list.length > 0 && !days.list.some((d) => d.available) && <p className="text-sm text-stone-500">{t('book.noDays')}</p>}
            </>
          )}

          {step === 'time' && (
            <>
              {slots.loading && <div className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></div>}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" dir="ltr">
                {slots.list.map((s) => (
                  <button key={s.time} type="button" onClick={() => setTime(s.time)} className="rounded-xl border border-stone-200 py-2.5 text-sm font-semibold hover:border-brand hover:bg-emerald-50" data-time={s.time}>
                    {formatClock(s.time)}
                  </button>
                ))}
              </div>
              {!slots.loading && !slots.list.length && <p className="text-sm text-stone-500">{t('book.noTimes')}</p>}
            </>
          )}

          {step === 'details' && (
            <form onSubmit={submit} className="space-y-3" noValidate>
              <div>
                <label className="label" htmlFor="bk-name">{t('book.yourName')}</label>
                <input id="bk-name" className="input" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} autoComplete="name" maxLength={60} />
              </div>
              <div>
                <label className="label" htmlFor="bk-notes">{t('book.notes')}</label>
                <textarea id="bk-notes" className="input" rows={2} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} maxLength={500} placeholder={t('book.notesPlaceholder')} />
              </div>
              <button disabled={busy} className="btn-whatsapp w-full py-3">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <CalendarCheck size={18} />} {t('book.holdSlot')}
              </button>
              <p className="text-center text-[11px] text-stone-500">{t('book.holdHint')}</p>
            </form>
          )}

          {step === 'done' && (
            <div className="space-y-3 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={28} /></span>
              <p className="text-sm text-stone-600">{t('book.heldBody')}</p>
              <div className="rounded-xl bg-stone-50 p-3 text-start text-sm">
                <p className="font-mono text-xs text-stone-500">{booked.appointment.code}</p>
                <p className="font-semibold">{booked.appointment.service_name} · {booked.appointment.specialist_name}</p>
                <p className="flex items-center gap-1 text-stone-600">
                  <Clock size={14} /> {formatDay(booked.appointment.date, { weekday: 'long', day: 'numeric', month: 'long' })},{' '}
                  <span dir="ltr">{formatClock(booked.appointment.time)} – {formatClock(booked.appointment.end_time)}</span>
                </p>
              </div>
              <a href={booked.url} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full py-3 text-base" data-testid="send-booking">
                <WhatsAppIcon size={20} /> {t('book.sendWhatsApp')}
              </a>
              <p className="text-[11px] text-stone-500">{t('book.sendHint')}</p>
            </div>
          )}

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>
      </div>
    </>,
    document.body,
  );
}
