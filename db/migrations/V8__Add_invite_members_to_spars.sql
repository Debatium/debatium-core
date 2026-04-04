-- Add invite_members JSONB column to spars table
-- Stores the list of invited people (by email/username) at creation time
-- Format: [{ "email": "...", "username": "..." }, ...]
ALTER TABLE spars ADD COLUMN invite_members JSONB NOT NULL DEFAULT '[]'::jsonb;
