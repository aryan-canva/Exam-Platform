-- V2: judge job queue, worker registry, and column fixes so the JPA entities
-- (which map status/verdict/language as plain strings) match the database.

-- Entities use Role.TEACHER; V1 only had INSTRUCTOR.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'TEACHER';

-- Submission entity maps these as String, not as Postgres enums.
ALTER TABLE submissions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE submissions ALTER COLUMN status   TYPE VARCHAR(20) USING status::text;
ALTER TABLE submissions ALTER COLUMN status   SET DEFAULT 'PENDING';
ALTER TABLE submissions ALTER COLUMN verdict  TYPE VARCHAR(10) USING verdict::text;
ALTER TABLE submissions ALTER COLUMN language TYPE VARCHAR(10) USING language::text;
ALTER TABLE submission_results ALTER COLUMN verdict TYPE VARCHAR(10) USING verdict::text;

CREATE TABLE judge_jobs (
    id            UUID PRIMARY KEY,
    kind          VARCHAR(10)  NOT NULL CHECK (kind IN ('SUBMIT','RUN')),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id),
    problem_id    UUID REFERENCES problems(id),
    language      VARCHAR(10)  NOT NULL,
    source_code   TEXT         NOT NULL,
    stdin         TEXT,
    status        VARCHAR(10)  NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','DONE')),
    claimed_by    VARCHAR(100),
    claimed_at    TIMESTAMPTZ,
    lease_until   TIMESTAMPTZ,
    attempts      INT          NOT NULL DEFAULT 0,
    result_json   JSONB,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX idx_judge_jobs_queue ON judge_jobs(status, created_at);
CREATE INDEX idx_judge_jobs_user  ON judge_jobs(user_id, kind, status);

CREATE TABLE judge_workers (
    worker_id    VARCHAR(100) PRIMARY KEY,
    host         VARCHAR(100),
    version      VARCHAR(50),
    current_job  UUID,
    jobs_done    BIGINT       NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
