import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, Loader2, Minus, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import MobileInput, { isMobile10 } from '../components/MobileInput.jsx';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { del, get, post, put } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';
import { whatsappLink } from '../services/whatsappService.js';
import { useI18n } from '../i18n/index.jsx';

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const national = (p) => (p ? String(p).replace(/^91/, '') : '');

/** Add or edit a khata customer: name, and a mobile for WhatsApp reminders (optional). */
function CustomerForm({ customer, onSaved, onCancel }) {
  const { t } = useI18n();
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(national(customer?.phone));
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e = {};
    if (!name.trim()) e.name = t('errors.nameRequired');
    if (phone && !isMobile10(phone)) e.phone = t('errors.validMobile10');
    if (Object.keys(e).length) return setFields(e);
    setBusy(true);
    try {
      const body = { name: name.trim(), phone: phone || null };
      const r = customer ? await put(`/merchant/khata/customers/${customer.id}`, body) : await post('/merchant/khata/customers', body);
      onSaved(r.customer);
    } catch (err) {
      setFields({ ...(err.fields || {}), _: err.fields?.phone ? '' : err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-bold">{t(customer ? 'khata.editCustomer' : 'khata.addCustomer')}</p>
        <button type="button" onClick={onCancel} className="p-1 text-stone-400" aria-label={t('common.cancel')}><X size={18} /></button>
      </div>
      <div>
        <label className="label" htmlFor="kh-name">{t('wa.name')}</label>
        <input id="kh-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        {fields.name && <p className="mt-1 text-xs text-rose-600">{fields.name}</p>}
      </div>
      <MobileInput id="kh-phone" value={phone} onChange={setPhone} label={`${t('wa.phone')} (${t('common.optional')})`} hint={t('khata.mobileHint')} error={fields.phone} />
      {fields._ && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fields._}</p>}
      <button type="button" onClick={save} disabled={busy} className="btn-brand w-full">
        {busy && <Loader2 size={16} className="animate-spin" />} {t('common.save')}
      </button>
    </div>
  );
}

/** "Gave on credit" or "Payment received": amount, what for, and the day (today unless changed). */
function EntryForm({ kind, currency, onSaved, onCancel, customerId }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIST);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const credit = kind === 'credit';
  const save = async () => {
    if (!(Number(amount) > 0)) return setError(t('errors.validAmount'));
    setBusy(true);
    setError('');
    try {
      await post(`/merchant/khata/customers/${customerId}/entries`, { kind, amount: Number(amount), note: note.trim() || null, entry_date: date });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`space-y-3 rounded-2xl border-2 p-4 ${credit ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
      <div className="flex items-center justify-between">
        <p className="font-bold">{t(credit ? 'khata.gaveCredit' : 'khata.gotPayment')}</p>
        <button type="button" onClick={onCancel} className="p-1 text-stone-400" aria-label={t('common.cancel')}><X size={18} /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kh-amount">{t('khata.amount', { currency })}</label>
          <input id="kh-amount" className="input text-lg font-bold" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="kh-date">{t('wa.apptDate')}</label>
          <input id="kh-date" className="input" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="kh-note">{t('khata.note')} ({t('common.optional')})</label>
        <input id="kh-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t(credit ? 'khata.notePlaceholderCredit' : 'khata.notePlaceholderPayment')} />
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button type="button" onClick={save} disabled={busy} className={`btn w-full text-white ${credit ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {busy && <Loader2 size={16} className="animate-spin" />} {t('common.save')}
      </button>
    </div>
  );
}

/** One customer's khata: balance, add credit / payment, mark as paid, WhatsApp reminder and statements, history by month. */
function CustomerKhata({ id, store, currency, onBack }) {
  const { t, formatDay } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null); // 'credit' | 'payment'
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const money = (n) => formatMoney(n, currency);

  const load = useCallback(() => get(`/merchant/khata/customers/${id}`).then(setData).catch((err) => setError(err.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const byMonth = useMemo(() => {
    const groups = {};
    for (const e of data?.entries || []) (groups[e.entry_date.slice(0, 7)] ||= []).push(e);
    return groups;
  }, [data]);

  if (error) return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!data) return <Loader2 className="mx-auto mt-8 animate-spin text-stone-400" />;
  const { customer, balance, months } = data;
  const monthName = (m) => formatDay(`${m}-01`, { month: 'long', year: 'numeric' });
  const upiLine = store.upi_id ? `\n${t('khata.payByUpi', { upi: store.upi_id })}` : '';
  const reminder = t('khata.reminderMsg', { name: customer.name, store: store.name, amount: money(balance) }) + upiLine;
  const statement = (m) =>
    t('khata.statementMsg', { name: customer.name, store: store.name, month: monthName(m.month), credit: money(m.credit), paid: money(m.payment), balance: money(m.closing) }) +
    (m.closing > 0 ? upiLine : '');

  const settle = async () => {
    if (!window.confirm(t('khata.confirmSettle', { name: customer.name, amount: money(balance) }))) return;
    setBusy(true);
    try {
      await post(`/merchant/khata/customers/${id}/settle`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const removeEntry = async (e) => {
    if (!window.confirm(t('khata.confirmDeleteEntry', { amount: money(e.amount) }))) return;
    await del(`/merchant/khata/entries/${e.id}`);
    load();
  };
  const removeCustomer = async () => {
    if (!window.confirm(t('khata.confirmDeleteCustomer', { name: customer.name }))) return;
    await del(`/merchant/khata/customers/${id}`);
    onBack();
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-stone-600">
        <ArrowLeft size={16} className="rtl:rotate-180" /> {t('common.back')}
      </button>
      {editing ? (
        <CustomerForm customer={customer} onSaved={() => (setEditing(false), load())} onCancel={() => setEditing(false)} />
      ) : (
        <div className="card space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-bold break-words">{customer.name}</p>
              {customer.phone && <p className="text-xs text-stone-500" dir="ltr">+{customer.phone}</p>}
            </div>
            <div className="flex flex-none gap-1">
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label={t('common.edit')}><Pencil size={16} /></button>
              <button type="button" onClick={removeCustomer} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t('common.delete')}><Trash2 size={16} /></button>
            </div>
          </div>
          <div className={`rounded-2xl p-4 text-center ${balance > 0 ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
            <p className="text-xs font-semibold uppercase">{t(balance > 0 ? 'khata.toCollect' : balance < 0 ? 'khata.advance' : 'khata.settled')}</p>
            {balance !== 0 && <p className="text-3xl font-extrabold">{money(Math.abs(balance))}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEntry('credit')} className="btn bg-rose-600 text-white hover:bg-rose-700"><Plus size={16} /> {t('khata.gaveCredit')}</button>
            <button type="button" onClick={() => setEntry('payment')} className="btn bg-emerald-600 text-white hover:bg-emerald-700"><Minus size={16} /> {t('khata.gotPayment')}</button>
          </div>
          {balance > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={settle} disabled={busy} className="btn-ghost"><CheckCircle2 size={16} className="text-emerald-600" /> {t('khata.markPaid')}</button>
              {customer.phone && (
                <a href={whatsappLink(customer.phone, reminder)} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
                  <WhatsAppIcon size={16} /> {t('khata.remind')}
                </a>
              )}
            </div>
          )}
          {!customer.phone && balance > 0 && <p className="text-[11px] text-stone-500">{t('khata.addMobileForReminders')}</p>}
        </div>
      )}

      {entry && <EntryForm kind={entry} currency={currency} customerId={id} onSaved={() => (setEntry(null), load())} onCancel={() => setEntry(null)} />}

      {!months.length && <p className="card p-8 text-center text-sm text-stone-500">{t('khata.noEntries')}</p>}
      {months.map((m) => (
        <section key={m.month} className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 bg-stone-50 px-4 py-2.5">
            <div>
              <p className="font-bold">{monthName(m.month)}</p>
              <p className="text-[11px] text-stone-500">
                {t('khata.monthLine', { credit: money(m.credit), paid: money(m.payment), balance: money(m.closing) })}
              </p>
            </div>
            {customer.phone && (
              <a href={whatsappLink(customer.phone, statement(m))} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <WhatsAppIcon size={14} /> {t('khata.sendStatement')}
              </a>
            )}
          </header>
          <ul className="divide-y divide-stone-100">
            {(byMonth[m.month] || []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-14 flex-none text-xs text-stone-500">{formatDay(e.entry_date, { day: 'numeric', month: 'short' })}</span>
                <span className="min-w-0 flex-1 break-words">
                  {e.note || t(e.kind === 'credit' ? 'khata.gaveCredit' : 'khata.gotPayment')}
                </span>
                <span className={`flex-none font-bold ${e.kind === 'credit' ? 'text-rose-700' : 'text-emerald-700'}`} dir="ltr">
                  {e.kind === 'credit' ? '+' : '−'}{money(e.amount)}
                </span>
                <button type="button" onClick={() => removeEntry(e)} className="flex-none p-1 text-stone-300 hover:text-rose-600" aria-label={t('common.delete')}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Khata tab: who owes how much, with search; open a customer to add credit / payments and send reminders. */
export default function KhataPanel({ store, currency }) {
  const { t, formatDay } = useI18n();
  const [list, setList] = useState({ loading: true, customers: [], total_due: 0, customers_due: 0, error: '' });
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(
    () =>
      get('/merchant/khata')
        .then((r) => setList({ loading: false, ...r, error: '' }))
        .catch((err) => setList((l) => ({ ...l, loading: false, error: err.message }))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (openId) return <CustomerKhata id={openId} store={store} currency={currency} onBack={() => (setOpenId(null), load())} />;

  const needle = q.trim().toLowerCase();
  const shown = list.customers.filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.phone || '').includes(needle));
  const money = (n) => formatMoney(n, currency);

  return (
    <div className="space-y-3">
      <div className="card flex items-center gap-3 p-4">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-rose-50 text-rose-600"><BookOpen size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-stone-500 uppercase">{t('khata.totalToCollect')}</p>
          <p className="text-2xl font-extrabold text-rose-700">{money(list.total_due)}</p>
          <p className="text-xs text-stone-500">{t('khata.fromCustomers', { count: list.customers_due })}</p>
        </div>
      </div>
      <p className="text-xs text-stone-500">{t('khata.intro')}</p>

      <div className="flex gap-2">
        <label className="relative flex-1">
          <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
          <input className="input ps-9" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('khata.search')} />
        </label>
        <button type="button" onClick={() => setAdding(true)} className="btn-brand flex-none"><UserPlus size={16} /> {t('khata.addCustomer')}</button>
      </div>
      {adding && <CustomerForm onSaved={(c) => (setAdding(false), setOpenId(c.id))} onCancel={() => setAdding(false)} />}
      {list.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{list.error}</p>}

      <ul className="card divide-y divide-stone-100">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 p-3 text-start hover:bg-stone-50">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-stone-100 font-bold text-stone-600">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold break-words">{c.name}</span>
                <span className="block text-xs text-stone-500">
                  {c.last_entry ? t('khata.lastEntry', { date: formatDay(c.last_entry.slice(0, 10), { day: 'numeric', month: 'short' }) }) : t('khata.noEntries')}
                </span>
              </span>
              <span className={`flex-none text-end text-sm font-bold ${c.balance > 0 ? 'text-rose-700' : c.balance < 0 ? 'text-emerald-700' : 'text-stone-400'}`}>
                {c.balance === 0 ? t('khata.settled') : money(Math.abs(c.balance))}
                {c.balance < 0 && <span className="block text-[10px] font-semibold">{t('khata.advance')}</span>}
              </span>
            </button>
          </li>
        ))}
        {list.loading && <li className="flex justify-center p-6"><Loader2 className="animate-spin text-stone-400" /></li>}
        {!list.loading && !shown.length && <li className="p-8 text-center text-sm text-stone-500">{t(needle ? 'stores.none' : 'khata.empty')}</li>}
      </ul>
    </div>
  );
}
