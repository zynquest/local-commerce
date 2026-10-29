import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer, QrCode, Share2 } from 'lucide-react';
import WhatsAppIcon from '../components/WhatsAppIcon.jsx';
import { PrintSheet, QrImage, ShareQrButton, ctaFor, scanUrl } from '../components/QrSticker.jsx';
import { PLATFORM } from '../config.js';
import { useT } from '../i18n/index.jsx';
import { get } from '../lib/api.js';
import { whatsappLink } from '../services/whatsappService.js';

/**
 * Owner's Store Settings: the printed QR stickers the platform team linked to this store, with Print and Share
 * (the sticker as a PNG plus an invitation with the store link). Loaded fresh each time, so links and removals made
 * by the team show up here.
 */
export default function MyStoreQr({ store }) {
  const t = useT();
  const [data, setData] = useState({ loading: true, codes: [], base: '' });
  const [printing, setPrinting] = useState(null);
  const [error, setError] = useState('');
  const stopPrinting = useCallback(() => setPrinting(null), []);

  useEffect(() => {
    let live = true;
    get('/merchant/qr')
      .then((r) => live && setData({ loading: false, codes: r.codes, base: r.base }))
      .catch(() => live && setData((d) => ({ ...d, loading: false })));
    return () => {
      live = false;
    };
  }, []);

  const appt = store.business_type === 'appointments';
  const storeLink = `${data.base || window.location.origin}/s/${store.slug}`;
  const shareText = t(appt ? 'myqr.shareAppt' : 'myqr.shareShop', { name: store.name, link: storeLink });
  const sticker = (code) => ({ code, base: data.base, name: store.name, cta: ctaFor(store.business_type) });

  return (
    <section className="card space-y-3 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 font-bold">
        <QrCode size={18} className="text-brand" /> {t('myqr.title')}
      </h2>
      {data.loading && <Loader2 className="mx-auto animate-spin text-stone-400" />}
      {!data.loading && !data.codes.length && (
        <div className="space-y-2 text-sm text-stone-600">
          <p>{t('myqr.empty')}</p>
          <a
            href={whatsappLink(PLATFORM.whatsappNumber, t('myqr.askMsg', { name: store.name, link: storeLink }))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 underline"
          >
            <WhatsAppIcon size={16} /> {t('setup.contactSupport')}
          </a>
        </div>
      )}
      {data.codes.length > 0 && (
        <>
          <p className="text-sm text-stone-600">{t('myqr.hint')}</p>
          <ul className="space-y-3">
            {data.codes.map((qr) => (
              <li key={qr.code} className="flex items-center gap-3 rounded-2xl border border-stone-200 p-3">
                <a href={scanUrl(data.base, qr.code)} target="_blank" rel="noreferrer" className="flex-none rounded-lg border border-stone-200 bg-white p-1.5">
                  <QrImage url={scanUrl(data.base, qr.code)} className="h-20 w-20" />
                </a>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs text-stone-500">{t('myqr.scans', { count: qr.scans })}</p>
                  <div className="flex flex-wrap gap-2">
                    <ShareQrButton sticker={sticker(qr.code)} text={shareText} onError={(err) => setError(err.message)} className="btn-whatsapp py-1.5 text-sm">
                      <Share2 size={15} /> {t('myqr.share')}
                    </ShareQrButton>
                    <button type="button" onClick={() => setPrinting([sticker(qr.code)])} className="btn-ghost py-1.5 text-sm">
                      <Printer size={15} /> {t('myqr.print')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {data.codes.length > 1 && (
            <button type="button" onClick={() => setPrinting(data.codes.map((qr) => sticker(qr.code)))} className="btn-ghost w-full text-sm">
              <Printer size={15} /> {t('myqr.printAll')}
            </button>
          )}
        </>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {printing && <PrintSheet items={printing} base={data.base} onDone={stopPrinting} />}
    </section>
  );
}
