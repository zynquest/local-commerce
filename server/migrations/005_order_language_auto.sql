-- WhatsApp order messages follow the customer's language by default ('auto'). A store can still pick one fixed
-- language in Settings. Existing stores were on the old default ('en'), so they move to 'auto'.
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_order_language_check;
ALTER TABLE stores ADD CONSTRAINT stores_order_language_check
  CHECK (order_language IN ('auto','en','hi','bn','mr','te','ta','gu','ur','kn','or','ml','pa','as','mai','sat','ks','ne','sd','kok','doi','mni','brx','sa'));
ALTER TABLE stores ALTER COLUMN order_language SET DEFAULT 'auto';
UPDATE stores SET order_language = 'auto' WHERE order_language = 'en';
