import { NotebookPen } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useT } from '../i18n/index.jsx';

/** Unlisted Items & Special Instructions — free text appended to the WhatsApp order. */
export default function UnlistedItemsBox({ compact = false }) {
  const t = useT();
  const { notes, setNotes } = useCart();
  return (
    <div className={compact ? '' : 'card p-4'}>
      <label htmlFor="unlisted-notes" className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-800">
        <NotebookPen size={16} className="text-brand" />
        {t('cart.unlistedTitle')}
      </label>
      <textarea maxLength={1000}
        id="unlisted-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
        rows={compact ? 3 : 4}
        placeholder={t('cart.unlistedPlaceholder')}
        className="input resize-none"
      />
      <div className="mt-1 text-end text-[11px] text-stone-400">{notes.length}/1000</div>
    </div>
  );
}
