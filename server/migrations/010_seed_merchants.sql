-- Seeded merchants: listings the platform creates from public data (OpenStreetMap, Google Places, field surveys)
-- so shoppers nearby can find a shop before its owner signs up. origin = 'seed' (created by us) | 'organic'
-- (registered by the owner). A seed stays origin = 'seed' after the owner claims it; claimed_at marks the claim.
-- Unclaimed seeds are browsable only within the nearby radius, never indexed, and never take orders.
ALTER TABLE stores
  ADD COLUMN origin       text NOT NULL DEFAULT 'organic' CHECK (origin IN ('organic', 'seed')),
  ADD COLUMN seed_source  text CHECK (seed_source IN ('osm', 'google_places', 'manual')),
  ADD COLUMN seed_ref     text CHECK (length(seed_ref) <= 300),   -- e.g. osm:node/123, gplace:ChIJ…; re-imports update, never duplicate
  ADD COLUMN seed_phone   text CHECK (length(seed_phone) <= 40),  -- public phone from the source, for the field team; never shown to shoppers
  ADD COLUMN claim_phone  text CHECK (claim_phone ~ '^91[6-9][0-9]{9}$'), -- seed_phone when it is an Indian mobile: registering with it claims the listing
  ADD COLUMN locality     text CHECK (length(locality) <= 80),
  ADD COLUMN claimed_at   timestamptz,
  ADD CONSTRAINT stores_seed_fields CHECK (origin = 'seed' OR (seed_source IS NULL AND seed_ref IS NULL AND claimed_at IS NULL));
CREATE UNIQUE INDEX stores_seed_ref_idx ON stores (seed_ref) WHERE seed_ref IS NOT NULL;
CREATE INDEX stores_claim_phone_idx ON stores (claim_phone) WHERE claim_phone IS NOT NULL AND claimed_at IS NULL;
CREATE INDEX stores_unclaimed_seed_idx ON stores (locality) WHERE origin = 'seed' AND claimed_at IS NULL;

-- Listings removed at the owner's request: re-imports skip them for good.
CREATE TABLE seed_optouts (
  seed_ref    text PRIMARY KEY,
  name        text,
  reason      text,
  removed_at  timestamptz NOT NULL DEFAULT now()
);

-- Review log: a seed handed over to its owner.
ALTER TABLE store_reviews DROP CONSTRAINT store_reviews_action_check;
ALTER TABLE store_reviews ADD CONSTRAINT store_reviews_action_check
  CHECK (action IN ('submitted', 'approved', 'rejected', 'suspended', 'reinstated', 'claimed'));
