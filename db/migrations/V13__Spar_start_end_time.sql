-- V13: Replace `spars.time` with `start_time` + `end_time`. Rewrites V4 triggers
-- and the V12 matching SPs to use the new range. Matching rule becomes "full
-- containment": a user's availability slot must cover [start_time, end_time].

BEGIN;

SET timezone = 'Asia/Bangkok';

-- ── Phase 1: add columns + backfill ──
ALTER TABLE spars ADD COLUMN start_time TIMESTAMPTZ;
ALTER TABLE spars ADD COLUMN end_time   TIMESTAMPTZ;

UPDATE spars SET
  start_time = "time",
  end_time   = "time" + INTERVAL '90 minutes';

ALTER TABLE spars
  ALTER COLUMN start_time SET NOT NULL,
  ALTER COLUMN end_time   SET NOT NULL,
  ADD CONSTRAINT spars_time_order CHECK (start_time < end_time);

-- ── Phase 2: drop legacy column + index ──
DROP INDEX IF EXISTS idx_spars_time;
ALTER TABLE spars DROP COLUMN "time";
CREATE INDEX idx_spars_start_time ON spars (start_time);
CREATE INDEX idx_spars_end_time   ON spars (end_time);

-- ── Phase 3: rewrite V4 procs that referenced spar.time ──

-- Lead-time check (BEFORE INSERT on spars): start_time must be ≥1h from now.
CREATE OR REPLACE FUNCTION check_spar_lead_time()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.start_time < NOW() + INTERVAL '1 hour' THEN
        RAISE EXCEPTION 'Spar start time must be at least 1 hour from now' USING ERRCODE = 'SP001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Member overlap check: two accepted spars for the same user cannot overlap.
CREATE OR REPLACE FUNCTION check_spar_overlap()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM spar_members sm
        JOIN spars s     ON sm.spar_id = s.id
        JOIN spars s_new ON s_new.id   = NEW.spar_id
        WHERE sm.user_id = NEW.user_id
          AND sm.status = 'accepted'
          AND sm.spar_id <> NEW.spar_id
          AND s.status     NOT IN ('cancelled', 'done')
          AND s_new.status NOT IN ('cancelled', 'done')
          AND (s.start_time, s.end_time) OVERLAPS (s_new.start_time, s_new.end_time)
    ) THEN
        RAISE EXCEPTION 'User has another overlapping spar at this time' USING ERRCODE = 'SP001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop any stale overloads so the 2-arg TIMESTAMPTZ version is the only match.
DROP FUNCTION IF EXISTS evaluate_spar_readiness(UUID);
DROP FUNCTION IF EXISTS evaluate_spar_readiness(UUID, TIMESTAMP WITHOUT TIME ZONE);

