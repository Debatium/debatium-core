-- Availability-driven invitation matching
-- This migration introduces two orchestrators:
-- 1) match_for_new_spar: callable orchestrator for spar creation + status transition to matching
-- 2) match_for_availability_update: runs when an availability row is inserted/updated
--
-- Prioritization rules:
-- - New spar: oldest availability first, then level-fit
-- - Updated availability: nearest-to-full spars first, then level-fit

-- Track availability age for deterministic prioritization
ALTER TABLE user_availabilities
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE user_availabilities
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_availabilities_roles_gin
ON user_availabilities USING GIN (roles);

CREATE INDEX IF NOT EXISTS idx_user_availabilities_match_window
ON user_availabilities (format, start_time, end_time, updated_at);

-- Keep updated_at fresh whenever availability is edited
CREATE OR REPLACE FUNCTION set_user_availability_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_user_availability_updated_at ON user_availabilities;
CREATE TRIGGER trigger_set_user_availability_updated_at
BEFORE UPDATE ON user_availabilities
FOR EACH ROW
EXECUTE FUNCTION set_user_availability_updated_at();

-- Match candidates for a specific spar
CREATE OR REPLACE FUNCTION match_for_new_spar(p_spar_id UUID)
RETURNS VOID AS $$
DECLARE
    v_spar RECORD;
    v_host_user_id UUID;
