import { useState } from 'react';
import { Check, Loader2, Pencil } from 'lucide-react';
import MobileInput, { isMobile10 } from './MobileInput.jsx';
import { categoriesFor } from '../businessCategories.js';
import { patch } from '../lib/api.js';

/**
 * Support corrections of what owners can't change after approval: name, store link, business type, store type and
 * WhatsApp number (a number set here counts as verified). Platform admin only: the admin console's store detail, and
 * Store Settings in admin mode (the admin's own session makes the change).
 */
export default function EditDetails({ store, onSaved, label = 'Edit name, link, type or WhatsApp (owner asked support)' }) {
  const [open, setOpen] = useState(false);
  const initial = () => ({
    name: store.name || '',
    slug: store.slug || '',
    business_type: store.business_type || 'shop',
    category: store.category || '',
    whatsapp_number: (store.whatsapp_number || '').replace(/^91(?=\d{10}$)/, ''),
  });
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: typeof e === 'string' ? e : e.target.value }));

  const save = async () => {
    const before = initial();
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== before[k]));
    if (!Object.keys(changed).length) return setOpen(false);
    if (changed.whatsapp_number !== undefined && !isMobile10(changed.whatsapp_number)) return setError('Enter a valid 10-digit WhatsApp number');
    setBusy(true);
    setError('');
    try {
      await patch(`/platform/stores/${store.id}/details`, changed);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(Object.values(err.fields || {})[0] || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => { setForm(initial()); setOpen(true); }} className="btn-ghost w-full text-sm">
        <Pencil size={14} /> {label}
      </button>
    );
  }
  return (
    <div className="card space-y-3 p-4">
      <h3 className="font-bold">Correct store details</h3>
      <p className="text-xs text-stone-500">Owners can't change these after approval. Changing the link breaks old links and printed QR codes that use it directly (QR stickers from the QR codes tab keep working).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fix-name">Store name</label>
          <input id="fix-name" className="input" value={form.name} onChange={set('name')} maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="fix-slug">Store link (/s/…)</label>
          <input id="fix-slug" className="input" value={form.slug} onChange={(e) => set('slug')(e.target.value.toLowerCase())} maxLength={60} />
        </div>
        <div>
          <label className="label" htmlFor="fix-type">Business type</label>
          <select id="fix-type" className="input" value={form.business_type} onChange={set('business_type')}>
            <option value="shop">Store</option>
            <option value="appointments">Appointments</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fix-category">Store type</label>
          <input id="fix-category" className="input" list="fix-categories" value={form.category} onChange={set('category')} maxLength={40} />
          <datalist id="fix-categories">
            {categoriesFor(form.business_type).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <MobileInput id="fix-wa" value={form.whatsapp_number} onChange={set('whatsapp_number')} label="WhatsApp number for orders" />
        </div>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="btn-brand">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save changes</button>
        <button onClick={() => setOpen(false)} disabled={busy} className="btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
