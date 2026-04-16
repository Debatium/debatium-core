-- Add user role enum and column
CREATE TYPE user_role_enum AS ENUM ('user', 'admin');

ALTER TABLE users
    ADD COLUMN role user_role_enum NOT NULL DEFAULT 'user';
