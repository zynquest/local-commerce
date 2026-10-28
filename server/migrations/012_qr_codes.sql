-- Printed QR codes. The platform pre-generates a pool of random 8-digit codes, prints them, and links each one to
-- a store later (or moves it to another store). A scan of https://sonsari.in/q/<code> goes through the server,
-- which counts it and redirects to the linked store's page. Deleting a store frees its codes for reuse.
CREATE TABLE qr_codes (
  code            text PRIMARY KEY CHECK (code ~ '^[1-9][0-9]{7}$'),
  store_id        uuid REFERENCES stores(id) ON DELETE SET NULL,
  assigned_at     timestamptz,
  batch           text NOT NULL,                 -- codes generated together (e.g. one print run)
  scans           integer NOT NULL DEFAULT 0,
  last_scanned_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_codes_store_idx ON qr_codes (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX qr_codes_created_idx ON qr_codes (created_at DESC, code);