-- Readiness evaluation: uses start_time for "lead window" and end_time for "expired".
CREATE OR REPLACE FUNCTION evaluate_spar_readiness(p_spar_id UUID, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
    v_spar RECORD;
    v_debater_count INT;
    v_judge_count INT;
    v_is_ready BOOLEAN := FALSE;
    v_diff_start_seconds DOUBLE PRECISION;
    v_is_expired BOOLEAN;
    v_main_link VARCHAR(200);
    v_prep_teams TEXT[];
    v_team TEXT;
BEGIN
    SELECT * INTO v_spar FROM spars WHERE id = p_spar_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Spar not found.'::TEXT;
        RETURN;
    END IF;

    IF v_spar.status IN ('debating', 'done', 'cancelled') THEN
        RETURN QUERY SELECT TRUE, ('Spar is in ' || v_spar.status || ' status.')::TEXT;
        RETURN;
    END IF;

    DELETE FROM spar_members
    WHERE spar_id = p_spar_id
      AND status IN ('pending', 'invited')
      AND created_at < p_now - INTERVAL '24 hours';

    SELECT COUNT(*) INTO v_debater_count FROM spar_members WHERE spar_id = p_spar_id AND role = 'debater' AND status = 'accepted';
    SELECT COUNT(*) INTO v_judge_count   FROM spar_members WHERE spar_id = p_spar_id AND role = 'judge'   AND status = 'accepted';

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

    v_diff_start_seconds := EXTRACT(EPOCH FROM (v_spar.start_time - p_now));
    v_is_expired := (p_now > v_spar.end_time);

    IF v_is_ready THEN
        IF v_spar.status != 'ready' THEN
            -- Allocation window: within 15m of start AND not yet expired.
            IF v_diff_start_seconds <= 900 AND NOT v_is_expired THEN
                IF v_spar.meet_link IS NULL THEN
                    v_main_link := assign_meet_link(p_spar_id);
                ELSE
                    v_main_link := v_spar.meet_link;
                END IF;

                IF v_main_link IS NULL THEN
                    IF v_diff_start_seconds <= 0 THEN
                        PERFORM release_spar_links(p_spar_id);
                        UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                        RETURN QUERY SELECT FALSE, 'No available Meet links at start time. Spar cancelled.'::TEXT;
                    ELSE
                        RETURN QUERY SELECT FALSE, 'No available Meet links yet.'::TEXT;
                    END IF;
                    RETURN;
                END IF;

                FOREACH v_team IN ARRAY v_prep_teams LOOP
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
            ELSIF v_is_expired THEN
                PERFORM release_spar_links(p_spar_id);
                UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                RETURN QUERY SELECT FALSE, 'Spar has already expired and was never ready.'::TEXT;
            ELSE
                RETURN QUERY SELECT TRUE, 'Spar is matched and ready, links will be allocated 15 minutes before start.'::TEXT;
            END IF;
        ELSE
            IF v_is_expired THEN
                PERFORM release_spar_links(p_spar_id);
                UPDATE spars SET status = 'done' WHERE id = p_spar_id;
                RETURN QUERY SELECT TRUE, 'Spar completed and links released.'::TEXT;
            ELSE
                RETURN QUERY SELECT TRUE, 'Spar is already ready.'::TEXT;
            END IF;
        END IF;
    ELSE
        IF v_spar.status = 'ready' THEN
            PERFORM release_spar_links(p_spar_id);
            UPDATE spars SET status = 'created' WHERE id = p_spar_id;

            IF v_diff_start_seconds <= 900 THEN
                PERFORM release_spar_links(p_spar_id);
                UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
                RETURN QUERY SELECT FALSE, 'Spar no longer ready and within lead window. Cancelled.'::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE, 'Spar moved back to created as it no longer meets requirements.'::TEXT;
            END IF;
        ELSIF v_diff_start_seconds <= 900 THEN
            PERFORM release_spar_links(p_spar_id);
            UPDATE spars SET status = 'cancelled' WHERE id = p_spar_id;
            RETURN QUERY SELECT FALSE, 'Spar not ready 15 minutes before start. Cancelled.'::TEXT;
        ELSE
            RETURN QUERY SELECT FALSE, 'Spar is not ready.'::TEXT;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Phase 4: rewrite V12/V9_2 matching SPs with full-containment rule ──

-- run_judge_matching: availability slot must cover [start_time, end_time].
CREATE OR REPLACE FUNCTION run_judge_matching()
RETURNS VOID AS $$
BEGIN
    IF NOT pg_try_advisory_xact_lock(112233) THEN
        RETURN;
    END IF;

    WITH
    judge_ranks AS (
        SELECT u.id AS user_id, u.judge_level, get_judge_level_rank(u.judge_level) AS rank FROM users u
    ),
    potential_matches AS (
        SELECT s.id AS spar_id, jr.user_id,
            CASE
                WHEN ua.format = s.rule AND jr.judge_level = s.expected_judge_level THEN 1
                WHEN ua.format = s.rule AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 2
                WHEN ua.format = s.rule AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 3
                WHEN s.judge_finding_priority >= 1 AND jr.judge_level = s.expected_judge_level THEN 4
                WHEN s.judge_finding_priority >= 1 AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 5
                WHEN s.judge_finding_priority >= 1 AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 6
                ELSE NULL
            END AS wave
        FROM spars s
        CROSS JOIN judge_ranks jr
        JOIN user_availabilities ua ON ua.user_id = jr.user_id
        WHERE s.status = 'matching'
          AND s.expecting_judge = TRUE
          AND ua.min_slot_start <= s.start_time
          AND ua.max_slot_end   >= s.end_time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= s.start_time
                AND (sl->>'e')::timestamptz >= s.end_time
          )
          AND ua.roles ? 'judge'
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm WHERE sm.spar_id = s.id AND sm.user_id = jr.user_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON sm_overlap.spar_id = s_overlap.id
              WHERE sm_overlap.user_id = jr.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (s.start_time, s.end_time)
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_acc
              WHERE sm_acc.spar_id = s.id AND sm_acc.role = 'judge' AND sm_acc.status = 'invited'
          )
    ),
    best_waves AS (
        SELECT spar_id, MIN(wave) AS min_wave FROM potential_matches WHERE wave IS NOT NULL GROUP BY spar_id
    ),
    to_invite AS (
        SELECT pm.spar_id, pm.user_id FROM potential_matches pm
        JOIN best_waves bw ON pm.spar_id = bw.spar_id AND pm.wave = bw.min_wave
    ),
    invitations AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT spar_id, user_id, 'judge', 'invited' FROM to_invite
        ON CONFLICT DO NOTHING RETURNING spar_id
    )
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