BEGIN
    SELECT * INTO v_spar
    FROM spars
    WHERE id = p_spar_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Only auto-match while spar is open for member accumulation.
    IF v_spar.status NOT IN ('created', 'matching') THEN
        RETURN;
    END IF;

    -- Host exclusion for this workflow.
    SELECT sm.user_id INTO v_host_user_id
    FROM spar_members sm
    WHERE sm.spar_id = v_spar.id AND sm.is_host = TRUE
    ORDER BY sm.created_at ASC
    LIMIT 1;

    -- Debater invitations for this spar
    WITH spar_slots AS (
        SELECT GREATEST(
            (CASE
                WHEN v_spar.rule = 'wsdc' THEN 6
                WHEN v_spar.rule = 'bp' THEN 8
                ELSE 0
            END)
            - COALESCE((
                SELECT COUNT(*)
                FROM spar_members sm
                WHERE sm.spar_id = v_spar.id
                  AND sm.role = 'debater'
                  AND sm.status IN ('accepted', 'invited')
            ), 0),
            0
        ) AS slots_left
    ),
    candidate_users AS (
        SELECT
            ua.user_id,
            COALESCE(ua.updated_at, ua.created_at, NOW()) AS availability_updated_at,
            CASE
                WHEN v_spar.expected_debater_level IS NULL THEN 1
                WHEN u.debater_level = v_spar.expected_debater_level THEN 1
                WHEN get_debater_level_rank(v_spar.expected_debater_level) > 1
                     AND get_debater_level_rank(u.debater_level) = get_debater_level_rank(v_spar.expected_debater_level) - 1 THEN 2
                WHEN get_debater_level_rank(u.debater_level) > get_debater_level_rank(v_spar.expected_debater_level) THEN 3
                ELSE 4
            END AS level_priority
        FROM user_availabilities ua
        JOIN users u ON u.id = ua.user_id
        WHERE ua.roles ? 'debater'
          AND ua.format = v_spar.rule
          AND ua.start_time <= v_spar.time
          AND ua.end_time >= v_spar.time
          AND (v_host_user_id IS NULL OR ua.user_id <> v_host_user_id)
          AND NOT EXISTS (
              SELECT 1
              FROM spar_members sm
              WHERE sm.spar_id = v_spar.id
                AND sm.user_id = ua.user_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM spar_members sm_overlap
              JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
              WHERE sm_overlap.user_id = ua.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours')
                    OVERLAPS (v_spar.time, v_spar.time + INTERVAL '1.5 hours')
          )
    ),
    ranked_candidates AS (
        SELECT cu.user_id
        FROM candidate_users cu, spar_slots ss
        WHERE ss.slots_left > 0
        ORDER BY cu.availability_updated_at ASC, cu.level_priority ASC, cu.user_id
        LIMIT (SELECT slots_left FROM spar_slots)
    ),
    inserted_debater_invites AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT v_spar.id, rc.user_id, 'debater', 'invited'
        FROM ranked_candidates rc
        ON CONFLICT DO NOTHING
        RETURNING spar_id, user_id, role
    )
    INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
    SELECT
        i.user_id,
        'INVITE_RECEIVED',
        'in-app',
        i.spar_id,
        'spar_room',
        jsonb_build_object(
            'spar_room_id', i.spar_id,
            'context', 'You have been auto-invited to "' || s.name || '" based on your availability.',
            'cta', 'View invitation',
            'role', i.role,
            'source', 'auto_matching'
        ),
        'sent'
    FROM inserted_debater_invites i
    JOIN spars s ON s.id = i.spar_id;

    -- Judge invitation for this spar (at most one active invited/accepted judge)
    WITH judge_slots AS (
        SELECT CASE
            WHEN v_spar.expecting_judge = TRUE
                 AND NOT EXISTS (
                     SELECT 1
                     FROM spar_members sm
                     WHERE sm.spar_id = v_spar.id
                       AND sm.role = 'judge'
                       AND sm.status IN ('accepted', 'invited')
                 ) THEN 1
            ELSE 0
        END AS slots_left
    ),
    candidate_users AS (
        SELECT
            ua.user_id,
            COALESCE(ua.updated_at, ua.created_at, NOW()) AS availability_updated_at,
            CASE
                WHEN v_spar.expected_judge_level IS NULL THEN 1
                WHEN u.judge_level = v_spar.expected_judge_level THEN 1
                WHEN get_judge_level_rank(v_spar.expected_judge_level) > 1
                     AND get_judge_level_rank(u.judge_level) = get_judge_level_rank(v_spar.expected_judge_level) - 1 THEN 2
                WHEN get_judge_level_rank(u.judge_level) > get_judge_level_rank(v_spar.expected_judge_level) THEN 3
                ELSE 4
            END AS level_priority
        FROM user_availabilities ua
        JOIN users u ON u.id = ua.user_id
        WHERE ua.roles ? 'judge'
          AND ua.format = v_spar.rule
          AND ua.start_time <= v_spar.time
          AND ua.end_time >= v_spar.time
          AND (v_host_user_id IS NULL OR ua.user_id <> v_host_user_id)
          AND NOT EXISTS (
              SELECT 1
              FROM spar_members sm
              WHERE sm.spar_id = v_spar.id
                AND sm.user_id = ua.user_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM spar_members sm_overlap
              JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
              WHERE sm_overlap.user_id = ua.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours')
                    OVERLAPS (v_spar.time, v_spar.time + INTERVAL '1.5 hours')
          )
    ),
    ranked_candidates AS (
        SELECT cu.user_id
        FROM candidate_users cu, judge_slots js
        WHERE js.slots_left > 0
        ORDER BY cu.availability_updated_at ASC, cu.level_priority ASC, cu.user_id
        LIMIT (SELECT slots_left FROM judge_slots)
    ),
    inserted_judge_invites AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT v_spar.id, rc.user_id, 'judge', 'invited'
        FROM ranked_candidates rc
        ON CONFLICT DO NOTHING
        RETURNING spar_id, user_id, role
    )
    INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
    SELECT
        i.user_id,
        'INVITE_RECEIVED',
        'in-app',
        i.spar_id,
        'spar_room',
        jsonb_build_object(
            'spar_room_id', i.spar_id,
            'context', 'You have been auto-invited to judge "' || s.name || '" based on your availability.',
            'cta', 'View invitation',
            'role', i.role,
            'source', 'auto_matching'
        ),
        'sent'
    FROM inserted_judge_invites i
    JOIN spars s ON s.id = i.spar_id;
END;
$$ LANGUAGE plpgsql;

