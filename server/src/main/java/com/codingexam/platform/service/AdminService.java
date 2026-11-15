package com.codingexam.platform.service;

import com.codingexam.platform.service.JudgeQueueService.BadRequestException;
import com.codingexam.platform.service.JudgeQueueService.ConflictException;
import com.codingexam.platform.service.JudgeQueueService.ForbiddenException;
import com.codingexam.platform.service.JudgeQueueService.NotFoundException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * Teacher/admin queries and actions, plus plain-Map views of entities.
 * Everything here uses JDBC and returns Maps/Lists so the JSON never depends on
 * lazy JPA proxies (open-in-view is off). Exceptions are the ones already mapped
 * to HTTP codes in GlobalExceptionHandler (JudgeQueueService.*).
 */
@Service
public class AdminService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final AuthService authService;

    public AdminService(JdbcTemplate jdbc, AuthService authService) {
        this.jdbc = jdbc;
        this.authService = authService;
    }

    /** ISO-8601 UTC text for a timestamptz column (null stays null). */
    static String ts(String col) {
        return "to_char(" + col + " AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
    }

    // ── Contests ─────────────────────────────────────────────────────────────

    private static final String CONTEST_COLS = """
        c.id::text AS id, c.title, c.status::text AS status, c.duration_sec AS "durationSec",
        c.scoring_mode AS "scoringMode",
        """;

    private String contestSelect() {
        return "SELECT " + CONTEST_COLS
            + ts("c.starts_at") + " AS \"startsAt\", " + ts("c.ends_at") + " AS \"endsAt\", "
            + "(SELECT count(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS \"problemCount\", "
            + "(SELECT count(*) FROM enrollments e WHERE e.contest_id = c.id) AS \"enrolledCount\", "
            + "array_to_string(c.languages::text[], ',') AS \"languagesCsv\" "
            + "FROM contests c ";
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listContests() {
        return withLanguages(jdbc.queryForList(contestSelect() + "ORDER BY c.created_at DESC"));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> contestSummary(UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList(contestSelect() + "WHERE c.id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("Contest not found: " + id);
        return withLanguages(rows).get(0);
    }

    private static final List<String> ALL_LANGS = List.of("C", "CPP", "JAVA", "PYTHON");

    /** Replaces the CSV column with a "languages" list. */
    private static List<Map<String, Object>> withLanguages(List<Map<String, Object>> rows) {
        for (Map<String, Object> r : rows) {
            Object csv = r.remove("languagesCsv");
            List<String> l = csv == null || csv.toString().isBlank() ? ALL_LANGS : List.of(csv.toString().split(","));
            r.put("languages", l);
        }
        return rows;
    }

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public void requireLanguage(UUID contestId, String language) {
        List<String> allowed = (List<String>) contestSummary(contestId).get("languages");
        if (language == null || !allowed.contains(language.trim().toUpperCase())) {
            throw new BadRequestException("Language " + language + " is not allowed in this exam (allowed: " + String.join(", ", allowed) + ")");
        }
    }

    @Transactional
    public Map<String, Object> setLanguages(UUID id, List<String> langs) {
        String status = contestStatus(id);
        if (!"DRAFT".equals(status) && !"SCHEDULED".equals(status)) throw new ConflictException("Languages can only be changed before the exam starts");
        List<String> clean = new ArrayList<>();
        for (String l : langs == null ? List.<String>of() : langs) {
            String u = l == null ? "" : l.trim().toUpperCase();
            if (!ALL_LANGS.contains(u)) throw new BadRequestException("Unknown language: " + l);
            if (!clean.contains(u)) clean.add(u);
        }
        if (clean.isEmpty()) throw new BadRequestException("Pick at least one language");
        jdbc.update("UPDATE contests SET languages = string_to_array(?, ',')::language_type[] WHERE id = ?", String.join(",", clean), id);
        return contestSummary(id);
    }

    /** Contests the student is enrolled in (published, running or finished). */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> myContests(UUID userId) {
        return withLanguages(jdbc.queryForList(contestSelect()
            + "JOIN enrollments en ON en.contest_id = c.id AND en.user_id = ? "
            + "WHERE c.status::text IN ('SCHEDULED','RUNNING','ENDED') ORDER BY c.created_at DESC", userId));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> contestDetail(UUID id) {
        Map<String, Object> out = new LinkedHashMap<>(contestSummary(id));
        out.put("problems", jdbc.queryForList("""
            SELECT p.id::text AS "problemId", cp.label, p.title, cp.points
              FROM contest_problems cp JOIN problems p ON p.id = cp.problem_id
             WHERE cp.contest_id = ? ORDER BY cp.label
            """, id));
        out.put("students", jdbc.queryForList("""
            SELECT u.id::text AS "userId", u.username, u.full_name AS "fullName", u.student_ref AS "studentRef"
              FROM enrollments e JOIN users u ON u.id = e.user_id
             WHERE e.contest_id = ? ORDER BY u.username
            """, id));
        return out;
    }

    private String contestStatus(UUID id) {
        List<String> r = jdbc.queryForList("SELECT status::text FROM contests WHERE id = ?", String.class, id);
        if (r.isEmpty()) throw new NotFoundException("Contest not found: " + id);
        return r.get(0);
    }

    @Transactional
    public Map<String, Object> startContest(UUID id) {
        String status = contestStatus(id);
        if (!"SCHEDULED".equals(status)) {
            throw new ConflictException("Only a published (SCHEDULED) contest can be started; current status: " + status);
        }
        jdbc.update("""
            UPDATE contests SET status = CAST('RUNNING' AS contest_status), starts_at = now(),
                   ends_at = now() + (duration_sec * interval '1 second')
             WHERE id = ?
            """, id);
        return contestSummary(id);
    }

    @Transactional
    public Map<String, Object> stopContest(UUID id) {
        String status = contestStatus(id);
        if (!"RUNNING".equals(status)) throw new ConflictException("Contest is not RUNNING (status: " + status + ")");
        endContest(id);
        return contestSummary(id);
    }

    private void endContest(UUID id) {
        jdbc.update("UPDATE contests SET status = CAST('ENDED' AS contest_status), ends_at = now() WHERE id = ?", id);
        jdbc.update("""
            UPDATE sessions SET status = CAST('ENDED' AS session_status), ended_at = now()
             WHERE contest_id = ? AND status::text = 'ACTIVE'
            """, id);
    }

    /** Contests end automatically when their time is up. */
    @Scheduled(fixedDelay = 30000)
    @Transactional
    public void autoEndContests() {
        List<UUID> due = jdbc.queryForList(
            "SELECT id FROM contests WHERE status::text = 'RUNNING' AND ends_at IS NOT NULL AND ends_at < now()", UUID.class);
        for (UUID id : due) endContest(id);
    }

    @Transactional
    public void unenroll(UUID contestId, UUID userId) {
        jdbc.update("DELETE FROM enrollments WHERE contest_id = ? AND user_id = ?", contestId, userId);
    }

    // ── Users ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listUsers(String role) {
        String base = """
            SELECT id::text AS id, username, role::text AS role, full_name AS "fullName",
                   student_ref AS "studentRef", active FROM users
            """;
        if (role == null || role.isBlank()) return jdbc.queryForList(base + " ORDER BY username");
        return jdbc.queryForList(base + " WHERE role::text = ? ORDER BY username", role.toUpperCase(Locale.ROOT));
    }

    /** students: [{username, password, fullName?, studentRef?}] */
    @Transactional
    public Map<String, Object> createStudents(List<Map<String, Object>> students) {
        if (students == null || students.isEmpty()) throw new BadRequestException("students list is empty");
        if (students.size() > 500) throw new BadRequestException("at most 500 students per request");
        List<Map<String, Object>> created = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, Object> s : students) {
            String username = str(s.get("username")).trim();
            String password = str(s.get("password"));
            String fullName = str(s.get("fullName")).trim();
            String ref = str(s.get("studentRef")).trim();
            String reason = null;
            if (username.isEmpty() || username.length() > 100) reason = "invalid username";
            else if (password.length() < 6) reason = "password must be at least 6 characters";
            else if (!seen.add(username.toLowerCase(Locale.ROOT))) reason = "duplicate in request";
            else if (jdbc.queryForObject("SELECT count(*) FROM users WHERE lower(username) = lower(?)", Integer.class, username) > 0) {
                reason = "username already exists";
            }
            if (reason != null) {
                skipped.add(Map.of("username", username, "reason", reason));
                continue;
            }
            UUID id = UUID.randomUUID();
            jdbc.update("""
                INSERT INTO users (id, username, password_hash, role, full_name, student_ref, active)
                VALUES (?, ?, ?, CAST('STUDENT' AS user_role), ?, ?, true)
                """, id, username, authService.hashPassword(password),
                fullName.isEmpty() ? null : fullName, ref.isEmpty() ? null : ref);
            created.add(Map.of("id", id.toString(), "username", username));
        }
        return Map.of("created", created, "skipped", skipped);
    }

    @Transactional
    public void resetPassword(UUID userId, String newPassword) {
        if (newPassword == null || newPassword.length() < 6) throw new BadRequestException("password must be at least 6 characters");
        int n = jdbc.update("UPDATE users SET password_hash = ? WHERE id = ?", authService.hashPassword(newPassword), userId);
        if (n == 0) throw new NotFoundException("User not found: " + userId);
    }

    @Transactional(readOnly = true)
    public boolean anyTeacherExists() {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM users WHERE role::text IN ('TEACHER','ADMIN')", Integer.class);
        return n != null && n > 0;
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    // ── Problems / testcases ─────────────────────────────────────────────────

    private static final String PROBLEM_SELECT = """
        SELECT p.id::text AS id, p.title, p.statement_md AS "statementMd", p.time_limit_ms AS "timeLimitMs",
               p.memory_limit_kb AS "memoryLimitKb", p.checker_type AS "checkerType", p.version,
               (SELECT count(*) FROM testcases t WHERE t.problem_id = p.id) AS "testcaseCount"
          FROM problems p
        """;

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listProblems() {
        return jdbc.queryForList(PROBLEM_SELECT + " ORDER BY p.created_at DESC");
    }

    @Transactional(readOnly = true)
    public Map<String, Object> problemMap(UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList(PROBLEM_SELECT + " WHERE p.id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("Problem not found: " + id);
        return rows.get(0);
    }

    private static final String TESTCASE_SELECT = """
        SELECT id::text AS id, problem_id::text AS "problemId", ordinal, input_ref AS input, expected_ref AS expected,
               points, group_no AS "groupNo", is_sample AS "isSample", is_hidden AS "isHidden"
          FROM testcases
        """;

    @Transactional(readOnly = true)
    public List<Map<String, Object>> testcases(UUID problemId) {
        return jdbc.queryForList(TESTCASE_SELECT + " WHERE problem_id = ? ORDER BY ordinal", problemId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> testcaseMap(UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList(TESTCASE_SELECT + " WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("Testcase not found: " + id);
        return rows.get(0);
    }

    @Transactional
    public void deleteTestcase(UUID problemId, UUID testcaseId) {
        jdbc.update("DELETE FROM testcases WHERE id = ? AND problem_id = ?", testcaseId, problemId);
    }

    // ── Sessions ─────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Map<String, Object> sessionMap(UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id::text AS id, contest_id::text AS \"contestId\", "
            + "user_id::text AS \"userId\", status::text AS status, last_seq AS \"lastSeq\", "
            + ts("started_at") + " AS \"startedAt\", " + ts("ended_at") + " AS \"endedAt\" FROM sessions WHERE id = ?", id);
        if (rows.isEmpty()) throw new NotFoundException("Session not found: " + id);
        return rows.get(0);
    }

    /**
     * One row per enrolled student: session status plus event counts. A student who never opened the exam is listed
     * with status NOT_STARTED. byType is {EVENT_TYPE: count}; suspicious uses EventService.SUSPICIOUS_TYPES.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> contestSessions(UUID contestId) {
        String suspicious = EventService.SUSPICIOUS_TYPES.stream().map(t -> "'" + t + "'").collect(java.util.stream.Collectors.joining(","));
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT u.id::text AS \"userId\", u.username, u.full_name AS \"fullName\", "
            + "s.id::text AS \"sessionId\", COALESCE(s.status::text, 'NOT_STARTED') AS status, "
            + ts("s.started_at") + " AS \"startedAt\", " + ts("s.ended_at") + " AS \"endedAt\", "
            + ts("s.last_heartbeat_at") + " AS \"lastHeartbeatAt\", "
            + "count(ev.id) AS events, count(ev.id) FILTER (WHERE ev.type IN (" + suspicious + ")) AS suspicious, "
            + ts("max(ev.ts)") + " AS \"lastEventAt\", "
            + ts("max(ev.ts) FILTER (WHERE ev.type = 'WD_HEARTBEAT')") + " AS \"lastWdHeartbeatAt\" "
            + "FROM enrollments en JOIN users u ON u.id = en.user_id "
            + "LEFT JOIN sessions s ON s.contest_id = en.contest_id AND s.user_id = en.user_id "
            + "LEFT JOIN events ev ON ev.session_id = s.id "
            + "WHERE en.contest_id = ? GROUP BY u.id, s.id ORDER BY u.username", contestId);

        Map<String, Map<String, Object>> byType = new HashMap<>();
        for (Map<String, Object> r : jdbc.queryForList("SELECT ev.session_id::text AS sid, ev.type, count(*) AS n FROM events ev "
            + "JOIN sessions s ON s.id = ev.session_id WHERE s.contest_id = ? GROUP BY ev.session_id, ev.type", contestId)) {
            byType.computeIfAbsent((String) r.get("sid"), k -> new TreeMap<>()).put((String) r.get("type"), r.get("n"));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>(r);
            m.put("byType", byType.getOrDefault((String) r.get("sessionId"), Map.of()));
            out.add(m);
        }
        return out;
    }

    // ── Submissions / standings ──────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Map<String, Object>> contestSubmissions(UUID contestId) {
        return jdbc.queryForList("SELECT s.id::text AS id, u.username, u.full_name AS \"fullName\", "
            + "COALESCE(cp.label, '?') AS label, p.title AS \"problemTitle\", s.language, s.status, s.verdict, s.score, "
            + "s.runtime_ms AS \"runtimeMs\", " + ts("s.created_at") + " AS \"createdAt\" "
            + "FROM submissions s JOIN users u ON u.id = s.user_id JOIN problems p ON p.id = s.problem_id "
            + "LEFT JOIN contest_problems cp ON cp.contest_id = s.contest_id AND cp.problem_id = s.problem_id "
            + "WHERE s.contest_id = ? ORDER BY s.created_at DESC LIMIT 1000", contestId);
    }

    /** One row per enrolled student: total of best score per problem, plus the per-problem scores. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> standings(UUID contestId) {
        List<Map<String, Object>> students = jdbc.queryForList("""
            SELECT u.id AS uid, u.username, u.full_name AS full_name FROM enrollments e
              JOIN users u ON u.id = e.user_id WHERE e.contest_id = ?
            """, contestId);
        Map<Object, Map<String, Object>> byUser = new LinkedHashMap<>();
        for (Map<String, Object> s : students) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("userId", s.get("uid").toString());
            row.put("username", s.get("username"));
            row.put("fullName", s.get("full_name"));
            row.put("total", 0);
            row.put("solved", 0);
            row.put("penaltyMin", 0L);
            row.put("problems", new LinkedHashMap<String, Integer>());
            byUser.put(s.get("uid"), row);
        }
        // Per-submission rows in time order; best score, first-AC time and wrong attempts are computed here.
        List<Map<String, Object>> subs = jdbc.queryForList("""
            SELECT s.user_id AS uid, COALESCE(cp.label, '?') AS label, s.score AS score, s.verdict AS verdict,
                   EXTRACT(EPOCH FROM s.created_at) AS created_epoch
              FROM submissions s
              LEFT JOIN contest_problems cp ON cp.contest_id = s.contest_id AND cp.problem_id = s.problem_id
             WHERE s.contest_id = ? AND s.status = 'DONE'
             ORDER BY s.created_at
            """, contestId);
        Double startEpoch = null;
        List<Double> st = jdbc.queryForList("SELECT EXTRACT(EPOCH FROM starts_at)::float8 FROM contests WHERE id = ?", Double.class, contestId);
        if (!st.isEmpty()) startEpoch = st.get(0);
        record Cell(int best, boolean solved, int wrong, long solvedAtSec) {}
        Map<String, Cell> cells = new LinkedHashMap<>();
        for (Map<String, Object> b : subs) {
            if (!byUser.containsKey(b.get("uid"))) continue;
            String key = b.get("uid") + "|" + b.get("label");
            Cell c = cells.getOrDefault(key, new Cell(0, false, 0, 0));
            if (c.solved()) continue;                       // submissions after the first AC do not change the penalty
            int score = b.get("score") == null ? 0 : ((Number) b.get("score")).intValue();
            boolean ac = "AC".equals(b.get("verdict"));
            double at = ((Number) b.get("created_epoch")).doubleValue();
            long sec = startEpoch == null ? 0 : Math.max(0L, (long) (at - startEpoch));
            int wrong = c.wrong() + (!ac && !"CE".equals(b.get("verdict")) ? 1 : 0);
            cells.put(key, new Cell(Math.max(c.best(), score), ac, wrong, ac ? sec : 0));
        }
        for (Map.Entry<String, Cell> en : cells.entrySet()) {
            String[] k = en.getKey().split("\\|", 2);
            Map<String, Object> row = null;
            for (Map.Entry<Object, Map<String, Object>> u : byUser.entrySet()) if (u.getKey().toString().equals(k[0])) { row = u.getValue(); break; }
            if (row == null) continue;
            Cell c = en.getValue();
            @SuppressWarnings("unchecked")
            Map<String, Integer> per = (Map<String, Integer>) row.get("problems");
            per.put(k[1], c.best());
            row.put("total", ((Number) row.get("total")).intValue() + c.best());
            if (c.solved()) {
                row.put("solved", ((Number) row.get("solved")).intValue() + 1);
                long pen = c.solvedAtSec() / 60 + 20L * c.wrong();   // minutes + 20 per wrong attempt before the first AC
                row.put("penaltyMin", ((Number) row.get("penaltyMin")).longValue() + pen);
            }
        }
        List<Map<String, Object>> out = new ArrayList<>(byUser.values());
        out.sort((a, b) -> {
            int c = Integer.compare(((Number) b.get("total")).intValue(), ((Number) a.get("total")).intValue());
            if (c == 0) c = Integer.compare(((Number) b.get("solved")).intValue(), ((Number) a.get("solved")).intValue());
            if (c == 0) c = Long.compare(((Number) a.get("penaltyMin")).longValue(), ((Number) b.get("penaltyMin")).longValue());
            return c;
        });
        return out;
    }

    /** Submission with per-testcase verdicts and (for compile errors) the compiler output. */
    @Transactional(readOnly = true)
    public Map<String, Object> submissionDetail(UUID submissionId, UUID requesterId, boolean teacher) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT s.id::text AS id, s.user_id AS uid, s.problem_id::text AS \"problemId\", "
            + "s.contest_id::text AS \"contestId\", s.language, s.status, s.verdict, s.score, s.runtime_ms AS \"runtimeMs\", "
            + "s.memory_kb AS \"memoryKb\", " + ts("s.created_at") + " AS \"createdAt\", " + ts("s.judged_at") + " AS \"judgedAt\" "
            + "FROM submissions s WHERE s.id = ?", submissionId);
        if (rows.isEmpty()) throw new NotFoundException("Submission not found: " + submissionId);
        Map<String, Object> out = new LinkedHashMap<>(rows.get(0));
        UUID owner = (UUID) out.remove("uid");
        if (!teacher && !owner.equals(requesterId)) throw new ForbiddenException("Submission does not belong to this user");

        out.put("tests", jdbc.queryForList("""
            SELECT t.ordinal, t.is_sample AS "isSample", r.verdict, r.time_ms AS "timeMs", r.points
              FROM submission_results r JOIN testcases t ON t.id = r.testcase_id
             WHERE r.submission_id = ? ORDER BY t.ordinal
            """, submissionId));

        if ("CE".equals(out.get("verdict"))) {
            List<String> json = jdbc.queryForList("SELECT result_json::text FROM judge_jobs WHERE submission_id = ?", String.class, submissionId);
            if (!json.isEmpty() && json.get(0) != null) {
                try {
                    JsonNode n = MAPPER.readTree(json.get(0));
                    out.put("compileOutput", n.path("compile").path("output").asText(""));
                } catch (Exception ignored) { /* leave out */ }
            }
        }
        return out;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> submissionCreated(UUID id) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id.toString());
        m.put("status", "PENDING");
        return m;
    }
}