-- run_debater_matching: same containment rule.
CREATE OR REPLACE FUNCTION run_debater_matching()
RETURNS VOID AS $$
BEGIN
    IF NOT pg_try_advisory_xact_lock(112234) THEN
        RETURN;
    END IF;

    WITH
    debater_ranks AS (
        SELECT u.id AS user_id, u.debater_level, get_debater_level_rank(u.debater_level) AS rank FROM users u
    ),
    spar_needs AS (
        SELECT s.id AS spar_id, s.rule, s.start_time, s.end_time, s.expected_debater_level, s.debater_finding_priority,
            CASE WHEN s.rule = 'wsdc' THEN 6 WHEN s.rule = 'bp' THEN 8 ELSE 0 END AS required_count,
            (SELECT COUNT(*) FROM spar_members sm WHERE sm.spar_id = s.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')) AS current_count
        FROM spars s
        WHERE s.status = 'matching'
    ),
    potential_matches AS (
        SELECT sn.spar_id, dr.user_id,
            CASE
                WHEN ua.format = sn.rule AND dr.debater_level = sn.expected_debater_level THEN 1
                WHEN ua.format = sn.rule AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 2
                WHEN ua.format = sn.rule AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 3
                WHEN sn.debater_finding_priority >= 1 AND dr.debater_level = sn.expected_debater_level THEN 4
                WHEN sn.debater_finding_priority >= 1 AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 5
                WHEN sn.debater_finding_priority >= 1 AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 6
                ELSE NULL
            END AS wave
        FROM spar_needs sn
        CROSS JOIN debater_ranks dr
        JOIN user_availabilities ua ON ua.user_id = dr.user_id
        WHERE sn.current_count < sn.required_count
          AND ua.min_slot_start <= sn.start_time
          AND ua.max_slot_end   >= sn.end_time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= sn.start_time
                AND (sl->>'e')::timestamptz >= sn.end_time
          )
          AND ua.roles ? 'debater'
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm WHERE sm.spar_id = sn.spar_id AND sm.user_id = dr.user_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON sm_overlap.spar_id = s_overlap.id
              WHERE sm_overlap.user_id = dr.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (sn.start_time, sn.end_time)
          )
    ),
    best_waves AS (
        SELECT spar_id, MIN(wave) AS min_wave FROM potential_matches WHERE wave IS NOT NULL GROUP BY spar_id
    ),
    to_invite AS (
        SELECT pm.spar_id, pm.user_id FROM potential_matches pm
        JOIN best_waves bw ON pm.spar_id = bw.spar_id AND pm.wave = bw.min_wave
    ),
    invitations AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT spar_id, user_id, 'debater', 'invited' FROM to_invite
        ON CONFLICT DO NOTHING RETURNING spar_id
    )
    UPDATE spars
    SET debater_finding_priority = debater_finding_priority + 1
    WHERE status = 'matching'
      AND id IN (SELECT spar_id FROM spar_needs)
      AND id NOT IN (SELECT spar_id FROM best_waves)
      AND (
          SELECT COUNT(*) FROM spar_members sm
          WHERE sm.spar_id = spars.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')
      ) < (CASE WHEN rule = 'wsdc' THEN 6 WHEN rule = 'bp' THEN 8 ELSE 0 END);
