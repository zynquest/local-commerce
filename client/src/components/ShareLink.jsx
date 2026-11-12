import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useT } from '../i18n/index.jsx';

/**
 * Copies text to the clipboard; falls back to a hidden text box where the Clipboard API is missing (older WebViews).
 * Returns false when the browser allows neither.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand?.('copy') ?? false;
    box.remove();
    return ok;
  }
}

/** Copies `url`; where the browser won't allow it, shows the link in a box to copy by hand. True when copied. */
async function copyOrShow(url, label) {
  if (await copyText(url)) return true;
  window.prompt(label, url);
  return false;
}

/** "Link copied" for a moment after a copy; returns [copied, markCopied]. */
function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mark = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return [copied, mark];
}

/**
 * Shares a link through the phone's share sheet (WhatsApp, Copy, …). Where there is no share sheet (most desktops),
 * the link is copied and the button says so for a moment. In the installed app there is no address bar, so this is
 * how people get the link.
 */
export function ShareLinkButton({ url, title, text, className, children }) {
  const t = useT();
  const [copied, markCopied] = useCopied();
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // closed the share sheet
      }
    }
    if (await copyOrShow(url, t('common.copyLink'))) markCopied();
  };
  return (
    <button type="button" onClick={share} className={className}>
      {copied ? (
        <>
          <Check size={14} /> {t('common.linkCopied')}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Copies a link to the clipboard. */
export function CopyLinkButton({ url, className, children }) {
  const t = useT();
  const [copied, markCopied] = useCopied();
  return (
    <button type="button" onClick={async () => (await copyOrShow(url, t('common.copyLink'))) && markCopied()} className={className}>
      {copied ? (
        <>
          <Check size={14} /> {t('common.linkCopied')}
        </>
      ) : (
        children
      )}
    </button>
  );
}
