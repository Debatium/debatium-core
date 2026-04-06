SET timezone = 'Asia/Bangkok';

CREATE TABLE IF NOT EXISTS spar_ballots (
    spar_id         UUID PRIMARY KEY REFERENCES spars(id) ON DELETE CASCADE,
    judge_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    results_json    JSONB NOT NULL,
    placements_json JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spar_feedbacks (
    spar_id      UUID NOT NULL REFERENCES spars(id) ON DELETE CASCADE,
    debater_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    rating       DECIMAL(4, 1) NOT NULL,
    comment      TEXT,
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (spar_id, debater_id)
);

CREATE INDEX IF NOT EXISTS idx_spar_ballots_judge_id   ON spar_ballots(judge_id);
CREATE INDEX IF NOT EXISTS idx_spar_feedbacks_spar_id  ON spar_feedbacks(spar_id);
CREATE INDEX IF NOT EXISTS idx_spar_feedbacks_debater_id ON spar_feedbacks(debater_id);
