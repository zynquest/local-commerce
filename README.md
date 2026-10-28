# Vocal For Local — Hyper-Local WhatsApp Commerce

One platform that hosts many neighbourhood stores. Each approved store gets a mobile storefront, and shoppers' orders go to that store's WhatsApp.

**Origin:** built in Sonsari, a village of under 5,000 people in Janjgir-Champa district, Chhattisgarh (pincode 495553, 21.9415764 N 82.3926376 E), where no quick-commerce app delivers but mobile data reaches every corner. Free for every local business in India, in all 22 scheduled languages plus English, with zero commission. The story is told on the home page (with a map of Sonsari), in the FAQ, the footer, the meta description and the Organization JSON-LD.

- **UI:** React PWA (`client/`), built with Vite, Tailwind v4, Dexie/IndexedDB and Workbox.
- **API:** Node + Express 5 (`server/`).
- **Database:** PostgreSQL 16 (Docker Compose locally; native on the production VM).
- **Company WhatsApp** (paid-plan / custom-domain enquiries): `+91 93530 95481`. Set in `client/src/config.js`.

**Deploying:** see [Deployment.md](Deployment.md). It covers local setup and a single GCP free-tier VM (Nginx + Node + PostgreSQL, deployed from GitHub) at https://sonsari.in.

## Run locally

```bash
cp .env.example .env
npm install
npm run db:up            # Postgres in Docker on localhost:5433
npm run db:seed          # optional: demo store (owner mobile 9000000001, OTP 898989)
npm run demo:create      # optional: 8 demo businesses (6 shops incl. a restaurant + salon + clinic); demo:remove -- --yes
npm run seed:merchants   # list local shops from OpenStreetMap / Google Places as claimable listings (Deployment.md §B21)
npm run admin:create     # the single platform admin (CLI only, strong password enforced)
npm run dev              # API :4000 + UI :5173
```

| Route | Who | What |
|---|---|---|
| `/` | everyone | Landing page: store directory, Free (up to 50) vs. Paid (50+) pricing, FAQ, WhatsApp sandbox |
| `/stores` | shoppers | Directory of approved stores |
| `/s/:slug`, `/s/:slug/p/:sku` | shoppers | Storefront and product page. Guest checkout over WhatsApp. |
| `/account` | shoppers | Optional account: saved address and order history |
| `/register`, `/login` | store owners | Register with store name + 10-digit mobile + OTP. Log in with mobile + OTP (no passwords). |
| `/merchant` | store owners | Approval status and remarks, products, orders, Excel/CSV import, settings, account |
| `/motiveboss/login`, `/motiveboss` | platform admin | Approval queue, approve / reject (with remarks) / suspend / reinstate, plans |

```bash
npm test                    # API integration tests (needs the DB running)
npm run build               # builds client/dist (served by the API in production, with server-side SEO)
npm run admin:reset-password
```

## Key behaviours

- **Store approval (mandatory):** `draft → pending_review → approved | rejected → (owner fixes + resubmits) → pending_review`, and `approved ↔ suspended`.
  - Only approved stores are listed, indexed and can take orders.
  - Owners and the admin can preview unapproved stores.
  - To submit, a store needs: a WhatsApp number, an address or city, a store type, and at least 1 product.
  - Every review action is recorded in `store_reviews`, shown to both the admin and the owner.
- **Platform admin:**
  - Created only via `npm run admin:create`; there is no sign-up API.
  - The database allows **exactly one** (`users_single_platform_admin` unique index).
  - Password rules: 16+ characters with upper, lower, digit and symbol, and no common words. Hashed with bcrypt cost 13.
  - Separate cookie, a 12-hour session, and login limited to 5 attempts per 15 minutes.
- **Login (owners and shoppers): 10-digit mobile + OTP only.** Only the platform admin has a password.
  - `OTP_PROVIDER` (`server/src/otp/providers.js`):
    - `fixed`: local default; every code is **898989**.
    - `email`: production default until an SMS gateway exists. Codes are emailed via Gmail SMTP to `OTP_EMAIL_TO` (creativebunnyofficial@gmail.com). The app tells users to WhatsApp **+91 93530 95481** (`OTP_HELP_WHATSAPP`) for their code, and you reply with it.
    - `sms`: plug in a gateway later. No client change is needed.
    - `whatsapp_reply` (free) / `whatsapp` (paid template): WhatsApp OTPs through Meta's Cloud API, webhook at `/api/whatsapp/webhook` (Deployment.md §B20).
  - Owners created before OTP login need a mobile attached: `npm run owner:set-phone -- <username|store-link> <10-digit mobile>`.
  - OTPs are 6 digits, expire in 10 minutes, allow 5 attempts, and at most 3 can be sent per number per 15 minutes.
  - Login codes are sent only to registered numbers, but the response is identical either way, so the endpoint doesn't reveal who is registered.
- **WhatsApp number:**
  - Defaults to the registration mobile.
  - Changing it requires an OTP sent to the **new** number (`/api/otp/request` → `/api/merchant/store/whatsapp/verify`). The settings form cannot change it directly.
- **Catalog:**
  - Only **name, MRP and list price** are required.
  - The SKU (item code) is auto-assigned (`P0001`, `P0002`, …) and never shown to shoppers.
  - Free plan: 50 active products; paid: 50+. The limit is enforced on the server under a row lock.
- **Two business types**, chosen at registration:
  - **Store**: products, cart, WhatsApp orders.
  - **Appointments**: salon, spa, beauty parlour, clinic. The business manages **services** (duration, price), **specialists** (weekly hours, which services they do) and **bookings**. Customers pick service → specialist (or "any") → date → free slot, then send the booking on WhatsApp.
  - The slot is held as a `requested` booking. A Postgres exclusion constraint makes overlapping bookings for one specialist impossible, even under concurrent requests.
  - The business confirms, cancels, or marks done / no-show, and replies on WhatsApp with a pre-filled message in the customer's language.
  - Code: `server/src/routes/appointments.js`, slot maths in `server/src/appointments/slots.js` (IST).
