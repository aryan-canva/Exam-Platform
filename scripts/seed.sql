-- =============================================================
-- Seed Script — Coding Exam Platform (Person 1 Demo Data)
-- Creates: 1 instructor, 1 student, 1 problem, 1 contest, 1 enrollment
-- Run AFTER the application has started (Flyway migrations applied)
-- Usage: psql -U postgres -d coding_exam_platform -f scripts/seed.sql
-- =============================================================

-- Argon2id hash for password "Password123!"
-- Pre-computed so the seed doesn't depend on app runtime
-- (Re-generate via: new Argon2PasswordEncoder(16,32768,1).encode("Password123!"))
DO $$
DECLARE
    v_instructor_id UUID := '11111111-1111-1111-1111-111111111111';
    v_student_id    UUID := '22222222-2222-2222-2222-222222222222';
    v_problem_id    UUID := '33333333-3333-3333-3333-333333333333';
    v_contest_id    UUID := '44444444-4444-4444-4444-444444444444';
    v_password_hash TEXT := '$argon2id$v=19$m=32768,t=1,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
BEGIN

-- ── Users ────────────────────────────────────────────────────
INSERT INTO users (id, username, email, password_hash, role, is_active, created_at)
VALUES
    (v_instructor_id, 'teacher1', 'teacher1@example.com', v_password_hash, 'INSTRUCTOR', true, now()),
    (v_student_id,    'student1', 'student1@example.com', v_password_hash, 'STUDENT',    true, now())
ON CONFLICT (username) DO NOTHING;

-- ── Problem ──────────────────────────────────────────────────
INSERT INTO problems (id, title, statement_md, time_limit_ms, memory_limit_kb, checker_type, created_by, created_at)
VALUES (
    v_problem_id,
    'Hello World',
    E'## Problem\n\nPrint `Hello, World!` to standard output.\n\n### Input\nNone.\n\n### Output\n`Hello, World!`',
    2000,
    262144,
    'exact',
    v_instructor_id,
    now()
) ON CONFLICT DO NOTHING;

-- Sample testcase (visible to students)
INSERT INTO testcases (id, problem_id, input_ref, expected_ref, points, is_sample, is_hidden, ordinal, created_at)
VALUES (
    gen_random_uuid(),
    v_problem_id,
    'sample/hello/input_1.txt',
    'sample/hello/expected_1.txt',
    0,
    true,
    false,
    1,
    now()
) ON CONFLICT DO NOTHING;

-- Hidden testcase (graded, not visible to students)
INSERT INTO testcases (id, problem_id, input_ref, expected_ref, points, is_sample, is_hidden, ordinal, created_at)
VALUES (
    gen_random_uuid(),
    v_problem_id,
    'hidden/hello/input_1.txt',
    'hidden/hello/expected_1.txt',
    100,
    false,
    true,
    2,
    now()
) ON CONFLICT DO NOTHING;

-- ── Contest ──────────────────────────────────────────────────
INSERT INTO contests (id, title, description, starts_at, ends_at, status, created_by, created_at)
VALUES (
    v_contest_id,
    'Demo Contest Week 1',
    'First demo contest for SAAD BUGS team.',
    now() + INTERVAL '1 hour',
    now() + INTERVAL '3 hours',
    'DRAFT',
    v_instructor_id,
    now()
) ON CONFLICT DO NOTHING;

-- Link problem to contest
INSERT INTO contest_problems (contest_id, problem_id, label, points)
VALUES (v_contest_id, v_problem_id, 'A', 100)
ON CONFLICT DO NOTHING;

-- ── Enrollment ───────────────────────────────────────────────
INSERT INTO enrollments (contest_id, user_id, enrolled_at)
VALUES (v_contest_id, v_student_id, now())
ON CONFLICT DO NOTHING;

RAISE NOTICE 'Seed complete.';
RAISE NOTICE '  Instructor: teacher1 / Password123!  (id: %)', v_instructor_id;
RAISE NOTICE '  Student:    student1 / Password123!  (id: %)', v_student_id;
RAISE NOTICE '  Problem:    Hello World              (id: %)', v_problem_id;
RAISE NOTICE '  Contest:    Demo Contest Week 1      (id: %)', v_contest_id;
RAISE NOTICE '';
RAISE NOTICE 'NOTE: password_hash is a placeholder. Run the app and use POST /auth/login';
RAISE NOTICE 'to verify. If login fails, update password_hash with a real Argon2id hash.';
RAISE NOTICE 'You can generate one via the AuthService.hashPassword() method.';

END $$;