END;
$$ LANGUAGE plpgsql;

-- match_for_new_spar: availability slot must cover the spar's whole window.
CREATE OR REPLACE FUNCTION match_for_new_spar(p_spar_id UUID)
RETURNS VOID AS $$
DECLARE
    v_spar RECORD;
    v_host_user_id UUID;
BEGIN
    SELECT * INTO v_spar FROM spars WHERE id = p_spar_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF v_spar.status NOT IN ('created', 'matching') THEN RETURN; END IF;

    SELECT sm.user_id INTO v_host_user_id
    FROM spar_members sm
    WHERE sm.spar_id = v_spar.id AND sm.is_host = TRUE
    ORDER BY sm.created_at ASC LIMIT 1;

    WITH spar_slots AS (
        SELECT GREATEST(
            (CASE WHEN v_spar.rule = 'wsdc' THEN 6 WHEN v_spar.rule = 'bp' THEN 8 ELSE 0 END)
            - COALESCE((
                SELECT COUNT(*) FROM spar_members sm
                WHERE sm.spar_id = v_spar.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')
            ), 0),
            0
        ) AS slots_left
    ),
    candidate_users AS (
        SELECT ua.user_id,
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
          AND ua.min_slot_start <= v_spar.start_time
          AND ua.max_slot_end   >= v_spar.end_time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= v_spar.start_time
                AND (sl->>'e')::timestamptz >= v_spar.end_time
          )
          AND (v_host_user_id IS NULL OR ua.user_id <> v_host_user_id)
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm WHERE sm.spar_id = v_spar.id AND sm.user_id = ua.user_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
              WHERE sm_overlap.user_id = ua.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (v_spar.start_time, v_spar.end_time)
          )
    ),
    ranked_candidates AS (
        SELECT cu.user_id FROM candidate_users cu, spar_slots ss
        WHERE ss.slots_left > 0
        ORDER BY cu.availability_updated_at ASC, cu.level_priority ASC, cu.user_id
        LIMIT (SELECT slots_left FROM spar_slots)
    ),
    inserted_debater_invites AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT v_spar.id, rc.user_id, 'debater', 'invited' FROM ranked_candidates rc
        ON CONFLICT DO NOTHING RETURNING spar_id, user_id, role
    )
    INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
    SELECT i.user_id, 'INVITE_RECEIVED', 'in-app', i.spar_id, 'spar_room',
           jsonb_build_object('spar_room_id', i.spar_id,
                              'context', 'You have been auto-invited to "' || s.name || '" based on your availability.',
                              'cta', 'View invitation', 'role', i.role, 'source', 'auto_matching'),
           'sent'
    FROM inserted_debater_invites i JOIN spars s ON s.id = i.spar_id;

    WITH judge_slots AS (
        SELECT CASE
            WHEN v_spar.expecting_judge = TRUE AND NOT EXISTS (
                 SELECT 1 FROM spar_members sm
                 WHERE sm.spar_id = v_spar.id AND sm.role = 'judge' AND sm.status IN ('accepted', 'invited')
            ) THEN 1 ELSE 0 END AS slots_left
    ),
    candidate_users AS (
        SELECT ua.user_id,
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
          AND ua.min_slot_start <= v_spar.start_time
          AND ua.max_slot_end   >= v_spar.end_time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= v_spar.start_time
                AND (sl->>'e')::timestamptz >= v_spar.end_time
          )
          AND (v_host_user_id IS NULL OR ua.user_id <> v_host_user_id)
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm WHERE sm.spar_id = v_spar.id AND sm.user_id = ua.user_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
              WHERE sm_overlap.user_id = ua.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (v_spar.start_time, v_spar.end_time)
          )
    ),
    ranked_candidates AS (
        SELECT cu.user_id FROM candidate_users cu, judge_slots js
        WHERE js.slots_left > 0
        ORDER BY cu.availability_updated_at ASC, cu.level_priority ASC, cu.user_id
        LIMIT (SELECT slots_left FROM judge_slots)
    ),
    inserted_judge_invites AS (
        INSERT INTO spar_members (spar_id, user_id, role, status)
        SELECT v_spar.id, rc.user_id, 'judge', 'invited' FROM ranked_candidates rc
        ON CONFLICT DO NOTHING RETURNING spar_id, user_id, role
    )
    INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
    SELECT i.user_id, 'INVITE_RECEIVED', 'in-app', i.spar_id, 'spar_room',
           jsonb_build_object('spar_room_id', i.spar_id,
                              'context', 'You have been auto-invited to judge "' || s.name || '" based on your availability.',
                              'cta', 'View invitation', 'role', i.role, 'source', 'auto_matching'),
           'sent'
    FROM inserted_judge_invites i JOIN spars s ON s.id = i.spar_id;
