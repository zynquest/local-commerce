import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Searchable drop-down: type to filter `options`, pick with a tap or the arrow keys + Enter. With `customLabel`,
 * text that matches no option can be used as typed ("Use “Dosa corner”").
 */
export default function SearchSelect({ id, value, onChange, options, placeholder, customLabel, invalid }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value || '');
  const [active, setActive] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    if (!open) setText(value || '');
  }, [value, open]);

  const q = text.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q || q === (value || '').toLowerCase()) return options;
    const starts = options.filter((o) => o.toLowerCase().startsWith(q));
    const words = options.filter((o) => !starts.includes(o) && o.toLowerCase().split(/[\s/&(),-]+/).some((w) => w.startsWith(q)));
    const rest = options.filter((o) => !starts.includes(o) && !words.includes(o) && o.toLowerCase().includes(q));
    return [...starts, ...words, ...rest];
  }, [options, q, value]);
  const exact = options.some((o) => o.toLowerCase() === q);
  const items = [...filtered.map((o) => ({ value: o, label: o })), ...(customLabel && q && !exact ? [{ value: text.trim(), label: customLabel(text.trim()), custom: true }] : [])];

  const pick = (v) => {
    onChange(v);
    setText(v);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault();
      pick(items[active].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={box}>
      <input
        id={id}
        className={`input pe-9 ${invalid ? 'border-rose-400' : ''}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      <ChevronDown size={18} className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 text-stone-400" />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
          {items.map((it, i) => (
            <li
              key={`${it.custom ? 'custom:' : ''}${it.value}`}
              role="option"
              aria-selected={it.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? 'bg-emerald-50' : ''} ${it.custom ? 'font-semibold text-brand' : ''}`}
            >
              {it.label}
              {it.value === value && <Check size={14} className="flex-none text-brand" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
