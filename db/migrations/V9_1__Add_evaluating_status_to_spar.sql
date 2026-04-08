-- Add a new Spar lifecycle state used by post-debate evaluation flows.
DO $$
BEGIN
    ALTER TYPE spar_status_enum ADD VALUE IF NOT EXISTS 'evaluating';
END;
$$ LANGUAGE plpgsql;
