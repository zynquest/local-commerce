-- The platform admin can open a store in the owner screens (create a store for an owner, or edit an existing one).
-- Such an owner session carries the admin who opened it, so the screens show "admin mode" and it ends when the
-- admin signs out.
ALTER TABLE sessions ADD COLUMN acting_admin_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX sessions_acting_admin_idx ON sessions (acting_admin_id) WHERE acting_admin_id IS NOT NULL;

-- Review log: a store created by the admin for its owner, and each time the admin opens a store as its owner.
ALTER TABLE store_reviews DROP CONSTRAINT store_reviews_action_check;
ALTER TABLE store_reviews ADD CONSTRAINT store_reviews_action_check
  CHECK (action IN ('submitted', 'approved', 'rejected', 'suspended', 'reinstated', 'claimed', 'created_by_admin', 'opened_by_admin'));
