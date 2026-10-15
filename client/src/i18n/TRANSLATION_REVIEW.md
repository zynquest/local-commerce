# Translation review checklist

Machine translations of `en.json` into 22 Indian languages (Oct 2026). Every file passes `node client/scripts/i18n-check.mjs`, so keys, placeholders and markup are intact. Wording still needs review by native speakers.

**Highest priority for a full review:** Bodo (brx), Kashmiri (ks), Manipuri (mni) and Santali (sat). The translators reported low-to-moderate confidence for these. After them: Dogri, Konkani, Sindhi, Sanskrit and Maithili.

## Applies to all languages
- Spreadsheet column names (`name`, `mrp`, `list_price`, …) and the cell values `yes` / `no` are intentionally in English, because the importer reads them.
- `cart.tapSend` names WhatsApp's button as "Send ➤". The arrow matches WhatsApp's send icon in any language.
- `errors.cannotTransition` fills in an English `{action}` and `{status}`. It only appears in the admin console, which is English-only.

## hi, mai — 642 strings each, checker passed
- Loanwords in Devanagari (ऑर्डर, स्टोर, प्रोडक्ट, कैटलॉग, डैशबोर्ड, इम्पोर्ट, आर्काइव, पेड प्लान).
- "Shelf life" → चलने की अवधि / चलबाक अवधि (unsure; maybe एक्सपायरी).
- cart.tapSend keeps "<b>Send</b>" (WhatsApp button label).
- errors.cannotTransition word order depends on runtime vars.
- Maithili: प्रणाम greeting; apostrophe forms (भ', ल', क') vs full forms — reviewer preference.
## gu, sd — 642 strings each, checker passed
- gu: list price → વેચાણ ભાવ; shelf life → ટકાઉપણું; specs → વિગતો (overlaps "details"); unlisted items label long.
- sd: Sindhi-only letters checked (ڪ not ک); ذيلي جوڙ for subtotal; greeting سلام but نمستي in customMsg; male verb forms in plan.upgradeMsg.
- Shared issue: cart.tapSend keeps English "Send" (WhatsApp button label is localized by WhatsApp) → fix centrally.
## bn, as — 642 strings each, checker passed
- bn: subtotal মোট দাম may read close to total (মোট দেয়); shelf life মেয়াদ; loanwords ফ্রি/পেইড.
- as: ৰ/ৱ throughout, no Bengali র; সামগ্ৰী for product, গেলামাল for grocery, মাচুল for fee, উপমুঠ subtotal.
- Both shortened placeOrder button; FAQ a2 adjusted to match.
- errors.cannotTransition {action} is English (admin-only error) → harmless.
## ta, ml — 642 strings each, checker passed
- ta: பை for bag; விற்பனை விலை list price; நேரலை for Live; shelf life பயன்படுத்தும் காலம்; tapSend missing "Tap" object → covered by central Send fix.
- ml: placeholders suffixed with hyphen ({store}-ൽ, {city}-ലെ) — check with real names; ഉപതുക subtotal.
## te, kn — 642 strings each, checker passed
- ADD button: జోడించు / ಸೇರಿಸಿ (check fit); list price అమ్మకం ధర / ಮಾರಾಟ ಬೆಲೆ.
- te: కొనుగోలుదారులు for shoppers may be formal; kn: ವಿಮರ್ಶೆ vs ರಿವ್ಯೂ; ಆ್ಯಪ್ spelling.
## pa, doi — 642 strings each, checker passed
- pa: greeting ਸਤ ਸ੍ਰੀ ਅਕਾਲ (ਨਮਸਤੇ is the neutral alternative); ਕੈਮਿਸਟ for pharmacy; ਵਿਕਰੀ ਕੀਮਤ list price.
- doi: Jammu Dogri grammar; -गन future plurals vs -ङन; ह् clusters without ZWJ; apostrophe tone mark (खु'ल्ला); दुकान vs हट्टी.
## ne, brx — 642 strings each, checker passed
- ne: fairly high confidence. झोला for bag, सूची for catalog/list, बिक्री मूल्य list price, सशुल्क योजना paid plan.
- brx: MODERATE confidence at best — needs FULL review by an Assam Bodo speaker (word choice, politeness). Many terms are Devanagari English loanwords.
## ur, ks — 642 strings each, checker passed
- ur: فروخت کی قیمت list price; پیش نظارہ vs پریویو; ایگریگیٹر loanword.
- ks: needs FULL native review; Kashmiri letters (ٲ ٕ ۄ ێ ٚ); gender agreement in "not found"; ergative past forms; left/right words.
## mr, kok — 642 strings each, checker passed
- mr: ऑर्डर treated feminine; बॅग vs पिशवी; tapSend uses "पाठवा (Send)".
- kok: Goan Konkani forms (-आत imperatives, गिरायक, सुमान); check फुकट vs मोफत, ऑर्डरी plural agreement, Marathi slips in perfect forms.
## mni, sa — 642 strings each, checker passed
- sa: moderate–good. Loanword कमीशन; coinages गुप्तशब्दः, नियन्त्रणपटलम्, स्यूतः.
- mni: LOW–MODERATE — needs FULL native Meitei review. merchant.welcome reads as "thank you for coming"; counts placed after noun; many Bengali-script loanwords.
## or, sat — 642 strings each, checker passed
- or: fairly confident; ମୁଦି ଦୋକାନ grocery; ବିକ୍ରି ଦାମ୍ list price; Odia danda ।
- sat: MODERATE–LOW — native review strongly recommended. Ol Chiki only; ᱾ full stop; familiar imperative ᱢᱮ (maybe too informal); regional spelling standard to confirm.
