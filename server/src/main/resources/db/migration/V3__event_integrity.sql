-- V3: make the events table match what the Event entity and the watchdogs actually send.
--  * type/severity are plain strings in the entity; the V1 enum `event_type` only knew 19 values and none of
--    the watchdog/app types (WATCHDOG_STARTED, WD_HEARTBEAT, PASTE, FOCUS_BACK, KIOSK_EXIT_ATTEMPT, APP_EXITED...),
--    so the very first ingest would have failed.
--  * payload_raw keeps the exact signed text. payload_json is JSONB, which re-orders keys and re-spaces the
--    text, so the hash chain could not be re-verified from the database without it.
ALTER TABLE events ALTER COLUMN severity DROP DEFAULT;
ALTER TABLE events ALTER COLUMN type     TYPE VARCHAR(50) USING type::text;
ALTER TABLE events ALTER COLUMN severity TYPE VARCHAR(20) USING severity::text;
ALTER TABLE events ALTER COLUMN severity SET DEFAULT 'INFO';
ALTER TABLE events ADD CONSTRAINT events_severity_chk CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL'));
ALTER TABLE events ADD COLUMN payload_raw TEXT;
CREATE INDEX idx_events_session_type ON events(session_id, type);
