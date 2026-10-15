-- Demo stores (created with `npm run demo:create`): public and orderable, but labelled "Demo", listed after real
-- stores, and kept out of search engines (noindex, not in the sitemap).
ALTER TABLE stores ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
