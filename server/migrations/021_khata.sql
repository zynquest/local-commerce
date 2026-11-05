-- Khata (credit ledger): the owner's own record of what each regular customer owes. Entries are either "credit"
-- (goods given now, paid later: the customer owes more) or "payment" (money received: they owe less). The balance is
-- the sum of credits minus payments. Entries come from an order ("Add to Khata") or are typed in for offline sales.
CREATE TABLE khata_customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone       text CHECK (phone ~ '^91[6-9][0-9]{9}$'),     -- for WhatsApp reminders; optional
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX khata_customers_store_idx ON khata_customers (store_id, name);
-- One customer per mobile number in a store (orders from the same number land in the same khata).
CREATE UNIQUE INDEX khata_customers_phone_idx ON khata_customers (store_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE khata_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES khata_customers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('credit', 'payment')),
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  note         text CHECK (length(note) <= 200),
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  entry_date   date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX khata_entries_customer_idx ON khata_entries (customer_id, entry_date DESC, created_at DESC);
-- An order goes into the khata at most once.
CREATE UNIQUE INDEX khata_entries_order_idx ON khata_entries (order_id) WHERE order_id IS NOT NULL;
