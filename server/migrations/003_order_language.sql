-- Language used for the WhatsApp order message a store receives (independent of the shopper's UI language).
ALTER TABLE stores ADD COLUMN order_language text NOT NULL DEFAULT 'en'
  CHECK (order_language IN ('en','hi','bn','mr','te','ta','gu','ur','kn','or','ml','pa','as','mai','sat','ks','ne','sd','kok','doi','mni','brx','sa'));
