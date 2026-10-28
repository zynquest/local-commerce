

-- Delete Store by email id


BEGIN;

-- 1. Preview: check this is the right account before deleting.
SELECT u.id AS user_id, u.email, s.name AS store, s.slug,
       (SELECT count(*) FROM products p WHERE p.store_id = s.id) AS products,
       (SELECT count(*) FROM orders o WHERE o.store_id = s.id)   AS orders
  FROM users u
  LEFT JOIN stores s ON s.owner_id = u.id
 WHERE u.email = 'owner@example.com'
   AND u.role = 'owner';

-- 2. Sign them out everywhere (sessions aren't linked by foreign key).
DELETE FROM sessions
 WHERE subject_type = 'user'
   AND subject_id IN (SELECT id FROM users WHERE email = 'owner@example.com' AND role = 'owner');

-- 3. Delete the account. The store, products, orders, services, staff and reviews go with it; linked QR codes are freed.
DELETE FROM users u
 WHERE u.email = 'owner@example.com'
   AND u.role = 'owner'
   AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.owner_id = u.id AND s.is_demo)
RETURNING u.id, u.email;

COMMIT;   -- or ROLLBACK; if the preview or the returned row looks wrong







SELECT s.slug, s.name, u.phone FROM users u JOIN stores s ON s.owner_id = u.id
WHERE u.role = 'owner' AND u.email IS NULL AND s.origin <> 'seed' AND NOT s.is_demo;

select * from users;

SELECT category, count(*) AS listings FROM stores
 WHERE origin = 'seed' GROUP BY category ORDER BY listings DESC;


 BEGIN;

-- Preview: owners who registered with a mobile, and their stores (demo stores excluded)
SELECT u.id, u.phone, s.name, s.slug, s.status
  FROM users u LEFT JOIN stores s ON s.owner_id = u.id
 WHERE u.role = 'owner' AND u.phone IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM stores d WHERE d.owner_id = u.id AND d.is_demo);

-- Preview: shoppers who registered with a mobile
SELECT id, name, phone FROM customers WHERE phone IS NOT NULL;

-- Sign them out everywhere
DELETE FROM sessions
 WHERE (subject_type = 'user' AND subject_id IN (
          SELECT u.id FROM users u
           WHERE u.role = 'owner' AND u.phone IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM stores d WHERE d.owner_id = u.id AND d.is_demo)))
    OR (subject_type = 'customer' AND subject_id IN (SELECT id FROM customers WHERE phone IS NOT NULL));

-- Owners → their stores, products, orders, reviews and appointments are deleted with them
DELETE FROM users u
 WHERE u.role = 'owner' AND u.phone IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM stores d WHERE d.owner_id = u.id AND d.is_demo);

-- Shoppers (their past orders at other stores stay, marked as guest orders)
DELETE FROM customers WHERE phone IS NOT NULL;

-- Leftover login codes sent to mobile numbers
DELETE FROM otp_codes WHERE phone ~ '^[0-9]+$';

-- Check the counts above, then:
COMMIT;