- **Location / near me:** merchants set the shop location with Google Maps search, GPS and a draggable pin (`client/src/components/AddressPicker.jsx`). Shoppers see only businesses within `NEARBY_RADIUS_KM` (default 10) of their location (`GET /api/stores?lat=&lng=`); demo stores are always listed. A Google Maps key is optional (Deployment.md §B19).
- **Products from a WhatsApp message** (Products tab, `POST /api/merchant/products/from-message`, parser in `server/src/catalog/messageParser.js`):
  - Format 1 is three lines per product (`Name` / `MRP` / `List price`). Format 2 is `Name,MRP,List price|Name,MRP,List price`. The two can be mixed.
  - WhatsApp timestamps and sender names, `*bold*`, bullets, `₹`/`Rs`/`MRP:` labels, `/-` and `1,250` are tolerated.
  - Each product is handled on its own. Valid ones are created; if a product with the same name exists, only its prices are updated. Failed ones come back with an error code and their line numbers, and the UI leaves only those in the box to fix. **Check** is a dry run.
- **Bulk import:**
  - Light (3 columns) and Full (12 columns, still only 3 required) templates; `.csv` or `.xlsx`.
  - Header spellings like "Product Name" or "Selling Price" are recognised; `₹1,299` and "Rs. 45" are parsed.
  - Rows are validated with row numbers; only valid rows are imported.
  - Matching is by item code or name, so re-uploading updates instead of duplicating.
- **Offline ordering:** a store's catalog is cached in IndexedDB for 30 minutes (hard expiry). Orders go to an outbox and sync when the device is back online; the server ignores duplicate submissions and flags orders placed with stale prices.
- **SEO:** the server renders per-route title, description, canonical and Open Graph tags, plus JSON-LD:
  - `/`: Organization, WebSite, SoftwareApplication and FAQPage
  - store pages: `Store` (LocalBusiness)
  - product pages: `Product`

  It also renders crawlable HTML for store pages, plus `/sitemap.xml` and `/robots.txt`.

## Languages

The app is available in English and all 22 languages of the Eighth Schedule:

Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Urdu, Kannada, Odia, Malayalam, Punjabi, Assamese, Maithili, Santali (Ol Chiki), Kashmiri, Nepali, Sindhi, Konkani, Dogri, Manipuri (Bengali script), Bodo and Sanskrit.

- **Picking a language:** there's a picker at the top of every shopper and merchant page. The first visit uses `?lang=`, then the saved choice, then the phone's language. The choice is saved, and the URL is updated so shared links keep the language.
- **Right-to-left scripts:** Urdu, Kashmiri and Sindhi switch the whole layout to `dir="rtl"`. The styles use direction-neutral (start/end) classes so everything mirrors correctly.
- **Santali font:** Ol Chiki uses a self-hosted Noto Sans Ol Chiki font (`client/public/fonts`, SIL OFL), downloaded only when needed.
- **What's translated:** all UI text, plural forms (`_one`/`_other`), dates, and server error messages. The server stays in English; `client/src/i18n/errors.js` maps its messages to translation keys.
- **What isn't:** product names and descriptions stay as the merchant entered them. The admin console is English-only.
- **WhatsApp order messages** use the store's *order language* (Store Settings), so the shopkeeper always reads orders in their own language.
- **SEO:** every indexable page exists per language at `?lang=xx`. The server renders the translated title, description and FAQ JSON-LD, with `<html lang dir>` and hreflang alternates, and the sitemap lists all language versions.

Translation files live in `client/src/i18n/locales/<code>.json`, with English as the source.

- **Adding a UI string:** add it to `en.json`, use `t('key')`, and add the translation in each locale. Missing keys fall back to English.
- **Checking translations:** run `node client/scripts/i18n-check.mjs`. It checks missing or unknown keys, `{placeholders}`, `<b>`/`<link>` markup, and that every `t('…')` key used in code exists.
- **Review before launch:** see [`client/src/i18n/TRANSLATION_REVIEW.md`](client/src/i18n/TRANSLATION_REVIEW.md) for the per-language checklist. The translations were machine-generated and should be reviewed by native speakers. This matters most for lower-resource languages such as Bodo, Dogri, Santali, Manipuri, Kashmiri, Sindhi, Konkani and Sanskrit.

## Data model

| Migration | Contents |
|---|---|
| `server/migrations/001_init.sql` | `users`, `stores`, `products`, `customers`, `orders`, `order_items`, `sessions` |
| `server/migrations/002_approval_otp_admin.sql` | Store `status` and review fields, the `store_reviews` table, `otp_codes`, the users `phone` column, the single-admin index, and the 50-SKU free tier |
| `server/migrations/003_order_language.sql` | `stores.order_language`: the language of the WhatsApp order messages the store receives |

## Deployment files (`deploy/`)

| File | Purpose |
|---|---|
| `setup-vm.sh` | One-time Ubuntu 24.04 bootstrap: swap, PostgreSQL 16, Node 20, Nginx, Certbot, `vfl` user, `/etc/vfl/env` |
| `deploy.sh` | `git pull` → `npm ci` → build → restart `vfl-api` → health check → reload Nginx |
| `systemd/vfl-api.service` | Node API as a hardened systemd service |
| `nginx/sonsari.in.bootstrap.conf`, `nginx/sonsari.in.conf` | HTTP-only config for issuing the certificate, then the final HTTPS config |
| `backup.sh`, `healthcheck.sh` | Nightly backups (optionally to GCS), health report |
