-- Store owners log in with email + OTP (OWNER_LOGIN=email, the default). Email and mobile are each unique, and each
-- records when it was verified: the email by its login code, the mobile when the store is approved with it as the
-- WhatsApp number (or, for owners who registered by mobile OTP before, at registration).
ALTER TABLE users
  ADD COLUMN email citext UNIQUE CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN phone_verified_at timestamptz;
UPDATE users SET phone_verified_at = coalesce(last_login_at, created_at) WHERE phone IS NOT NULL AND role = 'owner';

ALTER TABLE customers
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN phone_verified_at timestamptz;
UPDATE customers SET email_verified_at = coalesce(last_login_at, created_at) WHERE email IS NOT NULL;
UPDATE customers SET phone_verified_at = coalesce(last_login_at, created_at) WHERE phone IS NOT NULL;
