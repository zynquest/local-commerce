-- Owner claim requests for seeded listings. A new owner signs in (email code or Google, so the email is proven),
-- finds their shop among the unclaimed seeded listings near them and asks for it. They then send proof of
-- ownership on WhatsApp to the platform number, quoting the claim code. The platform admin checks it and
-- approves (the listing is handed to that email + WhatsApp number) or rejects with remarks.
-- No account is created until the claim is approved: the claimant's email logs straight into the shop then.
CREATE TABLE store_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^CLM-[A-Z0-9]{6}$'),   -- quoted in the WhatsApp message
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (length(email) <= 254),               -- verified when the claim was made
  phone       text NOT NULL CHECK (phone ~ '^91[6-9][0-9]{9}$'),        -- WhatsApp for orders; proven in the chat
  language    text NOT NULL DEFAULT 'en' CHECK (length(language) <= 8),  -- for the decision email
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  remarks     text CHECK (length(remarks) <= 1000),
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- One open request per person: asking again (for the same or another shop) replaces the earlier one.
CREATE UNIQUE INDEX store_claims_one_pending_idx ON store_claims (email) WHERE status = 'pending';
CREATE INDEX store_claims_status_idx ON store_claims (status, created_at DESC);
CREATE INDEX store_claims_store_idx ON store_claims (store_id) WHERE status = 'pending';
