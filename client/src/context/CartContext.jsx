import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useLocalStorage } from '../lib/hooks.js';
import { computeTotals } from '../services/whatsappService.js';

const CartContext = createContext(null);
const MAX_QTY = 99;

// Snapshot of the product fields needed for checkout, so the cart survives catalog re-syncs.
const toLine = (p, quantity) => ({
  sku_id: p.sku_id,
  name: p.name,
  mrp: p.mrp,
  offer_price: p.offer_price,
  price_hidden: Boolean(p.price_hidden), // "Price on request": no price is sent or totalled
  image: p.images?.[0] || '',
  quantity,
});

/** Cart + checkout state, persisted per store in localStorage. */
export function CartProvider({ slug, store, products, children }) {
  const [saved, setItems] = useLocalStorage(`cart:${slug}`, []);
  // A price the store has hidden since the item went into the bag is hidden in the bag too ("Price on request").
  const items = useMemo(() => {
    const hidden = new Set((products || []).filter((p) => p.price_hidden).map((p) => p.sku_id));
    if (!hidden.size) return saved;
    return saved.map((i) => (hidden.has(i.sku_id) ? { ...i, mrp: null, offer_price: null, price_hidden: true } : i));
  }, [saved, products]);
  const [notes, setNotes] = useLocalStorage(`cart-notes:${slug}`, '');
  const [customer, setCustomer] = useLocalStorage('customer-info', { name: '', phone: '', address: '' });
  const [open, setOpen] = useState(false);

  const setQuantity = useCallback(
    (product, quantity) => {
      const q = Math.max(0, Math.min(MAX_QTY, Math.floor(quantity)));
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.sku_id === product.sku_id);
        if (q === 0) return prev.filter((i) => i.sku_id !== product.sku_id);
        if (idx === -1) return [...prev, toLine(product, q)];
        const next = [...prev];
        next[idx] = { ...toLine(product, q), image: next[idx].image || product.images?.[0] || '' };
        return next;
      });
    },
    [setItems],
  );

  const value = useMemo(() => {
    const qtyOf = (sku) => items.find((i) => i.sku_id === sku)?.quantity || 0;
    const count = items.reduce((n, i) => n + i.quantity, 0);
    return {
      items,
      notes,
      setNotes,
      customer,
      setCustomer,
      open,
      setOpen,
      count,
      totals: computeTotals(items, store || {}),
      qtyOf,
      setQuantity,
      add: (p, n = 1) => setQuantity(p, qtyOf(p.sku_id) + n),
      remove: (p) => setQuantity(p, qtyOf(p.sku_id) - 1),
      clear: () => {
        setItems([]);
        setNotes('');
      },
    };
  }, [items, notes, customer, open, store, setQuantity, setItems, setNotes, setCustomer]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
