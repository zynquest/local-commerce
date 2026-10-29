import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { whatsappLink } from '../services/whatsappService.js';

// Printed QR stickers: preview, A4 print sheet, PNG image and sharing. Used by the admin QR pool and the owner's
// "My store QR code" section. The sticker text is English, like the printed stickers. The 8-digit code itself is
// internal (admin only): it is never printed on a sticker or shown to owners and customers.

export const BRAND_GREEN = '#15803d';
export const prettyCode = (code) => `${code.slice(0, 4)} ${code.slice(4)}`;
export const hostOf = (base) => base.replace(/^https?:\/\//, '');
export const scanUrl = (base, code) => `${base}/q/${code}`;
/** Call to action printed under the QR, by business type (unknown: a shop). */
export const ctaFor = (businessType) => (businessType === 'appointments' ? 'Scan to book an appointment' : 'Scan to order from this shop');

// QR images are drawn in the browser and cached per URL.
const svgCache = new Map();
function useQrSvg(url) {
  const [svg, setSvg] = useState(() => svgCache.get(url) || '');
  useEffect(() => {
    if (svgCache.has(url)) return setSvg(svgCache.get(url));
    let live = true;
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then((s) => {
      svgCache.set(url, s);
      if (live) setSvg(s);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return svg;
}

export function QrImage({ url, className }) {
  const svg = useQrSvg(url);
  // The SVG comes from the qrcode library (never from user input), so injecting it is safe.
  return <span className={`block [&>svg]:h-full [&>svg]:w-full ${className}`} aria-label={`QR code for ${url}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** One printed tile: brand, store name (when linked), QR, call to action and site. Sized in mm for A4 (3 × 4). */
function PrintTile({ code, base, name, cta }) {
  return (
    <div className="qr-tile">
      <p className="qr-brand">Vocal For Local</p>
      {name && <p className="qr-name">{name}</p>}
      <QrImage url={scanUrl(base, code)} className="qr-img" />
      <p className="qr-cta">{cta || ctaFor()}</p>
      <p className="qr-site">{hostOf(base)}</p>
    </div>
  );
}

/**
 * Prints `items` ([{ code, name?, cta? }]) on A4 sticker sheets: renders them for print only, opens the print dialog,
 * then calls onDone. Render it while there is something to print.
 */
export function PrintSheet({ items, base, onDone }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener('afterprint', done, { once: true });
    const timer = setTimeout(() => window.print(), 300); // let the QR images draw first
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [onDone]);
  return createPortal(
    <div className="qr-print" aria-hidden="true">
      {items.map((it) => <PrintTile key={it.code} base={base} {...it} />)}
    </div>,
    document.body,
  );
}

/** Shrinks the font until `text` fits `maxWidth` on the canvas. */
function fitText(ctx, text, weight, size, maxWidth, family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif') {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 14);
}

/** The sticker as a PNG file (720 × 900): brand, store name, QR, call to action and site. */
export async function qrPngFile({ code, base, name, cta }) {
  const W = 720;
  const H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = BRAND_GREEN;
  fitText(ctx, 'Vocal For Local', 800, 52, W - 80);
  ctx.fillText('Vocal For Local', W / 2, 96);
  let y = 132;
  if (name) {
    ctx.fillStyle = '#1c1917';
    fitText(ctx, name, 700, 36, W - 80);
    ctx.fillText(name, W / 2, 150);
    y = 178;
  }
  const size = 500;
  const qr = await QRCode.toCanvas(document.createElement('canvas'), scanUrl(base, code), { width: size, margin: 1, errorCorrectionLevel: 'M' });
  ctx.drawImage(qr, (W - size) / 2, y);
  y += size + 64;
  ctx.fillStyle = '#1c1917';
  fitText(ctx, cta || ctaFor(), 700, 34, W - 80);
  ctx.fillText(cta || ctaFor(), W / 2, y);
  ctx.font = '800 40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(hostOf(base), W / 2, y + 58);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = (name || 'store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
  return new File([blob], `vocal-for-local-${file}-qr.png`, { type: 'image/png' });
}

/**
 * Share button: the phone's share sheet with the sticker PNG and `text` (pick WhatsApp there). Where files can't be
 * shared (most desktops), the PNG is downloaded and WhatsApp opens with the text. The PNG is drawn when the finger or
 * pointer arrives, so the share call still counts as part of the tap (iPhones require that).
 */
export function ShareQrButton({ sticker, text, className, children, onError }) {
  const file = useRef(null);
  const prepare = () => {
    file.current ??= qrPngFile(sticker).catch((err) => {
      file.current = null;
      throw err;
    });
    return file.current;
  };

  const share = async () => {
    try {
      const png = await prepare();
      if (navigator.canShare?.({ files: [png] })) {
        try {
          await navigator.share({ files: [png], text });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return; // closed the share sheet
        }
      }
      const url = URL.createObjectURL(png);
      const a = document.createElement('a');
      a.href = url;
      a.download = png.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      window.open(whatsappLink('', text), '_blank', 'noopener');
    } catch (err) {
      onError?.(err);
    }
  };

  return (
    <button type="button" onPointerEnter={prepare} onTouchStart={prepare} onFocus={prepare} onClick={share} className={className}>
      {children}
    </button>
  );
}
