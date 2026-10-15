-- Store approval workflow, single platform admin, phone/OTP auth, 50-SKU free tier.

-- Users: phone number (registration mobile), optional password (OTP-only accounts), one platform admin max.
ALTER TABLE users ADD COLUMN phone text UNIQUE CHECK (phone ~ '^[1-9][0-9]{9,14}$');
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX users_single_platform_admin ON users (role) WHERE role = 'platform_admin';

ALTER TABLE customers ALTER COLUMN password_hash DROP NOT NULL;

-- Sessions: separate subject type for the platform admin.
ALTER TABLE sessions DROP CONSTRAINT sessions_subject_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_subject_type_check CHECK (subject_type IN ('user', 'customer', 'admin'));

-- Stores: review status replaces is_active.
ALTER TABLE stores
  ADD COLUMN status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended')),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_remarks text,
  ADD COLUMN whatsapp_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN sku_seq integer NOT NULL DEFAULT 0; -- counter for auto-assigned SKUs (P0001, P0002, …)

UPDATE stores SET status = CASE WHEN is_active THEN 'approved' ELSE 'suspended' END; -- grandfather existing stores
ALTER TABLE stores DROP COLUMN is_active;
CREATE INDEX stores_status_idx ON stores (status, submitted_at);

-- Plans: free (up to 50 products) and paid (50+).
ALTER TABLE stores DROP CONSTRAINT stores_plan_check;
UPDATE stores SET plan = 'paid' WHERE plan = 'custom';
ALTER TABLE stores ADD CONSTRAINT stores_plan_check CHECK (plan IN ('free', 'paid'));
ALTER TABLE stores ALTER COLUMN sku_limit SET DEFAULT 50;
UPDATE stores SET sku_limit = 50 WHERE plan = 'free';

-- Review history shown to both the admin and the store owner.
CREATE TABLE store_reviews (
  id          bigserial PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'suspended', 'reinstated')),
  remarks     text,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_reviews_store_idx ON store_reviews (store_id, created_at DESC);

-- One-time passcodes (login/registration when phone login is enabled, WhatsApp number changes).
CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN
                 ('owner_login', 'owner_register', 'customer_login', 'customer_register', 'whatsapp_change')),
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_lookup_idx ON otp_codes (phone, purpose, created_at DESC);
