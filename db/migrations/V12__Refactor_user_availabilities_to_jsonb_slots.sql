-- V12: Replace start_time / end_time columns on user_availabilities with a JSONB
-- `slots` array of {s, e} objects. Rewrites V5, V6, and V9_2 stored procedures
-- against the new shape and replaces the GiST EXCLUDE overlap constraint with a
-- BEFORE trigger (per-user advisory lock for atomicity, 23P01 on conflict so
-- existing error handling keeps working).
--
-- migrate.ts runs files as a single client.query() with no implicit transaction,
-- so this file wraps itself in BEGIN / COMMIT to stay atomic.

BEGIN;

SET timezone = 'Asia/Bangkok';

-- ── Phase 1: add slots column + backfill ──
ALTER TABLE user_availabilities
  ADD COLUMN slots JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE user_availabilities
   SET slots = jsonb_build_array(
     jsonb_build_object('s', to_jsonb(start_time), 'e', to_jsonb(end_time))
   );

-- ── Phase 2: bounds cache columns (populated by trigger, not GENERATED) ──
ALTER TABLE user_availabilities
  ADD COLUMN min_slot_start TIMESTAMPTZ,
  ADD COLUMN max_slot_end   TIMESTAMPTZ;

-- ── Phase 3: overlap-check + bounds trigger ──
CREATE OR REPLACE FUNCTION user_availability_validate_and_bounds()
RETURNS TRIGGER AS $$
DECLARE
  v_min TIMESTAMPTZ;
  v_max TIMESTAMPTZ;
BEGIN
  -- Serialize writes per-user so the cross-row overlap check is atomic.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));

  IF jsonb_typeof(NEW.slots) <> 'array' OR jsonb_array_length(NEW.slots) = 0 THEN
    RAISE EXCEPTION 'slots must be a non-empty JSON array' USING ERRCODE = '23514';
  END IF;

  -- Per-slot shape: every element has s < e, both parseable as timestamptz.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.slots) sl
    WHERE (sl->>'s') IS NULL OR (sl->>'e') IS NULL
       OR (sl->>'s')::timestamptz >= (sl->>'e')::timestamptz
  ) THEN
    RAISE EXCEPTION 'each slot must have s < e' USING ERRCODE = '23514';
  END IF;

  -- Within-row overlap.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(NEW.slots) WITH ORDINALITY a(sl, ai),
           jsonb_array_elements(NEW.slots) WITH ORDINALITY b(sl, bi)
     WHERE a.ai < b.bi
       AND tstzrange((a.sl->>'s')::timestamptz, (a.sl->>'e')::timestamptz)
        && tstzrange((b.sl->>'s')::timestamptz, (b.sl->>'e')::timestamptz)
  ) THEN
    RAISE EXCEPTION 'availability slots overlap within the same row'
      USING ERRCODE = '23P01';
  END IF;

  -- Cross-row overlap (same user, other rows).
  IF EXISTS (
    SELECT 1
      FROM user_availabilities o,
           jsonb_array_elements(o.slots) os,
           jsonb_array_elements(NEW.slots) ns
     WHERE o.user_id = NEW.user_id
       AND o.id <> NEW.id
       AND tstzrange((os->>'s')::timestamptz, (os->>'e')::timestamptz)
        && tstzrange((ns->>'s')::timestamptz, (ns->>'e')::timestamptz)
  ) THEN
    RAISE EXCEPTION 'availability slots overlap an existing availability'
      USING ERRCODE = '23P01';
  END IF;

  -- Recompute cached bounds.
  SELECT MIN((sl->>'s')::timestamptz), MAX((sl->>'e')::timestamptz)
    INTO v_min, v_max
    FROM jsonb_array_elements(NEW.slots) sl;
  NEW.min_slot_start := v_min;
  NEW.max_slot_end   := v_max;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_availability_validate
BEFORE INSERT OR UPDATE OF slots ON user_availabilities
FOR EACH ROW EXECUTE FUNCTION user_availability_validate_and_bounds();

-- Populate bounds for any backfilled rows. Disable the AFTER auto-match trigger
-- during this bookkeeping UPDATE so the (still-old) matching SP doesn't fire
-- against columns it's about to lose.
ALTER TABLE user_availabilities DISABLE TRIGGER trg_user_availability_auto_match;
UPDATE user_availabilities SET slots = slots;
ALTER TABLE user_availabilities ENABLE TRIGGER trg_user_availability_auto_match;

-- Only now are the bounds columns guaranteed populated.
ALTER TABLE user_availabilities
  ALTER COLUMN min_slot_start SET NOT NULL,
  ALTER COLUMN max_slot_end   SET NOT NULL;

-- ── Phase 4: drop legacy schema ──
ALTER TABLE user_availabilities
  DROP CONSTRAINT no_overlapping_availabilities;
DROP INDEX IF EXISTS idx_user_availabilities_matching;
DROP INDEX IF EXISTS idx_user_availabilities_match_window;
ALTER TABLE user_availabilities
  DROP COLUMN start_time,
  DROP COLUMN end_time;

-- ── Phase 5: new indexes on bounds ──
CREATE INDEX idx_user_availabilities_match_window
  ON user_availabilities (format, min_slot_start, max_slot_end, updated_at);
-- Kept: idx_user_availabilities_user_id, idx_user_availabilities_roles_gin.

