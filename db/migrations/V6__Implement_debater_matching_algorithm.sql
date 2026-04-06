SET timezone = 'Asia/Bangkok';

-- 1. Helper Function for Debater Level Ranks
CREATE OR REPLACE FUNCTION get_debater_level_rank(p_level debater_level_enum)
RETURNS INT AS $$
BEGIN
    RETURN COALESCE(array_position(enum_range(NULL::debater_level_enum), p_level), 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Main Matching Logic Function
CREATE OR REPLACE FUNCTION run_debater_matching()
RETURNS VOID AS $$
BEGIN
    -- Concurrency guard: prevent parallel triggers from stepping on each other
    IF NOT pg_try_advisory_xact_lock(112234) THEN
        RETURN;
    END IF;

    WITH
    debater_ranks AS (
        SELECT
            u.id as user_id,
            u.debater_level,
            get_debater_level_rank(u.debater_level) as rank
        FROM users u
    ),
    spar_needs AS (
        -- Calculate how many debaters are still needed/can be invited
        SELECT
            s.id as spar_id,
            s.rule,
            s.time,
            s.expected_debater_level,
            s.debater_finding_priority,
            CASE
                WHEN s.rule = 'wsdc' THEN 6
                WHEN s.rule = 'bp' THEN 8
                ELSE 0
            END as required_count,
            (SELECT COUNT(*) FROM spar_members sm WHERE sm.spar_id = s.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')) as current_count
        FROM spars s
        WHERE s.status = 'matching'
    ),
    potential_matches AS (
        SELECT
            sn.spar_id,
            dr.user_id,
            CASE
                -- Wave 1: Format Match + Level Exact
                WHEN ua.format = sn.rule AND dr.debater_level = sn.expected_debater_level THEN 1
                -- Wave 2: Format Match + Level -1
                WHEN ua.format = sn.rule AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 2
                -- Wave 3: Format Match + Level Above
                WHEN ua.format = sn.rule AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 3
                -- Wave 4: Format Mismatch + Level Exact (Min Priority 1)
                WHEN sn.debater_finding_priority >= 1 AND dr.debater_level = sn.expected_debater_level THEN 4
                -- Wave 5: Format Mismatch + Level -1 (Min Priority 1)
                WHEN sn.debater_finding_priority >= 1 AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 5
                -- Wave 6: Format Mismatch + Level Above (Min Priority 1)
                WHEN sn.debater_finding_priority >= 1 AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 6
                ELSE NULL
            END as wave
        FROM spar_needs sn
        CROSS JOIN debater_ranks dr
        JOIN user_availabilities ua ON ua.user_id = dr.user_id
        WHERE sn.current_count < sn.required_count
          -- Availability check
          AND ua.start_time <= sn.time AND ua.end_time >= sn.time
          AND ua.roles ? 'debater'
          -- Don't invite if already a member
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm
              WHERE sm.spar_id = sn.spar_id AND sm.user_id = dr.user_id
          )
          -- Don't invite if they have an overlapping accepted spar
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON sm_overlap.spar_id = s_overlap.id
              WHERE sm_overlap.user_id = dr.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours') OVERLAPS (sn.time, sn.time + INTERVAL '1.5 hours')
          )
    ),
    best_waves AS (
        SELECT spar_id, MIN(wave) as min_wave
        FROM potential_matches
        WHERE wave IS NOT NULL
        GROUP BY spar_id
    ),
    to_invite AS (
        SELECT pm.spar_id, pm.user_id
        FROM potential_matches pm
        JOIN best_waves bw ON pm.spar_id = bw.spar_id AND pm.wave = bw.min_wave
    ),
    invitations AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT spar_id, user_id, 'debater', 'invited'
        FROM to_invite
        ON CONFLICT DO NOTHING
        RETURNING spar_id
    )
    -- If no matches found in any wave for a spar, increase its priority
    UPDATE spars
    SET debater_finding_priority = debater_finding_priority + 1
    WHERE status = 'matching'
      AND id IN (SELECT spar_id FROM spar_needs)
      AND id NOT IN (SELECT spar_id FROM best_waves)
      AND (
          SELECT COUNT(*)
          FROM spar_members sm
          WHERE sm.spar_id = spars.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')
      ) < (
          CASE
              WHEN rule = 'wsdc' THEN 6
              WHEN rule = 'bp' THEN 8
              ELSE 0
          END
      );
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger Function
CREATE OR REPLACE FUNCTION trigger_run_debater_matching()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM run_debater_matching();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Create Trigger
DROP TRIGGER IF EXISTS trigger_debater_matching_on_availability ON user_availabilities;
CREATE TRIGGER trigger_debater_matching_on_availability
AFTER INSERT OR UPDATE OR DELETE ON user_availabilities
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_run_debater_matching();
