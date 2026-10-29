-- Staff (sales reps): created by the platform admin in the admin console, they sign in at /motiveboss with a
-- username + generated password and can only approve or reject the stores submitted with their rep ID.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'platform_admin', 'staff'));
ALTER TABLE users ADD COLUMN staff_name text CHECK (staff_name IS NULL OR length(staff_name) <= 60);
ALTER TABLE users ADD COLUMN staff_phone text CHECK (staff_phone IS NULL OR staff_phone ~ '^91[6-9][0-9]{9}$');
-- 6 capital letters/digits, shown to the rep, given to shop owners, typed at "Submit for approval".
ALTER TABLE users ADD COLUMN rep_code text UNIQUE CHECK (rep_code IS NULL OR rep_code ~ '^[A-Z0-9]{6}$');
ALTER TABLE users ADD CONSTRAINT users_staff_has_rep_code CHECK (role <> 'staff' OR rep_code IS NOT NULL);

-- The sales rep ID the owner entered when submitting (kept as text: a deleted rep's stores keep it).
ALTER TABLE stores ADD COLUMN sales_rep_code text CHECK (sales_rep_code IS NULL OR sales_rep_code ~ '^[A-Z0-9]{6}$');
CREATE INDEX stores_sales_rep_idx ON stores (sales_rep_code, status) WHERE sales_rep_code IS NOT NULL;
