CREATE TYPE tournament_rule_enum AS ENUM ('bp', 'wsdc');
CREATE TYPE entry_role_enum AS ENUM ('debater', 'independentAdjudicator', 'subsidizedAdjudicator', 'invitedAdjudicator');
CREATE TYPE achievement_enum AS ENUM ('participant', 'octoFinalist', 'quarterFinalist', 'semiFinalist', 'finalist', 'champion', 'runnerUp');
CREATE TYPE judge_rank_enum AS ENUM ('trainee', 'panel', 'chair');

-- 1. Create the tournaments table
CREATE TABLE tournaments (
    id UUID PRIMARY KEY,
    name CHAR(200) NOT NULL,
    year INT NOT NULL,
    scale INT NOT NULL,
    rule tournament_rule_enum NOT NULL
);

-- 3. Create the judge_details table
CREATE TABLE judge_details (
    id UUID PRIMARY KEY,
    rounds INT NOT NULL CHECK (rounds >= 1 AND rounds <= 10),
    highest_rank judge_rank_enum NOT NULL
);

-- 4. Create the debater_details table
CREATE TABLE debater_details (
    id UUID PRIMARY KEY,
    breaking_rank INT CHECK (breaking_rank >= 1 AND breaking_rank <= 16),
    achievement achievement_enum
);

-- 5. Create the tournament_entries table
CREATE TABLE tournament_entries (
    id UUID PRIMARY KEY,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role entry_role_enum NOT NULL,
    judge_details_id UUID REFERENCES judge_details(id) ON DELETE CASCADE,
    debater_details_id UUID REFERENCES debater_details(id) ON DELETE CASCADE,
    UNIQUE (tournament_id, user_id),
    CONSTRAINT CHK_details_xor CHECK (
        (judge_details_id IS NOT NULL AND debater_details_id IS NULL) OR
        (judge_details_id IS NULL AND debater_details_id IS NOT NULL)
    )
);

-- 6. Create indexes for performance
CREATE INDEX idx_tournament_entries_user_id ON tournament_entries(user_id);
CREATE INDEX idx_tournament_entries_judge_details_id ON tournament_entries(judge_details_id);
CREATE INDEX idx_tournament_entries_debater_details_id ON tournament_entries(debater_details_id);

-- 7. Enforce maximum 20 entries per user
CREATE OR REPLACE FUNCTION check_tournament_entry_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM tournament_entries WHERE user_id = NEW.user_id) >= 20 THEN
        RAISE EXCEPTION 'Maximum 20 tournament entries allowed per user';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_tournament_limit
BEFORE INSERT ON tournament_entries
FOR EACH ROW
EXECUTE FUNCTION check_tournament_entry_limit();

