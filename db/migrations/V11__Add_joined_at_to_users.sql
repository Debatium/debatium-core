-- Track when users joined the platform.
-- Existing rows get NOW() via the DEFAULT; new rows default to join time.

ALTER TABLE users
    ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX idx_users_joined_at ON users(joined_at);
