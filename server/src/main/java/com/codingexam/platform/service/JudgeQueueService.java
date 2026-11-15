package com.codingexam.platform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * Job queue between the exam server and remote judge workers.
 *
 * Workers PULL jobs (outbound HTTP only), so they work from behind NAT and
 * from any network that can reach the server's IP/hostname.
 *
 *   enqueueSubmission(id)            -> job kind SUBMIT (graded against all testcases)
 *   enqueueRun(...)                  -> job kind RUN    (student's custom-input run)
 *   claim(workerId)                  -> next QUEUED job (FOR UPDATE SKIP LOCKED) or null
 *   complete(jobId, workerId, json)  -> stores the result, updates the submission
 *   reapExpired()                    -> re-queues jobs whose worker stopped responding
 */
@Service
public class JudgeQueueService {

    private static final Set<String> LANGS = Set.of("C", "CPP", "JAVA", "PYTHON");
    private static final int MAX_SOURCE_CHARS = 100_000;
    private static final int MAX_STDIN_CHARS = 100_000;

    // Plain Jackson 2 instance: avoids depending on which ObjectMapper bean Spring Boot exposes.
    private static final ObjectMapper mapper = new ObjectMapper();

    private final JdbcTemplate jdbc;

    @Value("${app.judge.worker-token:dev-worker-token}")
    private String workerToken;
    @Value("${app.judge.lease-seconds:90}")
    private int leaseSeconds;
    @Value("${app.judge.max-attempts:3}")
    private int maxAttempts;

    public JudgeQueueService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── Worker authentication ────────────────────────────────────────────────
    public void checkWorkerToken(String presented) {
        byte[] a = workerToken.getBytes(StandardCharsets.UTF_8);
        byte[] b = presented == null ? new byte[0] : presented.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(a, b)) {
            throw new UnauthorizedException("Invalid worker token");
        }
    }

    // ── Enqueue ──────────────────────────────────────────────────────────────
    @Transactional
    public void enqueueSubmission(UUID submissionId) {
        int n = jdbc.update("""
            INSERT INTO judge_jobs (id, kind, submission_id, user_id, problem_id, language, source_code)
            SELECT ?, 'SUBMIT', s.id, s.user_id, s.problem_id, s.language, s.source_code
            FROM submissions s WHERE s.id = ?
            """, UUID.randomUUID(), submissionId);
        if (n == 0) throw new NotFoundException("Submission not found: " + submissionId);
    }

    @Transactional
    public UUID enqueueRun(UUID userId, String language, String sourceCode, String stdin, UUID problemId) {
        String lang = language == null ? "" : language.trim().toUpperCase(Locale.ROOT);
        if (!LANGS.contains(lang)) throw new BadRequestException("Unsupported language: " + language);
        if (sourceCode == null || sourceCode.isBlank()) throw new BadRequestException("sourceCode is empty");
        if (sourceCode.length() > MAX_SOURCE_CHARS) throw new BadRequestException("sourceCode too large");
        if (stdin != null && stdin.length() > MAX_STDIN_CHARS) throw new BadRequestException("stdin too large");

        Integer open = jdbc.queryForObject(
            "SELECT count(*) FROM judge_jobs WHERE kind = 'RUN' AND user_id = ? AND status <> 'DONE'",
            Integer.class, userId);
        if (open != null && open >= 2) {
            throw new ConflictException("You already have runs in progress; wait for them to finish");
        }

        UUID id = UUID.randomUUID();
        if (problemId != null) {
            jdbc.update("""
                INSERT INTO judge_jobs (id, kind, user_id, problem_id, language, source_code, stdin)
                VALUES (?, 'RUN', ?, ?, ?, ?, ?)
                """, id, userId, problemId, lang, sourceCode, stdin == null ? "" : stdin);
        } else {
            jdbc.update("""
                INSERT INTO judge_jobs (id, kind, user_id, language, source_code, stdin)
                VALUES (?, 'RUN', ?, ?, ?, ?)
                """, id, userId, lang, sourceCode, stdin == null ? "" : stdin);
        }
        return id;
    }

    // ── Claim ────────────────────────────────────────────────────────────────
    /** Returns the job payload for the worker, or null when the queue is empty. */
    @Transactional
    public Map<String, Object> claim(String workerId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            UPDATE judge_jobs
               SET status = 'RUNNING', claimed_by = ?, claimed_at = now(),
                   lease_until = now() + (? * interval '1 second'), attempts = attempts + 1
             WHERE id = (SELECT id FROM judge_jobs WHERE status = 'QUEUED'
                          ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING id, kind, language, source_code, stdin, problem_id, attempts
            """, workerId, leaseSeconds);
        if (rows.isEmpty()) return null;

        Map<String, Object> r = rows.get(0);
        UUID jobId = (UUID) r.get("id");
        UUID problemId = (UUID) r.get("problem_id");
        String kind = (String) r.get("kind");

        int timeLimitMs = 2000;
        int memoryLimitKb = 262144;
        String checker = "EXACT";
        if (problemId != null) {
            Map<String, Object> p = jdbc.queryForMap(
                "SELECT time_limit_ms, memory_limit_kb, checker_type FROM problems WHERE id = ?", problemId);
            timeLimitMs = ((Number) p.get("time_limit_ms")).intValue();
            memoryLimitKb = ((Number) p.get("memory_limit_kb")).intValue();
            checker = (String) p.get("checker_type");
        }

        Map<String, Object> job = new LinkedHashMap<>();
        job.put("id", jobId.toString());
        job.put("kind", kind);
        job.put("language", r.get("language"));
        job.put("sourceCode", r.get("source_code"));
        job.put("timeLimitMs", timeLimitMs);
        job.put("memoryLimitKb", memoryLimitKb);
        job.put("checker", checker);
        job.put("attempt", ((Number) r.get("attempts")).intValue());

        if ("RUN".equals(kind)) {
            job.put("stdin", r.get("stdin") == null ? "" : r.get("stdin"));
        } else {
            List<Map<String, Object>> tests = new ArrayList<>();
            for (Map<String, Object> t : jdbc.queryForList("""
                    SELECT id, ordinal, input_ref, expected_ref, points
                      FROM testcases WHERE problem_id = ? ORDER BY ordinal
                    """, problemId)) {
                Map<String, Object> tc = new LinkedHashMap<>();
                tc.put("id", t.get("id").toString());
                tc.put("ordinal", t.get("ordinal"));
                tc.put("input", t.get("input_ref"));
                tc.put("expected", t.get("expected_ref"));
                tc.put("points", t.get("points"));
                tests.add(tc);
            }
            job.put("testcases", tests);
        }
        jdbc.update("UPDATE judge_workers SET current_job = ? WHERE worker_id = ?", jobId, workerId);
        return job;
    }

    // ── Complete ─────────────────────────────────────────────────────────────
    /**
     * Result body from the worker:
     * { workerId, systemError?, compile:{ok,output}, tests:[{testcaseId,verdict,timeMs,memoryKb,stdout}],
     *   stdout?, stderr?, exitCode?, timeMs? }
     */
    @Transactional
    public void complete(UUID jobId, String workerId, Map<String, Object> body) {
        JsonNode result = mapper.valueToTree(body);
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT status, claimed_by, kind, submission_id, attempts FROM judge_jobs WHERE id = ? FOR UPDATE", jobId);
        if (rows.isEmpty()) throw new NotFoundException("Job not found: " + jobId);
        Map<String, Object> job = rows.get(0);
        if (!"RUNNING".equals(job.get("status")) || !Objects.equals(job.get("claimed_by"), workerId)) {
            throw new ConflictException("Job is not leased to this worker (lease expired or already finished)");
        }
        int attempts = ((Number) job.get("attempts")).intValue();

        // The worker hit an infrastructure problem (docker down, etc.): retry elsewhere.
        if (result.hasNonNull("systemError") && attempts < maxAttempts) {
            jdbc.update("UPDATE judge_jobs SET status = 'QUEUED', claimed_by = NULL, lease_until = NULL WHERE id = ?", jobId);
            clearWorker(workerId);
            return;
        }

        jdbc.update("""
            UPDATE judge_jobs SET status = 'DONE', result_json = CAST(? AS jsonb), finished_at = now()
             WHERE id = ?
            """, result.toString(), jobId);

        if ("SUBMIT".equals(job.get("kind")) && job.get("submission_id") != null) {
            applySubmissionResult((UUID) job.get("submission_id"), result);
        }
        jdbc.update("UPDATE judge_workers SET jobs_done = jobs_done + 1, current_job = NULL WHERE worker_id = ?", workerId);
    }

    /** Worker keeps the lease alive while it is still judging. Returns false if the lease was lost. */
    @Transactional
    public boolean extendLease(UUID jobId, String workerId) {
        return jdbc.update("""
            UPDATE judge_jobs SET lease_until = now() + (? * interval '1 second')
             WHERE id = ? AND status = 'RUNNING' AND claimed_by = ?
            """, leaseSeconds, jobId, workerId) > 0;
    }

    private void clearWorker(String workerId) {
        jdbc.update("UPDATE judge_workers SET current_job = NULL WHERE worker_id = ?", workerId);
    }

    private void applySubmissionResult(UUID submissionId, JsonNode result) {
        if (result.hasNonNull("systemError")) {
            jdbc.update("UPDATE submissions SET status = 'ERROR', verdict = 'IE', judged_at = now() WHERE id = ?", submissionId);
            return;
        }
        if (!result.path("compile").path("ok").asBoolean(true)) {
            jdbc.update("""
                UPDATE submissions SET status = 'DONE', verdict = 'CE', score = 0, judged_at = now() WHERE id = ?
                """, submissionId);
            return;
        }

        // Points available for this problem in this contest, and the scoring mode.
        Map<String, Object> meta = jdbc.queryForMap("""
            SELECT COALESCE(cp.points, 100) AS points, c.scoring_mode
              FROM submissions s
              JOIN contests c ON c.id = s.contest_id
              LEFT JOIN contest_problems cp ON cp.contest_id = s.contest_id AND cp.problem_id = s.problem_id
             WHERE s.id = ?
            """, submissionId);
        int problemPoints = ((Number) meta.get("points")).intValue();
        boolean partial = "IOI".equalsIgnoreCase((String) meta.get("scoring_mode"));

        jdbc.update("DELETE FROM submission_results WHERE submission_id = ?", submissionId);

        int total = 0, accepted = 0, maxTime = 0, maxMem = 0;
        String firstBad = null;
        for (JsonNode t : result.path("tests")) {
            String verdict = t.path("verdict").asText("IE");
            int timeMs = t.path("timeMs").asInt(0);
            int memKb = t.path("memoryKb").asInt(0);
            total++;
            if ("AC".equals(verdict)) accepted++;
            else if (firstBad == null) firstBad = verdict;
            maxTime = Math.max(maxTime, timeMs);
            maxMem = Math.max(maxMem, memKb);

            String snippet = t.path("stdout").asText("");
            if (snippet.length() > 500) snippet = snippet.substring(0, 500);
            jdbc.update("""
                INSERT INTO submission_results (id, submission_id, testcase_id, verdict, time_ms, memory_kb, stdout_snippet, points)
                VALUES (?, ?, CAST(? AS uuid), ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), submissionId, t.path("testcaseId").asText(), verdict,
                timeMs, memKb, snippet, "AC".equals(verdict) ? t.path("points").asInt(0) : 0);
        }

        String overall;
        int score;
        if (total == 0) {
            overall = "IE";
            score = 0;
        } else if (accepted == total) {
            overall = "AC";
            score = problemPoints;
        } else {
            overall = firstBad == null ? "WA" : firstBad;
            score = partial ? (int) Math.floor(problemPoints * (accepted / (double) total)) : 0;
        }
        jdbc.update("""
            UPDATE submissions SET status = 'DONE', verdict = ?, score = ?, runtime_ms = ?, memory_kb = ?, judged_at = now()
             WHERE id = ?
            """, overall, score, maxTime, maxMem, submissionId);
    }

    // ── Reaper: jobs whose worker disappeared ────────────────────────────────
    @Scheduled(fixedDelay = 15000)
    @Transactional
    public void reapExpired() {
        jdbc.update("""
            UPDATE submissions SET status = 'ERROR', verdict = 'IE', judged_at = now()
             WHERE id IN (SELECT submission_id FROM judge_jobs
                           WHERE status = 'RUNNING' AND lease_until < now() AND attempts >= ?
                             AND submission_id IS NOT NULL)
            """, maxAttempts);
        jdbc.update("""
            UPDATE judge_jobs SET status = 'DONE', finished_at = now(),
                   result_json = CAST('{"systemError":"worker lost"}' AS jsonb)
             WHERE status = 'RUNNING' AND lease_until < now() AND attempts >= ?
            """, maxAttempts);
        jdbc.update("""
            UPDATE judge_jobs SET status = 'QUEUED', claimed_by = NULL, lease_until = NULL
             WHERE status = 'RUNNING' AND lease_until < now() AND attempts < ?
            """, maxAttempts);
    }

    // ── Worker registry / status ─────────────────────────────────────────────
    @Transactional
    public void touchWorker(String workerId, String host, String version) {
        jdbc.update("""
            INSERT INTO judge_workers (worker_id, host, version, last_seen_at) VALUES (?, ?, ?, now())
            ON CONFLICT (worker_id) DO UPDATE
               SET host = EXCLUDED.host, version = EXCLUDED.version, last_seen_at = now()
            """, workerId, host, version);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listWorkers() {
        return jdbc.queryForList("""
            SELECT worker_id AS "workerId", host, version, current_job::text AS "currentJob",
                   jobs_done AS "jobsDone", to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSeenAt",
                   (last_seen_at > now() - interval '30 seconds') AS online
              FROM judge_workers ORDER BY worker_id
            """);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> queueStats() {
        return jdbc.queryForMap("""
            SELECT count(*) FILTER (WHERE status = 'QUEUED')  AS queued,
                   count(*) FILTER (WHERE status = 'RUNNING') AS running
              FROM judge_jobs
            """);
    }

    // ── Student run lookup ───────────────────────────────────────────────────
    @Transactional(readOnly = true)
    public Map<String, Object> getRun(UUID jobId, UUID userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT user_id, status, result_json::text AS result FROM judge_jobs
             WHERE id = ? AND kind = 'RUN'
            """, jobId);
        if (rows.isEmpty()) throw new NotFoundException("Run not found: " + jobId);
        Map<String, Object> r = rows.get(0);
        if (!userId.equals(r.get("user_id"))) throw new ForbiddenException("Run does not belong to this user");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", jobId.toString());
        out.put("status", r.get("status"));
        String json = (String) r.get("result");
        if (json != null) {
            try {
                out.put("result", mapper.readValue(json, Object.class));
            } catch (Exception e) {
                out.put("result", null);
            }
        }
        return out;
    }

    // ── Exceptions (mapped in GlobalExceptionHandler) ────────────────────────
    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String m) { super(m); }
    }
    public static class ConflictException extends RuntimeException {
        public ConflictException(String m) { super(m); }
    }
    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String m) { super(m); }
    }
    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String m) { super(m); }
    }
    public static class UnauthorizedException extends RuntimeException {
        public UnauthorizedException(String m) { super(m); }
    }
}
