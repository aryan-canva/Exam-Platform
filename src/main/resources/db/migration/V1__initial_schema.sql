-- =============================================================================
-- V1__initial_schema.sql
-- Coding Exam Platform – initial 11-table schema
-- Person 1: Database & Pipeline Setup
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE user_role        AS ENUM ('STUDENT', 'INSTRUCTOR', 'ADMIN');
CREATE TYPE contest_status   AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED', 'ARCHIVED');
CREATE TYPE session_status   AS ENUM ('CREATED', 'PREFLIGHT', 'LOCKED', 'ACTIVE', 'ENDED', 'TERMINATED', 'EXPIRED');
CREATE TYPE submission_status AS ENUM ('PENDING', 'JUDGING', 'DONE', 'ERROR');
CREATE TYPE verdict          AS ENUM ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'IE', 'PARTIAL');
CREATE TYPE language_type    AS ENUM ('C', 'CPP', 'JAVA', 'PYTHON');
CREATE TYPE severity_type    AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE event_type AS ENUM (
    'PROCESS_BLOCKED', 'USB_INSERTED', 'NEW_NIC', 'SERVICE_RESTARTED',
    'HEARTBEAT_GAP', 'CLOCK_CHANGE', 'VM_DETECTED', 'MULTI_MONITOR',
    'REMOTE_TOOL', 'SAFE_MODE', 'FIREWALL_CHANGED', 'KEY_BLOCKED',
    'FOCUS_LOST', 'LARGE_PASTE', 'TYPING_BURST', 'POLICY_TAMPER',
    'CHAIN_BREAK', 'LOGIN_FAIL', 'CLIENT_CRASH_RECOVERED'
);

-- ── 1. users ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username     VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role         user_role NOT NULL DEFAULT 'STUDENT',
    full_name    VARCHAR(200),
    student_ref  VARCHAR(50),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. problems ───────────────────────────────────────────────────────────────
CREATE TABLE problems (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(300) NOT NULL,
    statement_md    TEXT NOT NULL,
    time_limit_ms   INT NOT NULL DEFAULT 2000,
    memory_limit_kb INT NOT NULL DEFAULT 262144,
    checker_type    VARCHAR(20) NOT NULL DEFAULT 'EXACT',
    version         INT NOT NULL DEFAULT 1,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. testcases ──────────────────────────────────────────────────────────────
CREATE TABLE testcases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id  UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    ordinal     INT NOT NULL,
    input_ref   TEXT NOT NULL,
    expected_ref TEXT NOT NULL,
    group_no    INT,
    points      INT NOT NULL DEFAULT 0,
    is_sample   BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (problem_id, ordinal)
);

-- ── 4. contests ───────────────────────────────────────────────────────────────
CREATE TABLE contests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title          VARCHAR(300) NOT NULL,
    status         contest_status NOT NULL DEFAULT 'DRAFT',
    starts_at      TIMESTAMPTZ,
    ends_at        TIMESTAMPTZ,
    duration_sec   INT NOT NULL DEFAULT 7200,
    scoring_mode   VARCHAR(30) NOT NULL DEFAULT 'ICPC',
    languages      language_type[] NOT NULL DEFAULT ARRAY['CPP','JAVA','PYTHON']::language_type[],
    policy_id      UUID,
    freeze_at      TIMESTAMPTZ,
    created_by     UUID NOT NULL REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. contest_problems ───────────────────────────────────────────────────────
CREATE TABLE contest_problems (
    contest_id  UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    problem_id  UUID NOT NULL REFERENCES problems(id),
    label       VARCHAR(10) NOT NULL,
    points      INT NOT NULL DEFAULT 100,
    PRIMARY KEY (contest_id, problem_id)
);

-- ── 6. enrollments ────────────────────────────────────────────────────────────
CREATE TABLE enrollments (
    contest_id      UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    extra_time_sec  INT NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    PRIMARY KEY (contest_id, user_id)
);

-- ── 7. policies ───────────────────────────────────────────────────────────────
CREATE TABLE policies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contest_id  UUID NOT NULL REFERENCES contests(id),
    version     INT NOT NULL DEFAULT 1,
    json        JSONB NOT NULL,
    signature   BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contest_id, version)
);

ALTER TABLE contests
    ADD CONSTRAINT fk_contest_policy FOREIGN KEY (policy_id) REFERENCES policies(id);

-- ── 8. sessions ───────────────────────────────────────────────────────────────
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contest_id          UUID NOT NULL REFERENCES contests(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    device_fp           VARCHAR(200),
    status              session_status NOT NULL DEFAULT 'CREATED',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    session_key_hash    VARCHAR(255),
    last_heartbeat_at   TIMESTAMPTZ,
    last_seq            BIGINT NOT NULL DEFAULT 0,
    client_version      VARCHAR(50),
    UNIQUE (contest_id, user_id)  -- one active session per student per contest
);

-- ── 9. submissions ────────────────────────────────────────────────────────────
CREATE TABLE submissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id),
    contest_id  UUID NOT NULL REFERENCES contests(id),
    problem_id  UUID NOT NULL REFERENCES problems(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    language    language_type NOT NULL,
    source_code TEXT NOT NULL,
    status      submission_status NOT NULL DEFAULT 'PENDING',
    verdict     verdict,
    score       INT NOT NULL DEFAULT 0,
    runtime_ms  INT,
    memory_kb   INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    judged_at   TIMESTAMPTZ
);

CREATE INDEX idx_submissions_contest_user_problem ON submissions(contest_id, user_id, problem_id, created_at);

-- ── 10. submission_results ────────────────────────────────────────────────────
CREATE TABLE submission_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    testcase_id   UUID NOT NULL REFERENCES testcases(id),
    verdict       verdict NOT NULL,
    time_ms       INT,
    memory_kb     INT,
    stdout_snippet TEXT,
    points        INT NOT NULL DEFAULT 0
);

-- ── 11. events ────────────────────────────────────────────────────────────────
CREATE TABLE events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES sessions(id),
    seq          BIGINT NOT NULL,
    type         event_type NOT NULL,
    severity     severity_type NOT NULL DEFAULT 'INFO',
    ts           TIMESTAMPTZ NOT NULL,
    payload_json JSONB,
    prev_hash    CHAR(64),
    hash         CHAR(64) NOT NULL,
    hmac         CHAR(64) NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);

CREATE INDEX idx_events_session_seq ON events(session_id, seq);
CREATE INDEX idx_sessions_contest_status ON sessions(contest_id, status);
