-- Shoppers log in with email + OTP (owners keep mobile + OTP). Existing phone-only customers stay valid rows but
-- cannot log in until they register an email; the phone, when present, is only a delivery contact now.
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE customers ADD COLUMN email text UNIQUE CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
-- otp_codes.phone holds the destination: a mobile number for owners, an email address for customers.
