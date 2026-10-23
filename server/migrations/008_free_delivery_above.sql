-- Delivery fee rule: the fee is waived once the cart subtotal reaches free_delivery_above (NULL = always charge).
-- delivery_fee itself stays 0 by default: free delivery unless the owner sets a fee in Settings.
ALTER TABLE stores ADD COLUMN free_delivery_above numeric(10,2) CHECK (free_delivery_above >= 0);
