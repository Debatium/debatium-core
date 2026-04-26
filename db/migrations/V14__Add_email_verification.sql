-- Email verification flow: track verified status + single-use token with TTL.

ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN verification_token TEXT,
    ADD COLUMN verification_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_users_verification_token
    ON users(verification_token)
    WHERE verification_token IS NOT NULL;

-- Grandfather all pre-existing accounts as verified (pre-launch).
UPDATE users SET email_verified = true;
