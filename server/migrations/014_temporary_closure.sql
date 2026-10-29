-- Temporary closure (holiday, leave): the store stays visible but takes no orders or bookings.
-- Closed while temp_closed is on and today (India time) is before reopens_on; with no reopens_on, until switched off.
ALTER TABLE stores ADD COLUMN temp_closed boolean NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN reopens_on date;
ALTER TABLE stores ADD COLUMN closure_message text CHECK (closure_message IS NULL OR length(closure_message) <= 200);
