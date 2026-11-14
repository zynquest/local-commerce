-- Hidden prices: a store can hide all its prices (hide_prices), or one product or service at a time (hide_price).
-- Customers then see "Price on request" and can still order or book; the store confirms the price on WhatsApp.
ALTER TABLE stores ADD COLUMN hide_prices boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN hide_price boolean NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN hide_price boolean NOT NULL DEFAULT false;

-- An order line or booking whose price was hidden when it was placed: no price is recorded (0), shown as
-- "Price on request". orders.price_on_request: the order has at least one such line (its total leaves them out).
ALTER TABLE order_items ADD COLUMN price_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN price_on_request boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN price_hidden boolean NOT NULL DEFAULT false;
