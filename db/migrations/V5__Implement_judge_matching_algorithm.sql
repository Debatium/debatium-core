CREATE OR REPLACE FUNCTION get_judge_level_rank(p_level judge_level_enum)
RETURNS INT AS $$
BEGIN
    RETURN COALESCE(array_position(enum_range(NULL::judge_level_enum), p_level), 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Main Matching Logic Function
CREATE OR REPLACE FUNCTION run_judge_matching()
RETURNS VOID AS $$
BEGIN
    -- Concurrency guard: prevent parallel triggers from stepping on each other
    IF NOT pg_try_advisory_xact_lock(112233) THEN
        RETURN;
    END IF;

    WITH
    judge_ranks AS (
        SELECT
            u.id as user_id,
            u.judge_level,
            get_judge_level_rank(u.judge_level) as rank
        FROM users u
    ),
    potential_matches AS (
        SELECT
            s.id as spar_id,
            jr.user_id,
            CASE
                -- Wave 1: Format Match + Level Exact
                WHEN ua.format = s.rule AND jr.judge_level = s.expected_judge_level THEN 1
                -- Wave 2: Format Match + Level -1
                WHEN ua.format = s.rule AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 2
                -- Wave 3: Format Match + Level Above
                WHEN ua.format = s.rule AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 3
                -- Wave 4: Format Mismatch + Level Exact (Min Priority 1)
                WHEN s.judge_finding_priority >= 1 AND jr.judge_level = s.expected_judge_level THEN 4
                -- Wave 5: Format Mismatch + Level -1 (Min Priority 1)
                WHEN s.judge_finding_priority >= 1 AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 5
                -- Wave 6: Format Mismatch + Level Above (Min Priority 1)
                WHEN s.judge_finding_priority >= 1 AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 6
                ELSE NULL
            END as wave
        FROM spars s
        CROSS JOIN judge_ranks jr
        JOIN user_availabilities ua ON ua.user_id = jr.user_id
        WHERE s.status = 'matching'
          AND s.expecting_judge = TRUE
          -- Availability check
          AND ua.start_time <= s.time AND ua.end_time >= s.time
          AND ua.roles ? 'judge'
          -- Don't invite if already a member
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm
              WHERE sm.spar_id = s.id AND sm.user_id = jr.user_id
          )
          -- Don't invite if they have an overlapping accepted spar
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON sm_overlap.spar_id = s_overlap.id
              WHERE sm_overlap.user_id = jr.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours') OVERLAPS (s.time, s.time + INTERVAL '1.5 hours')
          )
          -- Spar doesn't have an accepted judge
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_acc
              WHERE sm_acc.spar_id = s.id AND sm_acc.role = 'judge' AND sm_acc.status = 'invited'
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
        SELECT spar_id, user_id, 'judge', 'invited'
        FROM to_invite
        ON CONFLICT DO NOTHING
        RETURNING spar_id
    )
    -- If no matches found in any wave for a spar, increase its priority
    UPDATE spars
    SET judge_finding_priority = judge_finding_priority + 1
    WHERE status = 'matching'
      AND expecting_judge = TRUE
      AND id NOT IN (SELECT spar_id FROM best_waves)
      AND NOT EXISTS (
          SELECT 1 FROM spar_members sm_acc
          WHERE sm_acc.spar_id = spars.id AND sm_acc.role = 'judge' AND sm_acc.status = 'invited'
      );
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger Function
CREATE OR REPLACE FUNCTION trigger_run_judge_matching()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM run_judge_matching();
    RETURN NULL; -- For STATEMENT trigger, return value is ignored but NULL is standard
END;
$$ LANGUAGE plpgsql;

-- 4. Create Trigger
DROP TRIGGER IF EXISTS trigger_judge_matching_on_availability ON user_availabilities;
CREATE TRIGGER trigger_judge_matching_on_availability
AFTER INSERT OR UPDATE OR DELETE ON user_availabilities
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_run_judge_matching();
