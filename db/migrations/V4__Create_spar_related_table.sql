SET timezone = 'Asia/Bangkok';

CREATE TYPE spar_status_enum AS ENUM ('created', 'matching', 'ready', 'debating', 'done', 'cancelled');
CREATE TYPE spar_role_enum AS ENUM ('debater', 'judge', 'observer');
CREATE TYPE request_status_enum AS ENUM ('pending', 'accepted', 'declined', 'invited');

CREATE TABLE IF NOT EXISTS meet_links (
    link VARCHAR(200) PRIMARY KEY,
    is_in_use BOOLEAN NOT NULL DEFAULT FALSE,
    current_spar_id UUID -- will add constraint after spars table is created
);

CREATE TABLE IF NOT EXISTS spars (
    id UUID PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    time TIMESTAMPTZ NOT NULL,
    rule tournament_rule_enum NOT NULL,
    status spar_status_enum NOT NULL DEFAULT 'created',
    expected_debater_level debater_level_enum NOT NULL,
    expected_judge_level judge_level_enum ,
    expecting_judge BOOLEAN NOT NULL DEFAULT FALSE,
    motion TEXT,
    meet_link VARCHAR(200),
    judge_finding_priority INT NOT NULL DEFAULT 0,
    debater_finding_priority INT NOT NULL DEFAULT 0,
    invite_members JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE meet_links
ADD CONSTRAINT fk_meet_links_current_spar
FOREIGN KEY (current_spar_id) REFERENCES spars(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS spar_members (
    spar_id UUID REFERENCES spars(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role spar_role_enum NOT NULL,
    is_host BOOLEAN NOT NULL DEFAULT FALSE,
    status request_status_enum NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (spar_id, user_id)
);

CREATE INDEX idx_spars_matching_queue ON spars(status, expecting_judge, created_at);
CREATE INDEX idx_spars_time ON spars(time);
CREATE INDEX idx_spar_members_overlap ON spar_members(user_id, status);


CREATE TABLE IF NOT EXISTS spar_prep_links (
    spar_id UUID REFERENCES spars(id) ON DELETE CASCADE,
    meet_link VARCHAR(200) REFERENCES meet_links(link) ON DELETE CASCADE,
    team_identifier VARCHAR(100) NOT NULL,
    PRIMARY KEY (spar_id, meet_link),
    UNIQUE (spar_id, team_identifier)
);

-- Insert initial pool of Google Meet links
INSERT INTO meet_links (link) VALUES
('meet.google.com/xut-ofhz-fih'),
('meet.google.com/vir-htrz-ekp'),
('meet.google.com/dug-sazz-irk'),
('meet.google.com/ezo-qdjs-pjt'),
('meet.google.com/zpm-rtwy-few'),
('meet.google.com/ioo-bsca-ftc'),
('meet.google.com/stu-cgut-bwu'),
('meet.google.com/jfp-vrxx-ufe'),
('meet.google.com/gtu-gxkj-jpr'),
('meet.google.com/hhi-nwwb-bpe')
ON CONFLICT (link) DO NOTHING;

-- 1. Helper function to assign meet links
CREATE OR REPLACE FUNCTION assign_meet_link(p_spar_id UUID)
RETURNS VARCHAR(200) AS $$
DECLARE
    v_link VARCHAR(200);
BEGIN
    UPDATE meet_links
    SET is_in_use = TRUE, current_spar_id = p_spar_id
    WHERE link = (
        SELECT link FROM meet_links WHERE is_in_use = FALSE LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING link INTO v_link;

    IF v_link IS NOT NULL THEN
        UPDATE spars SET meet_link = v_link, status = 'ready' WHERE id = p_spar_id;
    END IF;

    RETURN v_link;
END;
$$ LANGUAGE plpgsql;

-- 2. Helper function to release meet links
CREATE OR REPLACE FUNCTION release_spar_links(p_spar_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE meet_links SET is_in_use = FALSE, current_spar_id = NULL WHERE current_spar_id = p_spar_id;
    DELETE FROM spar_prep_links WHERE spar_id = p_spar_id;
    UPDATE spars SET meet_link = NULL WHERE id = p_spar_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Main readiness evaluation function
CREATE OR REPLACE FUNCTION evaluate_spar_readiness(p_spar_id UUID, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
    v_spar RECORD;
    v_debater_count INT;
    v_judge_count INT;
    v_is_ready BOOLEAN := FALSE;
    v_diff_seconds DOUBLE PRECISION;
    v_main_link VARCHAR(200);
    v_prep_teams TEXT[];
    v_team TEXT;
BEGIN
    SELECT * INTO v_spar FROM spars WHERE id = p_spar_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Spar not found.'::TEXT;
        RETURN;
    END IF;

    -- If already debating, we don't change anything
    IF v_spar.status IN ('debating', 'done', 'cancelled') THEN
        RETURN QUERY SELECT TRUE, ('Spar is in ' || v_spar.status || ' status.')::TEXT;
        RETURN;
    END IF;

    -- Cleanup old pending requests (older than 24 hours) as a lazy maintenance step
    DELETE FROM spar_members WHERE spar_id = p_spar_id AND status IN ('pending', 'invited') AND created_at < p_now - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_debater_count FROM spar_members WHERE spar_id = p_spar_id AND role = 'debater' AND status = 'accepted';
    SELECT COUNT(*) INTO v_judge_count FROM spar_members WHERE spar_id = p_spar_id AND role = 'judge' AND status = 'accepted';

    -- Rule checks
    IF v_spar.rule = 'wsdc' THEN
        v_is_ready := (v_debater_count = 6);
        v_prep_teams := ARRAY['Team 1', 'Team 2'];
    ELSIF v_spar.rule = 'bp' THEN
        v_is_ready := (v_debater_count = 8);
        v_prep_teams := ARRAY['Team 1', 'Team 2', 'Team 3', 'Team 4'];
    ELSE
        RETURN QUERY SELECT FALSE, 'Invalid rule.'::TEXT;
        RETURN;
    END IF;

    IF v_spar.expecting_judge AND v_judge_count = 0 THEN
        v_is_ready := FALSE;
    END IF;

    v_diff_seconds := EXTRACT(EPOCH FROM (v_spar.time - p_now));

    IF v_is_ready THEN
        IF v_spar.status != 'ready' THEN
            -- Transition to ready only if within the 15-minute lead window
            -- Window for allocation: [time - 15m, time + 90m]
            IF v_diff_seconds <= 900 AND v_diff_seconds >= -5400 THEN
                IF v_spar.meet_link IS NULL THEN
                    v_main_link := assign_meet_link(p_spar_id);
                ELSE
                    v_main_link := v_spar.meet_link;
                END IF;

                IF v_main_link IS NULL THEN
                    -- If we are very close or past start time and still no links, cancel
                    IF v_diff_seconds <= 0 THEN
                        PERFORM release_spar_links(p_spar_id);
                        UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                        RETURN QUERY SELECT FALSE, 'No available Meet links at start time. Spar cancelled.'::TEXT;
                    ELSE
                        RETURN QUERY SELECT FALSE, 'No available Meet links yet.'::TEXT;
                    END IF;
                    RETURN;
                END IF;

                -- Assign Prep Links
                FOREACH v_team IN ARRAY v_prep_teams LOOP
                    -- Only allocate if this specific team identifier does not yet have a link for this spar
                    IF NOT EXISTS (SELECT 1 FROM spar_prep_links WHERE spar_id = p_spar_id AND team_identifier = v_team) THEN
                        WITH updated AS (
                            UPDATE meet_links
                            SET is_in_use = TRUE, current_spar_id = p_spar_id
                            WHERE link = (
                                SELECT link FROM meet_links WHERE is_in_use = FALSE LIMIT 1 FOR UPDATE SKIP LOCKED
                            )
                            RETURNING link
                        )
                        INSERT INTO spar_prep_links (spar_id, meet_link, team_identifier)
                        SELECT p_spar_id, link, v_team FROM updated;
                    END IF;
                END LOOP;

                UPDATE spars SET status = 'ready' WHERE id = p_spar_id;
                RETURN QUERY SELECT TRUE, 'Spar is ready and links are allocated.'::TEXT;
            ELSIF v_diff_seconds < -5400 THEN
                 PERFORM release_spar_links(p_spar_id);
                 UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                 RETURN QUERY SELECT FALSE, 'Spar has already expired and was never ready.'::TEXT;
            ELSE
                -- Ready but too early to allocate links
                RETURN QUERY SELECT TRUE, 'Spar is matched and ready, links will be allocated 15 minutes before start.'::TEXT;
            END IF;
        ELSE
            -- Already ready, check if we need to release due to expiration
            IF v_diff_seconds < -5400 THEN
                PERFORM release_spar_links(p_spar_id);
                UPDATE spars SET status = 'done' WHERE id = p_spar_id;
                RETURN QUERY SELECT TRUE, 'Spar completed and links released.'::TEXT;
            ELSE
                RETURN QUERY SELECT TRUE, 'Spar is already ready.'::TEXT;
            END IF;
        END IF;
    ELSE
        -- Not ready
        IF v_spar.status = 'ready' THEN
            PERFORM release_spar_links(p_spar_id);
            UPDATE spars SET status = 'created' WHERE id = p_spar_id;

            -- If within 15 minutes of start (or past start), cancel
            IF v_diff_seconds <= 900 THEN
                PERFORM release_spar_links(p_spar_id); -- Double check release
                UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                RETURN QUERY SELECT FALSE, 'Spar no longer ready and within lead window. Cancelled.'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE, 'Spar moved back to created as it no longer meets requirements.'::TEXT;
            END IF;
        -- If within 15 minutes of start (or past start) and not ready, cancel
        ELSIF v_diff_seconds <= 900 THEN
            PERFORM release_spar_links(p_spar_id);
            UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
            RETURN QUERY SELECT FALSE, 'Spar not ready 15 minutes before start. Cancelled.'::TEXT;
        ELSE
            RETURN QUERY SELECT FALSE, 'Spar is not ready.'::TEXT;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. Overlap Check Trigger
CREATE OR REPLACE FUNCTION check_spar_overlap()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the user has any other spar that overlaps within a specific hour window
    IF EXISTS (
        SELECT 1
        FROM spar_members sm
        JOIN spars s ON sm.spar_id = s.id
        JOIN spars s_new ON s_new.id = NEW.spar_id
        WHERE sm.user_id = NEW.user_id
          AND sm.status = 'accepted'
          AND sm.spar_id != NEW.spar_id
          AND s.status NOT IN ('cancelled', 'done')
          AND s_new.status NOT IN ('cancelled', 'done')
          AND (s.time, s.time + INTERVAL '1.5 hours') OVERLAPS (s_new.time, s_new.time + INTERVAL '1.5 hours')
    ) THEN
        RAISE EXCEPTION 'User has another overlapping spar at this time' USING ERRCODE = 'SP001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_spar_overlap
BEFORE INSERT OR UPDATE ON spar_members
FOR EACH ROW
EXECUTE FUNCTION check_spar_overlap();

-- 5. Automated Readiness Trigger
CREATE OR REPLACE FUNCTION trigger_evaluate_readiness()
RETURNS TRIGGER AS $$
DECLARE
    v_spar_id UUID;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_spar_id := OLD.spar_id;
    ELSE
        v_spar_id := NEW.spar_id;
    END IF;

    PERFORM evaluate_spar_readiness(v_spar_id);

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_spar_readiness_on_member_change
AFTER INSERT OR UPDATE OR DELETE ON spar_members
FOR EACH ROW
EXECUTE FUNCTION trigger_evaluate_readiness();

-- 6. Spar Lead Time Check Trigger
CREATE OR REPLACE FUNCTION check_spar_lead_time()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.time < NOW() + INTERVAL '1 hour' THEN
        RAISE EXCEPTION 'Spar start time must be at least 1 hour from now' USING ERRCODE = 'SP001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_spar_lead_time
BEFORE INSERT ON spars
FOR EACH ROW
EXECUTE FUNCTION check_spar_lead_time();
