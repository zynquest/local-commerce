-- Vocal For Local: initial schema
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Store owners (merchants) and platform admins.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       citext NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  password_hash  text NOT NULL,
  role           text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'platform_admin')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE stores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug             citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  whatsapp_number  text CHECK (whatsapp_number ~ '^[1-9][0-9]{9,14}$'),
  instagram_handle text,
  logo_url         text,
  banner_url       text,
  address_text     text,
  maps_url         text,
  description      text CHECK (length(description) <= 500),
  category         text,                       -- e.g. Grocery, Bakery, Pharmacy (directory filter)
  city             text,
  currency_symbol  text NOT NULL DEFAULT '₹',
  minimum_order    numeric(10,2) NOT NULL DEFAULT 0 CHECK (minimum_order >= 0),
  delivery_fee     numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  opening_hours    text,                       -- "09:00-21:00"
  closed_days      text,                       -- "Sun" / "Sat,Sun"
  theme_color      text CHECK (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  verified         boolean NOT NULL DEFAULT false,
  plan             text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'custom')),
  sku_limit        integer NOT NULL DEFAULT 500 CHECK (sku_limit > 0),
  custom_domain    citext UNIQUE,              -- set by the platform team for custom-store plans
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku_id        text NOT NULL CHECK (sku_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  category      text NOT NULL DEFAULT 'Other',
  mrp           numeric(10,2) NOT NULL CHECK (mrp >= 0),
  offer_price   numeric(10,2) NOT NULL CHECK (offer_price >= 0),
  images        text[] NOT NULL DEFAULT '{}',
  description   text NOT NULL DEFAULT '',
  specs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags          text[] NOT NULL DEFAULT '{}',
  rating        numeric(2,1) CHECK (rating BETWEEN 1 AND 5),
  review_count  integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  in_stock      boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku_id),
  CHECK (offer_price <= mrp)
);
CREATE INDEX products_store_active_idx ON products (store_id, position) WHERE status = 'active';

-- Shoppers. Accounts are optional: guests can order without one.
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone            text NOT NULL UNIQUE CHECK (phone ~ '^[1-9][0-9]{9,14}$'),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  password_hash    text NOT NULL,
  default_address  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);

-- Opaque session tokens (only a SHA-256 hash is stored), for both owners and customers.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  subject_type  text NOT NULL CHECK (subject_type IN ('user', 'customer')),
  subject_id    uuid NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_subject_idx ON sessions (subject_type, subject_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_code        text NOT NULL CHECK (order_code ~ '^ORD-[A-Z0-9]{6,12}$'), -- generated on the device
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,          -- NULL = guest order
  customer_name     text,
  customer_phone    text,
  delivery_address  text,
  notes             text,                                                      -- unlisted items / instructions
  subtotal          numeric(10,2) NOT NULL,
  delivery_fee      numeric(10,2) NOT NULL DEFAULT 0,
  savings           numeric(10,2) NOT NULL DEFAULT 0,
  total             numeric(10,2) NOT NULL,
  price_mismatch    boolean NOT NULL DEFAULT false, -- device prices differed from the live catalog (stale cache)
  placed_offline    boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'placed'
                    CHECK (status IN ('placed', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled')),
  client_created_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_code) -- makes offline re-sync idempotent
);
CREATE INDEX orders_store_created_idx ON orders (store_id, created_at DESC);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);

CREATE TABLE order_items (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_id      text NOT NULL,
  name        text NOT NULL,
  mrp         numeric(10,2) NOT NULL,
  unit_price  numeric(10,2) NOT NULL, -- price the shopper saw (may be stale)
  quantity    integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total  numeric(10,2) NOT NULL
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
