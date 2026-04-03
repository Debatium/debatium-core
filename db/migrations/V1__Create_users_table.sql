-- 1. Create ENUMs for user levels
CREATE TYPE debater_level_enum AS ENUM ('novice', 'open', 'pro');
CREATE TYPE judge_level_enum AS ENUM ('novice', 'intermediate', 'advanced', 'expert');

-- 2. Create the users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    full_name VARCHAR(200) NOT NULL,
    username VARCHAR(200) NOT NULL,
    password TEXT NOT NULL,
    email TEXT NOT NULL,
    calendar_key TEXT,
    debater_level debater_level_enum NOT NULL,
    judge_level judge_level_enum NOT NULL,
    debater_score NUMERIC DEFAULT 0,
    judge_score NUMERIC DEFAULT 0,
    institution TEXT,
    avatar_url INT DEFAULT 1 CONSTRAINT avatar_range CHECK (avatar_url >= 1 AND avatar_url <= 10),

    CONSTRAINT unique_username UNIQUE(username),
    CONSTRAINT unique_email UNIQUE(email)
);

-- 3. Create indexes for optimized lookups
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_judge_level ON users(judge_level);
