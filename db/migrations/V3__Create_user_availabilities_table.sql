SET timezone = 'Asia/Bangkok';

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE user_availabilities (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    format tournament_rule_enum NOT NULL,
    expected_judge_level judge_level_enum,
    expected_debater_level debater_level_enum,
    roles JSONB NOT NULL,

    CONSTRAINT no_overlapping_availabilities EXCLUDE USING gist (
        user_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    )
);

CREATE INDEX idx_user_availabilities_user_id ON user_availabilities(user_id);
CREATE INDEX idx_user_availabilities_matching ON user_availabilities(user_id, start_time, end_time) WHERE (roles ? 'judge');
