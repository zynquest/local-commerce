-- Web push (browser notifications) for store owners: one row per browser/phone that turned notifications on.
-- language: the owner's app language when subscribing, so notifications arrive in it.
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE CHECK (length(endpoint) <= 1000),
  p256dh      text NOT NULL CHECK (length(p256dh) <= 200),
  auth        text NOT NULL CHECK (length(auth) <= 100),
  language    text NOT NULL DEFAULT 'en',
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
