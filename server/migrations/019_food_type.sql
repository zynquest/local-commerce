-- Shops say whether they are pure vegetarian or also sell non-veg (egg, meat, fish), or aren't a food shop at all.
-- Shoppers see the Indian green (veg) or brown (non-veg) mark next to the store name; 'none' shows no mark.
-- Asked before a shop is submitted for approval; NULL for existing stores until the owner answers in Settings.
ALTER TABLE stores ADD COLUMN food_type text CHECK (food_type IN ('veg', 'nonveg', 'none'));
