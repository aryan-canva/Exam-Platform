package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.SubmitRequest;
import com.codingexam.platform.dto.response.SubmissionView;
import com.codingexam.platform.model.*;
import com.codingexam.platform.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class SubmissionService {

    private final SubmissionRepository submissionRepo;
    private final SessionRepository sessionRepo;
    private final ContestRepository contestRepo;
    private final ProblemRepository problemRepo;
    private final UserRepository userRepo;

    public SubmissionService(SubmissionRepository submissionRepo,
                             SessionRepository sessionRepo,
                             ContestRepository contestRepo,
                             ProblemRepository problemRepo,
                             UserRepository userRepo) {
        this.submissionRepo = submissionRepo;
        this.sessionRepo    = sessionRepo;
        this.contestRepo    = contestRepo;
        this.problemRepo    = problemRepo;
        this.userRepo       = userRepo;
    }

    @Transactional
    public Submission submit(SubmitRequest req, UUID userId) {
        Session session = sessionRepo.findById(req.sessionId())
            .orElseThrow(() -> new NotFoundException("Session not found: " + req.sessionId()));
        if (!session.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Session does not belong to this user");
        }
        if (session.getStatus() != Session.Status.ACTIVE) {
            throw new ConflictException("Session is not ACTIVE");
        }

        Contest contest = contestRepo.findById(req.contestId())
            .orElseThrow(() -> new NotFoundException("Contest not found: " + req.contestId()));
                if (contest.getStatus() != Contest.Status.RUNNING) {
                    throw new ConflictException("Contest is not currently RUNNING");
                }
        Problem problem = problemRepo.findById(req.problemId())
            .orElseThrow(() -> new NotFoundException("Problem not found: " + req.problemId()));

        User user = userRepo.findById(userId)
            .orElseThrow(() -> new NotFoundException("User not found: " + userId));

        Submission sub = new Submission();
        sub.setSession(session);
        sub.setContest(contest);
        sub.setProblem(problem);
        sub.setUser(user);
        sub.setLanguage(req.language());
        sub.setSourceCode(req.sourceCode());
        sub.setStatus("PENDING");
        sub.setVerdict(null);
        sub.setScore(0);

        return submissionRepo.save(sub);
    }

    @Transactional(readOnly = true)
    public List<SubmissionView> getSubmissions(UUID contestId, UUID userId) {
        return submissionRepo.findByContestIdAndUserId(contestId, userId)
            .stream()
            .map(SubmissionView::from)
            .toList();
    }

    @Transactional(readOnly = true)
    public Submission getSubmission(UUID submissionId, UUID userId) {
        Submission sub = submissionRepo.findById(submissionId)
            .orElseThrow(() -> new NotFoundException("Submission not found: " + submissionId));
        if (!sub.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Submission does not belong to this user");
        }
        return sub;
    }

    @Transactional(readOnly = true)
    public List<ScoreEntry> scoreboard(UUID contestId) {
        List<Submission> accepted = submissionRepo.findAcceptedByContest(contestId);

        java.util.Map<UUID, java.util.Map<UUID, Integer>> userProblemBest = new java.util.LinkedHashMap<>();
        for (Submission s : accepted) {
            UUID uid = s.getUser().getId();
            UUID pid = s.getProblem().getId();
            userProblemBest.computeIfAbsent(uid, k -> new java.util.LinkedHashMap<>())
                           .putIfAbsent(pid, s.getScore());
        }

        return userProblemBest.entrySet().stream()
            .map(e -> new ScoreEntry(
                e.getKey(),
                e.getValue().values().stream().mapToInt(Integer::intValue).sum()
            ))
            .sorted((a, b) -> Integer.compare(b.totalScore(), a.totalScore()))
            .toList();
    }

    public record ScoreEntry(UUID userId, int totalScore) {}

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String msg) { super(msg); }
    }
    public static class ConflictException extends RuntimeException {
        public ConflictException(String msg) { super(msg); }
    }
    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String msg) { super(msg); }
    }
}