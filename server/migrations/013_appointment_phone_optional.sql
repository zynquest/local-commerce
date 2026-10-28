-- Booking no longer asks for a phone number: the customer sends the request on WhatsApp, so the business sees it there.
-- A number is still stored when the customer is signed in with one. The format check stays for numbers that are given.
ALTER TABLE appointments ALTER COLUMN customer_phone DROP NOT NULL;
