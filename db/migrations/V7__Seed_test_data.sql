-- Test data seed
-- Password for all users: TestPassword123@
-- Hashed with argon2 (placeholder - must be replaced with real hash at runtime)
-- The migrate script will replace __HASHED_PASSWORD__ with the actual argon2 hash

-- 8 test users with varying levels
INSERT INTO users (id, full_name, username, password, email, debater_level, judge_level, institution, avatar_url) VALUES
('1e7d6a00-0000-6000-8000-000000000001', 'Alice Johnson',   'alice_debater',   '__HASHED_PASSWORD__', 'alice@test.com',   'novice',  'novice',       'Oxford University',     1),
('1e7d6a00-0000-6000-8000-000000000002', 'Bob Smith',       'bob_judge',       '__HASHED_PASSWORD__', 'bob@test.com',     'novice',  'novice',       'Cambridge University',  2),
('1e7d6a00-0000-6000-8000-000000000003', 'Charlie Lee',     'charlie_pro',     '__HASHED_PASSWORD__', 'charlie@test.com', 'novice',  'novice',       'Harvard University',    3),
('1e7d6a00-0000-6000-8000-000000000004', 'Diana Park',      'diana_open',      '__HASHED_PASSWORD__', 'diana@test.com',   'novice',  'novice',       'Stanford University',   4),
('1e7d6a00-0000-6000-8000-000000000005', 'Ethan Brown',     'ethan_novice',    '__HASHED_PASSWORD__', 'ethan@test.com',   'novice',  'novice',       'Yale University',       5),
('1e7d6a00-0000-6000-8000-000000000006', 'Fiona Chen',      'fiona_allround',  '__HASHED_PASSWORD__', 'fiona@test.com',   'novice',  'novice',       'MIT',                   6),
('1e7d6a00-0000-6000-8000-000000000007', 'George Kim',      'george_wsdc',     '__HASHED_PASSWORD__', 'george@test.com',  'novice',  'novice',       'NUS',                   7),
('1e7d6a00-0000-6000-8000-000000000008', 'Hannah Li',       'hannah_bp',       '__HASHED_PASSWORD__', 'hannah@test.com',  'novice',  'novice',       'Melbourne University',  8)
ON CONFLICT (username) DO NOTHING;

-- Tournaments (mix of BP and WSDC, different scales and years)
INSERT INTO tournaments (id, name, year, scale, rule) VALUES
('2e7d6a00-0000-6000-8000-000000000001', 'World Universities Debating Championship 2025',  2025, 100, 'bp'),
('2e7d6a00-0000-6000-8000-000000000002', 'Asian BP Championship 2025',                     2025, 60,  'bp'),
('2e7d6a00-0000-6000-8000-000000000003', 'WSDC Nationals 2025',                            2025, 40,  'wsdc'),
('2e7d6a00-0000-6000-8000-000000000004', 'Intervarsity Debate 2024',                       2024, 30,  'bp'),
('2e7d6a00-0000-6000-8000-000000000005', 'Regional WSDC Open 2024',                        2024, 20,  'wsdc'),
('2e7d6a00-0000-6000-8000-000000000006', 'Campus Debate League 2023',                      2023, 15,  'bp')
ON CONFLICT (id) DO NOTHING;

-- Debater details
INSERT INTO debater_details (id, breaking_rank, achievement) VALUES
('3e7d6a00-0000-6000-8000-000000000001', 1,  'champion'),
('3e7d6a00-0000-6000-8000-000000000002', 2,  'finalist'),
('3e7d6a00-0000-6000-8000-000000000003', 4,  'semiFinalist'),
('3e7d6a00-0000-6000-8000-000000000004', 8,  'quarterFinalist'),
('3e7d6a00-0000-6000-8000-000000000005', 16, 'octoFinalist'),
('3e7d6a00-0000-6000-8000-000000000006', NULL, 'participant'),
('3e7d6a00-0000-6000-8000-000000000007', 1, 'champion'),
('3e7d6a00-0000-6000-8000-000000000008', 3, 'semiFinalist')
ON CONFLICT (id) DO NOTHING;

