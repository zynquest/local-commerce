-- 1) Store location from Google Maps (shoppers see businesses within a few km).
-- 2) Business type: 'shop' (products + WhatsApp orders) or 'appointments' (salon, spa, beauty parlour, clinic).
-- 3) Appointment module: services, specialists with weekly hours, and bookings that can never overlap.

ALTER TABLE stores
  ADD COLUMN business_type text NOT NULL DEFAULT 'shop' CHECK (business_type IN ('shop', 'appointments')),
  ADD COLUMN lat double precision CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng double precision CHECK (lng BETWEEN -180 AND 180),
  ADD COLUMN place_id text CHECK (length(place_id) <= 300),
  -- Appointment settings: slot grid, how far ahead customers can book, minimum notice.
  ADD COLUMN slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes IN (10, 15, 20, 30, 45, 60)),
  ADD COLUMN booking_days integer NOT NULL DEFAULT 14 CHECK (booking_days BETWEEN 1 AND 60),
  ADD COLUMN min_notice_minutes integer NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 2880),
  ADD CONSTRAINT stores_lat_lng_together CHECK ((lat IS NULL) = (lng IS NULL));
CREATE INDEX stores_geo_idx ON stores (lat, lng) WHERE status = 'approved';

-- Trusted extension (PG13+): the database owner can create it. Lets us forbid overlapping bookings in the schema.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category      text NOT NULL DEFAULT 'Other' CHECK (length(category) <= 60),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  duration_min  integer NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
  price         numeric(10,2) NOT NULL CHECK (price >= 0),
  active        boolean NOT NULL DEFAULT true,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_store_idx ON services (store_id, position);

-- schedule: weekly working hours, e.g. {"mon": [["10:00","13:00"], ["14:00","19:00"]], "sun": []}
CREATE TABLE specialists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  title         text NOT NULL DEFAULT '' CHECK (length(title) <= 80),
  photo_url     text,
  schedule      jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX specialists_store_idx ON specialists (store_id, position);

CREATE TABLE specialist_services (
  specialist_id uuid NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id    uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (specialist_id, service_id)
);

-- Service/specialist names and price are copied onto the booking so history survives later edits or deletes.
CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  specialist_id    uuid REFERENCES specialists(id) ON DELETE SET NULL,
  service_id       uuid REFERENCES services(id) ON DELETE SET NULL,
  code             text NOT NULL,
  service_name     text NOT NULL,
  specialist_name  text NOT NULL,
  price            numeric(10,2) NOT NULL DEFAULT 0,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  customer_name    text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 60),
  customer_phone   text NOT NULL CHECK (customer_phone ~ '^91[6-9][0-9]{9}$'),
  customer_id      uuid REFERENCES customers(id) ON DELETE SET NULL,
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  language         text NOT NULL DEFAULT 'en',
  status           text NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (store_id, code),
  -- A specialist can't have two live bookings that overlap, even under concurrent requests.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    specialist_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('requested', 'confirmed'))
);
CREATE INDEX appointments_store_time_idx ON appointments (store_id, starts_at);
CREATE INDEX appointments_customer_idx ON appointments (customer_id, starts_at DESC);