-- ── Phase 6: rewrite stored procedures against slots + bounds ──

-- V5: run_judge_matching — availability containment check becomes bounds pre-filter
-- + EXISTS over slots.
CREATE OR REPLACE FUNCTION run_judge_matching()
RETURNS VOID AS $$
BEGIN
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
                WHEN ua.format = s.rule AND jr.judge_level = s.expected_judge_level THEN 1
                WHEN ua.format = s.rule AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 2
                WHEN ua.format = s.rule AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 3
                WHEN s.judge_finding_priority >= 1 AND jr.judge_level = s.expected_judge_level THEN 4
                WHEN s.judge_finding_priority >= 1 AND get_judge_level_rank(s.expected_judge_level) > 1
                     AND jr.rank = get_judge_level_rank(s.expected_judge_level) - 1 THEN 5
                WHEN s.judge_finding_priority >= 1 AND jr.rank > get_judge_level_rank(s.expected_judge_level) THEN 6
                ELSE NULL
            END as wave
        FROM spars s
        CROSS JOIN judge_ranks jr
        JOIN user_availabilities ua ON ua.user_id = jr.user_id
        WHERE s.status = 'matching'
          AND s.expecting_judge = TRUE
          -- Availability check: bounds pre-filter, then EXISTS confirming a real slot covers s.time.
          AND ua.min_slot_start <= s.time
          AND ua.max_slot_end   >= s.time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= s.time
                AND (sl->>'e')::timestamptz >= s.time
          )
          AND ua.roles ? 'judge'
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm
              WHERE sm.spar_id = s.id AND sm.user_id = jr.user_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm_overlap
              JOIN spars s_overlap ON sm_overlap.spar_id = s_overlap.id
              WHERE sm_overlap.user_id = jr.user_id
                AND sm_overlap.status = 'accepted'
                AND s_overlap.status NOT IN ('cancelled', 'done')
                AND (s_overlap.time, s_overlap.time + INTERVAL '1.5 hours') OVERLAPS (s.time, s.time + INTERVAL '1.5 hours')
          )
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

-- V6: run_debater_matching — same substitution.
CREATE OR REPLACE FUNCTION run_debater_matching()
RETURNS VOID AS $$
BEGIN
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
                WHEN ua.format = sn.rule AND dr.debater_level = sn.expected_debater_level THEN 1
                WHEN ua.format = sn.rule AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 2
                WHEN ua.format = sn.rule AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 3
                WHEN sn.debater_finding_priority >= 1 AND dr.debater_level = sn.expected_debater_level THEN 4
                WHEN sn.debater_finding_priority >= 1 AND get_debater_level_rank(sn.expected_debater_level) > 1
                     AND dr.rank = get_debater_level_rank(sn.expected_debater_level) - 1 THEN 5
                WHEN sn.debater_finding_priority >= 1 AND dr.rank > get_debater_level_rank(sn.expected_debater_level) THEN 6
                ELSE NULL
            END as wave
        FROM spar_needs sn
        CROSS JOIN debater_ranks dr
        JOIN user_availabilities ua ON ua.user_id = dr.user_id
        WHERE sn.current_count < sn.required_count
          AND ua.min_slot_start <= sn.time
          AND ua.max_slot_end   >= sn.time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= sn.time
                AND (sl->>'e')::timestamptz >= sn.time
          )
          AND ua.roles ? 'debater'
          AND NOT EXISTS (
              SELECT 1 FROM spar_members sm
              WHERE sm.spar_id = sn.spar_id AND sm.user_id = dr.user_id
          )
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

-- V9_2: match_for_new_spar — same substitution applied to both the debater and
-- judge WHERE clauses.
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

    IF v_spar.status NOT IN ('created', 'matching') THEN
        RETURN;
    END IF;

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
          AND ua.min_slot_start <= v_spar.time
          AND ua.max_slot_end   >= v_spar.time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= v_spar.time
                AND (sl->>'e')::timestamptz >= v_spar.time
          )
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

    -- Judge invitation for this spar
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
          AND ua.min_slot_start <= v_spar.time
          AND ua.max_slot_end   >= v_spar.time
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ua.slots) sl
              WHERE (sl->>'s')::timestamptz <= v_spar.time
                AND (sl->>'e')::timestamptz >= v_spar.time
          )
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

-- V9_2: match_for_availability_update — flipped perspective. Pull slots into
-- v_availability, use the EXISTS lateral against that array.
CREATE OR REPLACE FUNCTION match_for_availability_update(p_availability_id UUID)
RETURNS VOID AS $$
DECLARE
    v_availability RECORD;
BEGIN
    SELECT
        ua.id,
        ua.user_id,
        ua.slots,
        ua.min_slot_start,
        ua.max_slot_end,
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

    -- Debater role
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
              AND s.time >= v_availability.min_slot_start
              AND s.time <= v_availability.max_slot_end
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(v_availability.slots) sl
                  WHERE s.time >= (sl->>'s')::timestamptz
                    AND s.time <= (sl->>'e')::timestamptz
              )
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

    -- Judge role
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
              AND s.time >= v_availability.min_slot_start
              AND s.time <= v_availability.max_slot_end
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(v_availability.slots) sl
                  WHERE s.time >= (sl->>'s')::timestamptz
                    AND s.time <= (sl->>'e')::timestamptz
              )
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

COMMIT;
