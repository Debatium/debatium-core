-- V15: Allow reusing cancelled spar names by changing the unique constraint to a partial index

BEGIN;

ALTER TABLE spars DROP CONSTRAINT IF EXISTS spars_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS spars_name_active_idx 
ON spars (name) 
WHERE status != 'cancelled';

COMMIT;
