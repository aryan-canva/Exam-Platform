package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.CreateContestRequest;
import com.codingexam.platform.dto.response.ContestView;
import com.codingexam.platform.model.*;
import com.codingexam.platform.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * ContestService – Person 1 (1.5)
 * <p>
 * createContest(dto)                              → Contest
 * addProblem(contestId, problemId, label, points) → void
 * enroll(contestId, userIds[])                    → int (enrolled count)
 * publish(contestId)                              → Contest  (DRAFT → SCHEDULED)
 * getContestForStudent(contestId, userId)         → ContestView
 */
@Service
public class ContestService {

    private final ContestRepository contestRepo;
    private final ProblemRepository problemRepo;
    private final ContestProblemRepository contestProblemRepo;
    private final EnrollmentRepository enrollmentRepo;
    private final UserRepository userRepo;
    private final PolicyService policyService;

    public ContestService(ContestRepository contestRepo,
                          ProblemRepository problemRepo,
                          ContestProblemRepository contestProblemRepo,
                          EnrollmentRepository enrollmentRepo,
                          UserRepository userRepo,
                          PolicyService policyService) {
        this.contestRepo = contestRepo;
        this.problemRepo = problemRepo;
        this.contestProblemRepo = contestProblemRepo;
        this.enrollmentRepo = enrollmentRepo;
        this.userRepo = userRepo;
        this.policyService = policyService;
    }

    // ── Create ────────────────────────────────────────────────────────────────

    @Transactional
    public Contest createContest(CreateContestRequest dto, UUID createdById) {
        User creator = userRepo.findById(createdById)
            .orElseThrow(() -> new NotFoundException("User not found: " + createdById));

        Contest c = new Contest();
        c.setTitle(dto.title());
        c.setDurationSec(dto.durationSec() > 0 ? dto.durationSec() : 7200);
        c.setScoringMode(dto.scoringMode() != null ? dto.scoringMode() : "ICPC");
        c.setStartsAt(dto.startsAt());
        c.setEndsAt(dto.endsAt());
        c.setCreatedBy(creator);
        c.setStatus(Contest.Status.DRAFT);

        return contestRepo.save(c);
    }

    // ── Problems ──────────────────────────────────────────────────────────────

    @Transactional
    public void addProblem(UUID contestId, UUID problemId, String label, int points) {
        Contest contest = getContestOrThrow(contestId);
        if (contest.getStatus() != Contest.Status.DRAFT) {
            throw new ConflictException("Can only add problems to DRAFT contests");
        }

        Problem problem = problemRepo.findById(problemId)
            .orElseThrow(() -> new NotFoundException("Problem not found: " + problemId));

        if (contestProblemRepo.existsByContestIdAndProblemId(contestId, problemId)) {
            throw new ConflictException("Problem already in contest");
        }

        ContestProblem cp = new ContestProblem();
        cp.setId(new ContestProblem.ContestProblemId(contestId, problemId));
        cp.setContest(contest);
        cp.setProblem(problem);
        cp.setLabel(label);
        cp.setPoints(points);

        contestProblemRepo.save(cp);
    }

    // ── Enrollment ────────────────────────────────────────────────────────────

    @Transactional
    public int enroll(UUID contestId, List<UUID> userIds) {
        Contest contest = getContestOrThrow(contestId);
        int count = 0;
        for (UUID userId : userIds) {
            if (enrollmentRepo.existsByContestIdAndUserId(contestId, userId)) continue;
            User user = userRepo.findById(userId).orElse(null);
            if (user == null) continue;

            Enrollment e = new Enrollment();
            e.setId(new Enrollment.EnrollmentId(contestId, userId));
            e.setContest(contest);
            e.setUser(user);
            enrollmentRepo.save(e);
            count++;
        }
        return count;
    }

    // ── Publish ───────────────────────────────────────────────────────────────

    /**
     * Move contest from DRAFT → SCHEDULED.
     * Also builds and signs the policy.
     */
    @Transactional
    public Contest publish(UUID contestId) {
        Contest contest = getContestOrThrow(contestId);
        if (contest.getStatus() != Contest.Status.DRAFT) {
            throw new ConflictException("Contest is not in DRAFT status");
        }

        Policy policy = policyService.buildAndSignPolicy(contestId);
        contest.setPolicy(policy);
        contest.setStatus(Contest.Status.SCHEDULED);

        return contestRepo.save(contest);
    }

    // ── Student view ──────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public ContestView getContestForStudent(UUID contestId, UUID userId) {
        Contest contest = getContestOrThrow(contestId);

        // Must be enrolled
        if (!enrollmentRepo.existsByContestIdAndUserId(contestId, userId)) {
            throw new ForbiddenException("Not enrolled in this contest");
        }

        List<ContestProblem> cps = contestProblemRepo.findByContestId(contestId);
        List<ContestView.ProblemSummary> problems = cps.stream()
            .map(cp -> new ContestView.ProblemSummary(
                cp.getProblem().getId(),
                cp.getLabel(),
                cp.getProblem().getTitle(),
                cp.getPoints()
            ))
            .toList();

        return new ContestView(
            contest.getId(), contest.getTitle(), contest.getStatus().name(),
            contest.getStartsAt(), contest.getEndsAt(), contest.getDurationSec(),
            problems
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Contest getContestOrThrow(UUID contestId) {
        return contestRepo.findById(contestId)
            .orElseThrow(() -> new NotFoundException("Contest not found: " + contestId));
    }

    // ── Exceptions ────────────────────────────────────────────────────────────

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) { super(message); }
    }
    public static class ConflictException extends RuntimeException {
        public ConflictException(String message) { super(message); }
    }
    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String message) { super(message); }
    }
}