-- 8. Debater Level Calculation Logic
CREATE OR REPLACE FUNCTION calculate_debater_score(target_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    total_score NUMERIC := 0;
    entry_record RECORD;
    ach_points INT;
    scale_multiplier NUMERIC;
    break_points INT;
    time_multiplier NUMERIC;
    tournament_score NUMERIC;
    current_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
BEGIN
    RAISE NOTICE 'Calculating score for user %', target_user_id;

    FOR entry_record IN
        SELECT
            t.year,
            t.scale,
            dd.achievement,
            dd.breaking_rank
        FROM tournament_entries te
        JOIN tournaments t ON te.tournament_id = t.id
        JOIN debater_details dd ON te.debater_details_id = dd.id
        WHERE te.user_id = target_user_id
    LOOP
        -- A_achievement Points
        ach_points := CASE entry_record.achievement
            WHEN 'participant' THEN 5
            WHEN 'octoFinalist' THEN 10
            WHEN 'quarterFinalist' THEN 15
            WHEN 'semiFinalist' THEN 20
            WHEN 'finalist' THEN 30
            WHEN 'runnerUp' THEN 30
            WHEN 'champion' THEN 40
            ELSE 5 -- Default for any other case where they participated but didn't break or no info
        END;

        -- M_scale Multiplier
        scale_multiplier := CASE
            WHEN entry_record.scale > 40 THEN 1.5
            WHEN entry_record.scale >= 20 THEN 1.2
            ELSE 1.0
        END;

        -- B_break Points
        break_points := CASE
            WHEN entry_record.breaking_rank = 1 THEN 15
            WHEN entry_record.breaking_rank <= 4 THEN 10
            WHEN entry_record.breaking_rank <= 8 THEN 5
            WHEN entry_record.breaking_rank <= 16 THEN 2
            ELSE 0
        END;

        -- D_time Multiplier
        time_multiplier := CASE
            WHEN entry_record.year >= current_year THEN 1.0
            WHEN entry_record.year = current_year - 1 THEN 0.9
            WHEN entry_record.year = current_year - 2 THEN 0.8
            ELSE 0.7
        END;

        tournament_score := ((ach_points * scale_multiplier) + break_points) * time_multiplier;
        total_score := total_score + tournament_score;

        RAISE NOTICE 'Tournament Year: %, Scale: %, Achievement: %, Rank: % -> Score: %',
            entry_record.year, entry_record.scale, entry_record.achievement, entry_record.breaking_rank, tournament_score;
    END LOOP;

    RAISE NOTICE 'Total Calculated Score: %', total_score;
    RETURN total_score;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_debater_level(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
    final_score NUMERIC;
    new_level debater_level_enum;
BEGIN
    final_score := calculate_debater_score(target_user_id);

    new_level := CASE
        WHEN final_score > 150 THEN 'pro'::debater_level_enum
        WHEN final_score >= 50 THEN 'open'::debater_level_enum
        ELSE 'novice'::debater_level_enum
    END;

    UPDATE users SET debater_level = new_level WHERE id = target_user_id;
    RAISE NOTICE 'Updated user % level to %', target_user_id, new_level;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_judge_score(target_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    total_score NUMERIC := 0;
    entry_record RECORD;
    role_points INT;
    scale_multiplier NUMERIC;
    perf_points INT;
    time_multiplier NUMERIC;
    tournament_score NUMERIC;
    current_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
BEGIN
    FOR entry_record IN
        SELECT
            t.year,
            t.scale,
            te.role,
            jd.rounds,
            jd.highest_rank
        FROM tournament_entries te
        JOIN tournaments t ON te.tournament_id = t.id
        JOIN judge_details jd ON te.judge_details_id = jd.id
        WHERE te.user_id = target_user_id
    LOOP
        -- P_role Points
        role_points := CASE entry_record.role
            WHEN 'independentAdjudicator' THEN 10
            WHEN 'subsidizedAdjudicator' THEN 20
            WHEN 'invitedAdjudicator' THEN 30
            ELSE 0
        END;

        -- M_scale Multiplier
        scale_multiplier := CASE
            WHEN entry_record.scale > 40 THEN 1.5
            WHEN entry_record.scale >= 20 THEN 1.2
            ELSE 1.0
        END;

        -- C_score Performance Points
        perf_points := CASE entry_record.highest_rank
            WHEN 'chair' THEN 3 * entry_record.rounds
            WHEN 'panel' THEN 1 * entry_record.rounds
            ELSE 0
        END;

        -- D_time Multiplier
        time_multiplier := CASE
            WHEN entry_record.year >= current_year THEN 1.0
            WHEN entry_record.year = current_year - 1 THEN 0.9
            WHEN entry_record.year = current_year - 2 THEN 0.8
            ELSE 0.7
        END;

        tournament_score := ((role_points * scale_multiplier) + perf_points) * time_multiplier;
        total_score := total_score + tournament_score;
    END LOOP;

    RETURN total_score;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_user_levels()
RETURNS TRIGGER AS $$
DECLARE
    target_user_id UUID;
    final_debater_score NUMERIC;
    final_judge_score NUMERIC;
    new_debater_level debater_level_enum;
    new_judge_level judge_level_enum;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF TG_TABLE_NAME = 'tournament_entries' THEN
            target_user_id := OLD.user_id;
        ELSE
            IF TG_TABLE_NAME = 'debater_details' THEN
                SELECT user_id INTO target_user_id FROM tournament_entries WHERE debater_details_id = OLD.id;
            ELSIF TG_TABLE_NAME = 'judge_details' THEN
                SELECT user_id INTO target_user_id FROM tournament_entries WHERE judge_details_id = OLD.id;
            END IF;
        END IF;
    ELSE
        IF TG_TABLE_NAME = 'tournament_entries' THEN
            target_user_id := NEW.user_id;
        ELSE
            IF TG_TABLE_NAME = 'debater_details' THEN
                SELECT user_id INTO target_user_id FROM tournament_entries WHERE debater_details_id = NEW.id;
            ELSIF TG_TABLE_NAME = 'judge_details' THEN
                SELECT user_id INTO target_user_id FROM tournament_entries WHERE judge_details_id = NEW.id;
            END IF;
        END IF;
    END IF;

    IF target_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Calculate Scores
    final_debater_score := calculate_debater_score(target_user_id);
    final_judge_score := calculate_judge_score(target_user_id);

    -- Resolve Debater Level
    new_debater_level := CASE
        WHEN final_debater_score > 150 THEN 'pro'::debater_level_enum
        WHEN final_debater_score >= 50 THEN 'open'::debater_level_enum
        ELSE 'novice'::debater_level_enum
    END;

    -- Resolve Judge Level
    new_judge_level := CASE
        WHEN final_judge_score > 300 THEN 'expert'::judge_level_enum
        WHEN final_judge_score > 150 THEN 'advanced'::judge_level_enum
        WHEN final_judge_score >= 50 THEN 'intermediate'::judge_level_enum
        ELSE 'novice'::judge_level_enum
    END;

    -- Update User Record
    UPDATE users
    SET debater_score = final_debater_score,
        judge_score = final_judge_score,
        debater_level = new_debater_level,
        judge_level = new_judge_level
    WHERE id = target_user_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply Triggers
CREATE TRIGGER trigger_sync_levels_entries
AFTER INSERT OR UPDATE OR DELETE ON tournament_entries
FOR EACH ROW EXECUTE FUNCTION sync_user_levels();

CREATE TRIGGER trigger_sync_levels_debater
AFTER UPDATE ON debater_details
FOR EACH ROW EXECUTE FUNCTION sync_user_levels();

CREATE TRIGGER trigger_sync_levels_judge
AFTER UPDATE ON judge_details
FOR EACH ROW EXECUTE FUNCTION sync_user_levels();
