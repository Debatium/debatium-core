SET timezone = 'Asia/Bangkok';

CREATE TYPE evaluation_status AS ENUM ('pending', 'submitted');

CREATE TABLE IF NOT EXISTS evaluations (
    spar_id         UUID NOT NULL REFERENCES spars(id) ON DELETE CASCADE,
    judge_id        UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    status          evaluation_status NOT NULL DEFAULT 'pending',
    results_json    JSONB,
    placements_json JSONB,
    feedbacks_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (spar_id, judge_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_judge_id ON evaluations(judge_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_status   ON evaluations(status);