-- Match spars for a specific availability update
CREATE OR REPLACE FUNCTION match_for_availability_update(p_availability_id UUID)
RETURNS VOID AS $$
DECLARE
    v_availability RECORD;
BEGIN
    SELECT
        ua.id,
        ua.user_id,
        ua.start_time,
        ua.end_time,
        ua.format,
        ua.roles,
        ua.expected_judge_level,
        ua.expected_debater_level,
        ua.created_at,
        ua.updated_at,
        u.judge_level AS user_judge_level,
        u.debater_level AS user_debater_level
    INTO v_availability
    FROM user_availabilities ua
    JOIN users u ON u.id = ua.user_id
    WHERE ua.id = p_availability_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Debater role: prioritize nearly-full spars first, then level-fit
    IF v_availability.roles ? 'debater' THEN
        WITH candidate_spars AS (
            SELECT
                s.id AS spar_id,
                s.name,
                s.expected_debater_level,
                GREATEST(
                    (CASE
                        WHEN s.rule = 'wsdc' THEN 6
                        WHEN s.rule = 'bp' THEN 8
                        ELSE 0
                    END)
                    - COALESCE((
                        SELECT COUNT(*)
                        FROM spar_members sm
                        WHERE sm.spar_id = s.id
                          AND sm.role = 'debater'
                          AND sm.status IN ('accepted', 'invited')
                    ), 0),
                    0
                ) AS debater_slots_left,
                CASE
                    WHEN s.expecting_judge = TRUE
                         AND NOT EXISTS (
                             SELECT 1
                             FROM spar_members smj
                             WHERE smj.spar_id = s.id
                               AND smj.role = 'judge'
                               AND smj.status IN ('accepted', 'invited')
                         ) THEN 1
                    ELSE 0
                END AS judge_slots_left,
                CASE
                    WHEN s.expected_debater_level IS NULL THEN 1
                    WHEN v_availability.user_debater_level = s.expected_debater_level THEN 1
                    WHEN get_debater_level_rank(s.expected_debater_level) > 1
                         AND get_debater_level_rank(v_availability.user_debater_level) = get_debater_level_rank(s.expected_debater_level) - 1 THEN 2
                    WHEN get_debater_level_rank(v_availability.user_debater_level) > get_debater_level_rank(s.expected_debater_level) THEN 3
                    ELSE 4
                END AS level_priority
            FROM spars s
            WHERE s.status IN ('created', 'matching')
              AND s.rule = v_availability.format
              AND s.time >= v_availability.start_time
              AND s.time <= v_availability.end_time
              AND NOT EXISTS (
                  SELECT 1
                  FROM spar_members sm
                  WHERE sm.spar_id = s.id
                    AND sm.user_id = v_availability.user_id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM spar_members sm_overlap
                  JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
                  WHERE sm_overlap.user_id = v_availability.user_id
                    AND sm_overlap.status = 'accepted'
                    AND s_overlap.status NOT IN ('cancelled', 'done')
                    AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours')
                        OVERLAPS (s.time, s.time + INTERVAL '1.5 hours')
              )
        ),
        ranked_spar AS (
            SELECT cs.spar_id
            FROM candidate_spars cs
            WHERE cs.debater_slots_left > 0
            ORDER BY (cs.debater_slots_left + cs.judge_slots_left) ASC,
                     cs.level_priority ASC,
                     cs.spar_id
            LIMIT 1
        ),
        inserted_invite AS (
            INSERT INTO spar_members (spar_id, user_id, role, status)
            SELECT rs.spar_id, v_availability.user_id, 'debater', 'invited'
            FROM ranked_spar rs
            ON CONFLICT DO NOTHING
            RETURNING spar_id, user_id, role
        )
        INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
        SELECT
            i.user_id,
            'INVITE_RECEIVED',
            'in-app',
            i.spar_id,
            'spar_room',
            jsonb_build_object(
                'spar_room_id', i.spar_id,
                'context', 'A near-full spar matched your updated availability.',
                'cta', 'View invitation',
                'role', i.role,
                'source', 'auto_matching'
            ),
            'sent'
        FROM inserted_invite i;
    END IF;

    -- Judge role: prioritize nearly-full spars first, then level-fit
    IF v_availability.roles ? 'judge' THEN
        WITH candidate_spars AS (
            SELECT
                s.id AS spar_id,
                s.name,
                s.expected_judge_level,
                GREATEST(
                    (CASE
                        WHEN s.rule = 'wsdc' THEN 6
                        WHEN s.rule = 'bp' THEN 8
                        ELSE 0
                    END)
                    - COALESCE((
                        SELECT COUNT(*)
                        FROM spar_members sm
                        WHERE sm.spar_id = s.id
                          AND sm.role = 'debater'
                          AND sm.status IN ('accepted', 'invited')
                    ), 0),
                    0
                ) AS debater_slots_left,
                1 AS judge_slots_left,
                CASE
                    WHEN s.expected_judge_level IS NULL THEN 1
                    WHEN v_availability.user_judge_level = s.expected_judge_level THEN 1
                    WHEN get_judge_level_rank(s.expected_judge_level) > 1
                         AND get_judge_level_rank(v_availability.user_judge_level) = get_judge_level_rank(s.expected_judge_level) - 1 THEN 2
                    WHEN get_judge_level_rank(v_availability.user_judge_level) > get_judge_level_rank(s.expected_judge_level) THEN 3
                    ELSE 4
                END AS level_priority
            FROM spars s
            WHERE s.status IN ('created', 'matching')
              AND s.expecting_judge = TRUE
              AND s.rule = v_availability.format
              AND s.time >= v_availability.start_time
              AND s.time <= v_availability.end_time
              AND NOT EXISTS (
                  SELECT 1
                  FROM spar_members sm
                  WHERE sm.spar_id = s.id
                    AND sm.user_id = v_availability.user_id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM spar_members smj
                  WHERE smj.spar_id = s.id
                    AND smj.role = 'judge'
                    AND smj.status IN ('accepted', 'invited')
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM spar_members sm_overlap
                  JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
                  WHERE sm_overlap.user_id = v_availability.user_id
                    AND sm_overlap.status = 'accepted'
                    AND s_overlap.status NOT IN ('cancelled', 'done')
                    AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours')
                        OVERLAPS (s.time, s.time + INTERVAL '1.5 hours')
              )
        ),
        ranked_spar AS (
            SELECT cs.spar_id
            FROM candidate_spars cs
            ORDER BY (cs.debater_slots_left + cs.judge_slots_left) ASC,
                     cs.level_priority ASC,
                     cs.spar_id
            LIMIT 1
        ),
        inserted_invite AS (
            INSERT INTO spar_members (spar_id, user_id, role, status)
            SELECT rs.spar_id, v_availability.user_id, 'judge', 'invited'
            FROM ranked_spar rs
            ON CONFLICT DO NOTHING
            RETURNING spar_id, user_id, role
        )
        INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
        SELECT
            i.user_id,
            'INVITE_RECEIVED',
            'in-app',
            i.spar_id,
            'spar_room',
            jsonb_build_object(
                'spar_room_id', i.spar_id,
                'context', 'A near-full spar matched your updated availability as judge.',
                'cta', 'View invitation',
                'role', i.role,
                'source', 'auto_matching'
            ),
            'sent'
        FROM inserted_invite i;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger wrappers
CREATE OR REPLACE FUNCTION trigger_run_match_for_availability_update()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM match_for_availability_update(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace old availability-matching triggers to avoid duplicate invite paths
DROP TRIGGER IF EXISTS trigger_judge_matching_on_availability ON user_availabilities;
DROP TRIGGER IF EXISTS trigger_debater_matching_on_availability ON user_availabilities;
DROP TRIGGER IF EXISTS trg_user_availability_auto_match ON user_availabilities;

CREATE TRIGGER trg_user_availability_auto_match
AFTER INSERT OR UPDATE ON user_availabilities
FOR EACH ROW
EXECUTE FUNCTION trigger_run_match_for_availability_update();
