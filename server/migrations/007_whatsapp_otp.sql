-- WhatsApp OTP, "reply" mode (free on Meta's Cloud API): the user sends us a WhatsApp message containing a
-- one-time request token; when it arrives from the same number they typed, we reply with the code.
CREATE TABLE otp_wa_requests (
  token       text PRIMARY KEY,
  phone       text NOT NULL CHECK (phone ~ '^[1-9][0-9]{9,14}$'),
  purpose     text NOT NULL CHECK (purpose IN
                ('owner_login', 'owner_register', 'customer_login', 'customer_register', 'whatsapp_change')),
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  language    text NOT NULL DEFAULT 'en',
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_wa_requests_phone_idx ON otp_wa_requests (phone, created_at DESC);
