-- The flower stall demo store was retired (2026-10-29). Deleting its owner removes the store, products and orders
-- (ON DELETE CASCADE). Its generated images stay in UPLOAD_DIR/<store id>/ and are harmless.
DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.slug = 'demo-flowers' AND s.is_demo AND u.role = 'owner';
