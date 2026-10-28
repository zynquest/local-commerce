// Page for a scanned QR code that isn't linked to a store (free code) or doesn't exist. Plain HTML, no script.
const WHATSAPP = '919353095481';

export function qrNotLinkedPage(isFreeCode) {
  const title = isFreeCode ? "This QR code isn't linked to a shop yet" : "We couldn't find this QR code";
  const body = isFreeCode
    ? 'The shop that put up this code is still getting set up on Vocal For Local. Meanwhile, browse other shops near you.'
    : 'The code may be mistyped or no longer in use. You can still browse shops near you.';
  const ask = encodeURIComponent('Hi, I scanned a Vocal For Local QR code that is not linked to a shop yet. Please help me link it to my shop.');
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title} · Vocal For Local</title>
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif; color: #1c1917; background: linear-gradient(#ecfdf5, #fafaf9); }
  .card { max-width: 420px; width: 100%; background: #fff; border: 1px solid #e7e5e4; border-radius: 20px; padding: 28px 24px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .brand { font-weight: 800; color: #15803d; letter-spacing: .02em; margin: 0 0 14px; }
  h1 { font-size: 21px; line-height: 1.3; margin: 0 0 8px; }
  p { color: #57534e; font-size: 15px; line-height: 1.55; margin: 0 0 20px; }
  a.btn { display: block; text-decoration: none; font-weight: 700; border-radius: 12px; padding: 12px 16px; margin-top: 10px; }
  .primary { background: #15803d; color: #fff; }
  .ghost { border: 2px solid #15803d; color: #15803d; }
  .small { font-size: 13px; margin: 18px 0 0; }
  .small a { color: #15803d; }
</style>
</head>
<body>
  <main class="card">
    <p class="brand">Vocal For Local</p>
    <h1>${title}</h1>
    <p>${body}</p>
    <a class="btn primary" href="/stores">Shop local stores</a>
    <a class="btn ghost" href="/register">Register your store free</a>
    ${isFreeCode ? `<p class="small">Own the shop where you found this code? <a href="https://wa.me/${WHATSAPP}?text=${ask}">Message us on WhatsApp</a> to link it.</p>` : ''}
  </main>
</body>
</html>`;
}
