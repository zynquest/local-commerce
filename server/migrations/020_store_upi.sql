-- Optional UPI ID for payments (e.g. gupta@okaxis). Shown on the store page: tapping it opens the shopper's UPI app
-- (upi://pay) with the store as payee. Not needed to submit or run the store.
ALTER TABLE stores ADD COLUMN upi_id text CHECK (upi_id ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9.]{1,63}$');