END;
$$ LANGUAGE plpgsql;

-- match_for_availability_update: spar's whole window must sit inside some slot.
CREATE OR REPLACE FUNCTION match_for_availability_update(p_availability_id UUID)
RETURNS VOID AS $$
DECLARE
    v_availability RECORD;
BEGIN
    SELECT ua.id, ua.user_id, ua.slots, ua.min_slot_start, ua.max_slot_end,
           ua.format, ua.roles, ua.expected_judge_level, ua.expected_debater_level,
           ua.created_at, ua.updated_at,
           u.judge_level AS user_judge_level, u.debater_level AS user_debater_level
    INTO v_availability
    FROM user_availabilities ua JOIN users u ON u.id = ua.user_id
    WHERE ua.id = p_availability_id;

    IF NOT FOUND THEN RETURN; END IF;

    IF v_availability.roles ? 'debater' THEN
        WITH candidate_spars AS (
            SELECT s.id AS spar_id, s.name, s.expected_debater_level,
                   GREATEST(
                       (CASE WHEN s.rule = 'wsdc' THEN 6 WHEN s.rule = 'bp' THEN 8 ELSE 0 END)
                       - COALESCE((SELECT COUNT(*) FROM spar_members sm
                                   WHERE sm.spar_id = s.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')), 0),
                       0
                   ) AS debater_slots_left,
                   CASE WHEN s.expecting_judge = TRUE AND NOT EXISTS (
                       SELECT 1 FROM spar_members smj WHERE smj.spar_id = s.id AND smj.role = 'judge' AND smj.status IN ('accepted', 'invited')
                   ) THEN 1 ELSE 0 END AS judge_slots_left,
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
              AND s.start_time >= v_availability.min_slot_start
              AND s.end_time   <= v_availability.max_slot_end
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(v_availability.slots) sl
                  WHERE s.start_time >= (sl->>'s')::timestamptz
                    AND s.end_time   <= (sl->>'e')::timestamptz
              )
              AND NOT EXISTS (
                  SELECT 1 FROM spar_members sm WHERE sm.spar_id = s.id AND sm.user_id = v_availability.user_id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM spar_members sm_overlap
                  JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
                  WHERE sm_overlap.user_id = v_availability.user_id
                    AND sm_overlap.status = 'accepted'
                    AND s_overlap.status NOT IN ('cancelled', 'done')
                    AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (s.start_time, s.end_time)
              )
        ),
        ranked_spar AS (
            SELECT cs.spar_id FROM candidate_spars cs
            WHERE cs.debater_slots_left > 0
            ORDER BY (cs.debater_slots_left + cs.judge_slots_left) ASC, cs.level_priority ASC, cs.spar_id
            LIMIT 1
        ),
        inserted_invite AS (
            INSERT INTO spar_members (spar_id, user_id, role, status)
            SELECT rs.spar_id, v_availability.user_id, 'debater', 'invited' FROM ranked_spar rs
            ON CONFLICT DO NOTHING RETURNING spar_id, user_id, role
        )
        INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
        SELECT i.user_id, 'INVITE_RECEIVED', 'in-app', i.spar_id, 'spar_room',
               jsonb_build_object('spar_room_id', i.spar_id,
                                  'context', 'A near-full spar matched your updated availability.',
                                  'cta', 'View invitation', 'role', i.role, 'source', 'auto_matching'),
               'sent'
        FROM inserted_invite i;
    END IF;

    IF v_availability.roles ? 'judge' THEN
        WITH candidate_spars AS (
            SELECT s.id AS spar_id, s.name, s.expected_judge_level,
                   GREATEST(
                       (CASE WHEN s.rule = 'wsdc' THEN 6 WHEN s.rule = 'bp' THEN 8 ELSE 0 END)
                       - COALESCE((SELECT COUNT(*) FROM spar_members sm
                                   WHERE sm.spar_id = s.id AND sm.role = 'debater' AND sm.status IN ('accepted', 'invited')), 0),
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
              AND s.start_time >= v_availability.min_slot_start
              AND s.end_time   <= v_availability.max_slot_end
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(v_availability.slots) sl
                  WHERE s.start_time >= (sl->>'s')::timestamptz
                    AND s.end_time   <= (sl->>'e')::timestamptz
              )
              AND NOT EXISTS (
                  SELECT 1 FROM spar_members sm WHERE sm.spar_id = s.id AND sm.user_id = v_availability.user_id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM spar_members smj WHERE smj.spar_id = s.id AND smj.role = 'judge' AND smj.status IN ('accepted', 'invited')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM spar_members sm_overlap
                  JOIN spars s_overlap ON s_overlap.id = sm_overlap.spar_id
                  WHERE sm_overlap.user_id = v_availability.user_id
                    AND sm_overlap.status = 'accepted'
                    AND s_overlap.status NOT IN ('cancelled', 'done')
                    AND (s_overlap.start_time, s_overlap.end_time) OVERLAPS (s.start_time, s.end_time)
              )
        ),
        ranked_spar AS (
            SELECT cs.spar_id FROM candidate_spars cs
            ORDER BY (cs.debater_slots_left + cs.judge_slots_left) ASC, cs.level_priority ASC, cs.spar_id
            LIMIT 1
        ),
        inserted_invite AS (
            INSERT INTO spar_members (spar_id, user_id, role, status)
            SELECT rs.spar_id, v_availability.user_id, 'judge', 'invited' FROM ranked_spar rs
            ON CONFLICT DO NOTHING RETURNING spar_id, user_id, role
        )
        INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
        SELECT i.user_id, 'INVITE_RECEIVED', 'in-app', i.spar_id, 'spar_room',
               jsonb_build_object('spar_room_id', i.spar_id,
                                  'context', 'A near-full spar matched your updated availability as judge.',
                                  'cta', 'View invitation', 'role', i.role, 'source', 'auto_matching'),
               'sent'
        FROM inserted_invite i;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMIT;
