import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Link2Off, Loader2, Printer, QrCode, RefreshCw, Search, Share2 } from 'lucide-react';
import { PrintSheet, QrImage, ShareQrButton, ctaFor, hostOf as host, prettyCode as pretty, scanUrl } from '../components/QrSticker.jsx';
import { get, post } from '../lib/api.js';
import { useDebounce } from '../lib/hooks.js';

const FILTERS = [
  ['all', 'All'],
  ['free', 'Free'],
  ['assigned', 'Linked'],
];

/** WhatsApp text for a linked code: invites customers to the store (or to book, for appointment businesses). */
const shareText = (name, link, businessType) =>
  businessType === 'appointments' ? `Book an appointment at ${name} on Vocal For Local: ${link}` : `Visit my store ${name} on Vocal For Local: ${link}`;

/** What a sticker shows: linked codes carry the store's name and the matching call to action. */
const stickerOf = (qr) => (qr.store_id ? { code: qr.code, name: qr.store_name, cta: ctaFor(qr.store_business_type) } : { code: qr.code });

/** Store name box with suggestions from the admin store search. Picking one fills in the exact store. */
function StorePicker({ code, value, onChange, onPick, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const [active, setActive] = useState(-1);
  const q = useDebounce(value.trim(), 200);

  useEffect(() => {
    if (q.length < 2) return setMatches([]);
    let live = true;
    get(`/platform/stores?status=all&q=${encodeURIComponent(q)}`)
      .then((r) => {
        if (!live) return;
        // Names that start with what was typed first, then a word in the name starting with it, then the rest.
        const needle = q.toLowerCase();
        const rank = (n) => (n.toLowerCase().startsWith(needle) ? 0 : n.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)) ? 1 : 2);
        setMatches([...r.stores].sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 6));
        setActive(-1);
      })
      .catch(() => live && setMatches([]));
    return () => {
      live = false;
    };
  }, [q]);

  const pick = (s) => {
    onPick(s);
    setOpen(false);
  };
  const onKeyDown = (e) => {
    const shown = open && matches.length;
    if (e.key === 'ArrowDown' && shown) {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && shown) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown && active >= 0) pick(matches[active]);
      else if (value.trim()) onSubmit();
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input maxLength={60}
        className="input w-full text-base sm:text-sm"
        placeholder="Store name"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        aria-controls={`qr-stores-${code}`}
        aria-label={`Store for QR ${code}`}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul id={`qr-stores-${code}`} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
          {matches.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-emerald-50' : 'hover:bg-stone-50'}`}
            >
              <p className="text-sm font-semibold break-words">{s.name}</p>
              <p className="text-xs text-stone-500">
                {[s.locality || s.city, s.status === 'approved' ? null : 'not live yet'].filter(Boolean).join(' · ') || '\u00a0'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ qr, base, selected, onToggle, onChanged }) {
  const [store, setStore] = useState('');
  const [picked, setPicked] = useState(null); // the suggestion chosen, so two stores with one name can't mix up
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const assign = async () => {
    setBusy('assign');
    setError('');
    try {
      await post(`/platform/qr/${qr.code}/assign`, { store: picked && picked.name === store ? picked.slug : store });
      setStore('');
      setPicked(null);
      onChanged();
    } catch (err) {
      setError(err.fields?.store || err.message);
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${qr.store_name} from QR ${pretty(qr.code)}? The code becomes free to link to another store.`)) return;
    setBusy('remove');
    setError('');
    try {
      await post(`/platform/qr/${qr.code}/unassign`, {});
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    // Phones: checkbox, QR and code on top, the store line full width below. Wider: the store line sits beside the QR.
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-3">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand sm:row-span-2" checked={selected} onChange={onToggle} aria-label={`Select QR ${qr.code}`} />
      <a href={scanUrl(base, qr.code)} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 bg-white p-1.5 sm:row-span-2" title="Open the scan link">
        <QrImage url={scanUrl(base, qr.code)} className="h-14 w-14 sm:h-16 sm:w-16" />
      </a>
      <p className="flex flex-wrap items-baseline gap-x-2 self-center font-mono text-base font-bold tracking-wide sm:self-start">
        {pretty(qr.code)}
        <span className="font-sans text-[11px] font-normal text-stone-400">
          {qr.scans} scan{qr.scans === 1 ? '' : 's'} · batch {qr.batch}
        </span>
      </p>
      <div className="col-span-3 space-y-1.5 sm:col-span-1 sm:col-start-3">
        {qr.store_id ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              <Link2 size={12} /> Linked
            </span>
            <a href={`/s/${qr.store_slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold break-words hover:text-brand">
              {qr.store_name}
            </a>
            {qr.store_status !== 'approved' && <span className="text-xs text-amber-700">· store not live yet</span>}
            <ShareQrButton
              sticker={{ ...stickerOf(qr), base }}
              text={shareText(qr.store_name, `${base}/s/${qr.store_slug}`, qr.store_business_type)}
              onError={(err) => setError(err.message)}
              className="ms-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              <Share2 size={13} /> Share
            </ShareQrButton>
            <button onClick={remove} disabled={!!busy} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
              {busy === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />} Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <StorePicker
              code={qr.code}
              value={store}
              onChange={(v) => {
                setStore(v);
                setError('');
              }}
              onPick={(s) => {
                setStore(s.name);
                setPicked(s);
                setError('');
              }}
              onSubmit={assign}
            />
            <button onClick={assign} disabled={!!busy || !store.trim()} className="btn-brand flex-none text-sm">
              {busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Assign
            </button>
          </div>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </li>
  );
}

/** Admin: printed QR codes. Generate a batch, print it, link each code to a store (or move it) later. */
export default function AdminQrCodes() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // A scanned sticker link (…/q/12345678) finds its code: stickers don't print the code, the QR carries it.
  const q = useDebounce(query.trim().match(/\/q\/([1-9]\d{7})/)?.[1] || query.trim(), 250);
  const [data, setData] = useState({ loading: true, codes: [], counts: null, base: 'https://sonsari.in', error: '' });
  const [count, setCount] = useState(12);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [printing, setPrinting] = useState(null); // stickers being printed
  const stopPrinting = useCallback(() => setPrinting(null), []);

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true }));
    try {
      const r = await get(`/platform/qr?filter=${filter}&q=${encodeURIComponent(q)}`);
      setData({ loading: false, codes: r.codes, counts: r.counts, base: r.base, error: '' });
    } catch (err) {
      setData((d) => ({ ...d, loading: false, error: err.message }));
    }
  }, [filter, q]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setNotice('');
    try {
      const r = await post('/platform/qr', { count: Number(count) });
      setNotice(`Generated ${r.codes.length} new QR codes (batch ${r.batch}). They're selected below, ready to print.`);
      setSelected(new Set(r.codes));
      setFilter('all');
      setQuery('');
      await load();
    } catch (err) {
      setNotice(err.fields?.count || err.message);
    } finally {
      setGenerating(false);
    }
  };

  const toggle = (code) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  const visibleFree = useMemo(() => data.codes.filter((c) => !c.store_id).map((c) => c.code), [data.codes]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><QrCode size={20} className="text-brand" /> QR codes</h2>
          {data.counts && (
            <p className="text-sm text-stone-600">
              {data.counts.total.toLocaleString('en-IN')} total · <b className="text-emerald-700">{data.counts.assigned.toLocaleString('en-IN')} linked</b> · {data.counts.free.toLocaleString('en-IN')} free
            </p>
          )}
        </div>
        <p className="text-sm text-stone-600">
          Each code opens <b>{host(data.base)}/q/&lt;code&gt;</b>, which takes the shopper to the store it's linked to. Print a batch first, then type the shop's name against a code when you put the sticker up; you can move a code to another store any time. Stickers don't show the code: to find one, scan it with your phone and paste the link into the search.
        </p>
        <form onSubmit={generate} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">How many new codes?</span>
            <input className="input w-28" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <button disabled={generating} className="btn-brand">
            {generating ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} Generate
          </button>
        </form>
        {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700'}`}
          >
            {label}
          </button>
        ))}
        <label className="relative w-full sm:ms-auto sm:w-64">
          <Search size={16} className="absolute top-1/2 start-3 -translate-y-1/2 text-stone-400" />
          <input maxLength={120} className="input ps-9" placeholder="Search code, store or scanned link" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button onClick={load} className="btn-ghost px-3" aria-label="Refresh"><RefreshCw size={16} className={data.loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setSelected(new Set(visibleFree))} disabled={!visibleFree.length} className="btn-ghost py-1.5 text-xs">
          Select free codes in view ({visibleFree.length})
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-stone-600 underline">Clear selection</button>
        )}
        <button
          onClick={() => setPrinting([...selected].map((code) => { const qr = data.codes.find((c) => c.code === code); return qr ? stickerOf(qr) : { code }; }))}
          disabled={!selected.size}
          className="btn-brand ms-auto py-1.5 text-sm"
        >
          <Printer size={16} /> Print selected ({selected.size})
        </button>
      </div>

      {data.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{data.error}</p>}
      <ul className="card divide-y divide-stone-100">
        {data.codes.map((qr) => (
          <Row key={qr.code} qr={qr} base={data.base} selected={selected.has(qr.code)} onToggle={() => toggle(qr.code)} onChanged={load} />
        ))}
        {!data.loading && !data.codes.length && (
          <li className="p-10 text-center text-sm text-stone-500">
            <QrCode size={32} className="mx-auto mb-2 text-stone-300" />
            {filter === 'all' && !q ? 'No QR codes yet. Generate a batch above.' : 'No codes match.'}
          </li>
        )}
      </ul>
      {data.codes.length >= 500 && <p className="text-center text-xs text-stone-500">Showing the newest 500. Use search or the filters to find others.</p>}

      {printing && <PrintSheet items={printing} base={data.base} onDone={stopPrinting} />}
    </div>
  );
}