-- Judge details
INSERT INTO judge_details (id, rounds, highest_rank) VALUES
('4e7d6a00-0000-6000-8000-000000000001', 8,  'chair'),
('4e7d6a00-0000-6000-8000-000000000002', 6,  'panel'),
('4e7d6a00-0000-6000-8000-000000000003', 10, 'chair'),
('4e7d6a00-0000-6000-8000-000000000004', 4,  'trainee'),
('4e7d6a00-0000-6000-8000-000000000005', 7,  'panel'),
('4e7d6a00-0000-6000-8000-000000000006', 5,  'chair')
ON CONFLICT (id) DO NOTHING;

-- Tournament entries (debater entries)
-- Alice: champion at WUDC 2025 (big tournament)
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000001', '2e7d6a00-0000-6000-8000-000000000001', '1e7d6a00-0000-6000-8000-000000000001', 'debater', '3e7d6a00-0000-6000-8000-000000000001');

-- Charlie: finalist at Asian BP 2025
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000002', '2e7d6a00-0000-6000-8000-000000000002', '1e7d6a00-0000-6000-8000-000000000003', 'debater', '3e7d6a00-0000-6000-8000-000000000002');

-- Diana: semi-finalist at Intervarsity 2024
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000003', '2e7d6a00-0000-6000-8000-000000000004', '1e7d6a00-0000-6000-8000-000000000004', 'debater', '3e7d6a00-0000-6000-8000-000000000003');

-- Ethan: quarter-finalist at Campus League 2023
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000004', '2e7d6a00-0000-6000-8000-000000000006', '1e7d6a00-0000-6000-8000-000000000005', 'debater', '3e7d6a00-0000-6000-8000-000000000004');

-- Fiona: octo-finalist at WSDC Nationals 2025
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000005', '2e7d6a00-0000-6000-8000-000000000003', '1e7d6a00-0000-6000-8000-000000000006', 'debater', '3e7d6a00-0000-6000-8000-000000000005');

-- George: participant at Regional WSDC 2024
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000006', '2e7d6a00-0000-6000-8000-000000000005', '1e7d6a00-0000-6000-8000-000000000007', 'debater', '3e7d6a00-0000-6000-8000-000000000006');

-- Hannah: champion at WSDC Nationals 2025 (as debater)
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000007', '2e7d6a00-0000-6000-8000-000000000003', '1e7d6a00-0000-6000-8000-000000000008', 'debater', '3e7d6a00-0000-6000-8000-000000000007');

-- Alice: also champion at Asian BP (second entry)
INSERT INTO tournament_entries (id, tournament_id, user_id, role, debater_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000008', '2e7d6a00-0000-6000-8000-000000000002', '1e7d6a00-0000-6000-8000-000000000001', 'debater', '3e7d6a00-0000-6000-8000-000000000008');

-- Tournament entries (judge entries)
-- Bob: chair judge at WUDC 2025
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000009', '2e7d6a00-0000-6000-8000-000000000001', '1e7d6a00-0000-6000-8000-000000000002', 'independentAdjudicator', '4e7d6a00-0000-6000-8000-000000000001');

-- Bob: panel judge at Asian BP 2025
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000010', '2e7d6a00-0000-6000-8000-000000000002', '1e7d6a00-0000-6000-8000-000000000002', 'subsidizedAdjudicator', '4e7d6a00-0000-6000-8000-000000000002');

-- Charlie: also judges - chair at WSDC Nationals 2025
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000011', '2e7d6a00-0000-6000-8000-000000000003', '1e7d6a00-0000-6000-8000-000000000003', 'invitedAdjudicator', '4e7d6a00-0000-6000-8000-000000000003');

-- Fiona: trainee judge at Intervarsity 2024
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000012', '2e7d6a00-0000-6000-8000-000000000004', '1e7d6a00-0000-6000-8000-000000000006', 'independentAdjudicator', '4e7d6a00-0000-6000-8000-000000000004');

-- George: panel judge at Campus League 2023
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000013', '2e7d6a00-0000-6000-8000-000000000006', '1e7d6a00-0000-6000-8000-000000000007', 'independentAdjudicator', '4e7d6a00-0000-6000-8000-000000000005');

-- Hannah: chair judge at Regional WSDC 2024
INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id) VALUES
('5e7d6a00-0000-6000-8000-000000000014', '2e7d6a00-0000-6000-8000-000000000005', '1e7d6a00-0000-6000-8000-000000000008', 'subsidizedAdjudicator', '4e7d6a00-0000-6000-8000-000000000006');
