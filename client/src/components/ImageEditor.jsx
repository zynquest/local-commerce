import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw, Sun, Type, X, ZoomIn } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

// Longest side of the edited photo; the server then compresses it to WebP at the same size.
const MAX_SIDE = 1600;
const SHAPES = { original: null, square: 1, wide: 4 / 3 };

/** Brightness and contrast (−50…50) applied to the pixels; works in every browser, unlike ctx.filter on old Safari. */
function adjust(ctx, w, h, light, contrast) {
  if (!light && !contrast) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const b = light * 2.55;
  const c = (100 + contrast * 2) / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] - 128) * c + 128 + b));
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Minimal photo editor before upload: crop (shape, zoom, drag to move), rotate, light, contrast and a line of text.
 * `aspect`: a fixed width/height ratio (logo 1, banner 16/5), or none to let the owner pick (products).
 * onDone(file): the edited photo as a JPEG File, at most MAX_SIDE px on its longest side.
 */
export default function ImageEditor({ file, aspect, onDone, onCancel }) {
  const t = useT();
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const [img, setImg] = useState(null);
  const [shape, setShape] = useState(aspect ? 'fixed' : 'square');
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // pan, in preview pixels
  const [light, setLight] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [text, setText] = useState('');
  const [textSize, setTextSize] = useState(8); // % of the photo's height
  const [textY, setTextY] = useState(85); // % from the top
  const [textDark, setTextDark] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    // A format this browser can't draw (e.g. HEIC outside Safari): upload it as it is; the server converts it.
    image.onerror = () => onDone(file);
    image.src = url;
    return () => {
      // Drop the handlers first: revoking the URL of a load still in flight would otherwise report an error.
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]); // onDone left out: a new handler on each render must not reload the photo

  const turned = rotation % 180 !== 0;
  const srcW = img ? (turned ? img.height : img.width) : 1;
  const srcH = img ? (turned ? img.width : img.height) : 1;
  const ratio = shape === 'fixed' ? aspect : SHAPES[shape] ?? srcW / srcH;
  const PREVIEW_W = 320;
  const previewH = Math.round(PREVIEW_W / ratio);
  // Display pixels per source pixel: the photo covers the frame at zoom 1.
  const scale = Math.max(PREVIEW_W / srcW, previewH / srcH) * zoom;

  // Keep the photo covering the frame while moving it around.
  const clamp = useCallback(
    (o) => {
      const mx = Math.max(0, (srcW * scale - PREVIEW_W) / 2);
      const my = Math.max(0, (srcH * scale - previewH) / 2);
      return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
    },
    [srcW, srcH, scale, previewH],
  );
  useEffect(() => setOffset((o) => clamp(o)), [clamp]);

  /** Draws the edit onto a canvas of width w (the preview, or the full-size export). */
  const draw = useCallback(
    (canvas, w) => {
      if (!img) return;
      const k = w / PREVIEW_W;
      const h = Math.round(previewH * k);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + offset.x * k, h / 2 + offset.y * k);
      ctx.rotate((rotation * Math.PI) / 180);
      const s = scale * k;
      ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
      adjust(ctx, w, h, light, contrast);
      if (text.trim()) {
        const size = Math.max(10, Math.round((h * textSize) / 100));
        ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, size / 6);
        ctx.strokeStyle = textDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
        ctx.fillStyle = textDark ? '#111111' : '#ffffff';
        const y = (h * textY) / 100;
        ctx.strokeText(text.trim(), w / 2, y, w * 0.92);
        ctx.fillText(text.trim(), w / 2, y, w * 0.92);
      }
    },
    [img, previewH, offset, rotation, scale, light, contrast, text, textSize, textY, textDark],
  );

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, PREVIEW_W);
  }, [draw]);

  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, start: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const { x, y, start } = drag.current;
    setOffset(clamp({ x: start.x + e.clientX - x, y: start.y + e.clientY - y }));
  };
  const onPointerUp = () => (drag.current = null);

  const save = () => {
    // Full size: as many source pixels as the frame shows, capped at MAX_SIDE on the longest side.
    const visibleW = PREVIEW_W / scale;
    const visibleH = previewH / scale;
    const fit = Math.min(1, MAX_SIDE / Math.max(visibleW, visibleH));
    const out = document.createElement('canvas');
    draw(out, Math.max(1, Math.round(visibleW * fit)));
    setBusy(true);
    out.toBlob(
      (blob) => {
        setBusy(false);
        if (blob) onDone(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  const slider = (Icon, label, value, onChange, min, max) => (
    <label className="flex items-center gap-2 text-xs text-stone-600">
      <Icon size={16} className="flex-none text-stone-500" aria-hidden="true" />
      <span className="w-20 flex-none">{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--brand)]" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label={t('editor.title')}>
      <div className="max-h-[95vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="font-bold">{t('editor.title')}</p>
          <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100" aria-label={t('common.cancel')}><X size={18} /></button>
        </div>

        <div className="flex justify-center rounded-2xl bg-stone-100 p-2">
          <canvas
            ref={canvasRef}
            className="max-w-full touch-none cursor-grab rounded-lg shadow-sm active:cursor-grabbing"
            style={{ width: PREVIEW_W, height: previewH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <p className="text-center text-[11px] text-stone-500">{t('editor.dragHint')}</p>

        <div className="flex flex-wrap items-center gap-2">
          {!aspect &&
            Object.keys(SHAPES).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setShape(k)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${shape === k ? 'border-brand bg-brand text-white' : 'border-stone-200 text-stone-700'}`}
              >
                {t(`editor.${k}`)}
              </button>
            ))}
          <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className="ms-auto inline-flex items-center gap-1 rounded-full border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-700">
            <RotateCw size={14} /> {t('editor.rotate')}
          </button>
        </div>

        <div className="space-y-2">
          {slider(ZoomIn, t('editor.zoom'), Math.round(zoom * 100), (v) => setZoom(v / 100), 100, 300)}
          {slider(Sun, t('editor.light'), light, setLight, -50, 50)}
          {slider(Sun, t('editor.contrast'), contrast, setContrast, -50, 50)}
        </div>

        <div className="space-y-2 rounded-2xl border border-stone-200 p-3">
          <label className="flex items-center gap-2">
            <Type size={16} className="flex-none text-stone-500" aria-hidden="true" />
            <input className="input py-1.5 text-sm" maxLength={40} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('editor.textPlaceholder')} aria-label={t('editor.text')} />
          </label>
          {text.trim() && (
            <>
              {slider(Type, t('editor.textSize'), textSize, setTextSize, 4, 20)}
              {slider(Type, t('editor.textPosition'), textY, setTextY, 8, 92)}
              <button type="button" onClick={() => setTextDark((d) => !d)} className="rounded-full border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-700">
                {t('editor.textColour')}: <span className={`ms-1 inline-block h-3 w-3 rounded-full border border-stone-300 align-middle ${textDark ? 'bg-stone-900' : 'bg-white'}`} />
              </button>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1">{t('common.cancel')}</button>
          <button type="button" onClick={save} disabled={!img || busy} className="btn-brand flex-1">{t('editor.use')}</button>
        </div>
      </div>
    </div>
  );
}
