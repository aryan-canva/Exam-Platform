package com.codingexam.platform.service;

import com.codingexam.platform.dto.request.CreateProblemRequest;
import com.codingexam.platform.dto.response.ProblemView;
import com.codingexam.platform.model.*;
import com.codingexam.platform.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * ProblemService – Person 1 (1.4)
 * <p>
 * createProblem(dto)                         → Problem
 * addTestcase(problemId, input, expected, …) → Testcase
 * getProblemForStudent(problemId, contestId) → ProblemView  (sample tests only)
 */
@Service
public class ProblemService {

    private final ProblemRepository problemRepo;
    private final TestcaseRepository testcaseRepo;
    private final ContestProblemRepository contestProblemRepo;
    private final UserRepository userRepo;

    public ProblemService(ProblemRepository problemRepo,
                          TestcaseRepository testcaseRepo,
                          ContestProblemRepository contestProblemRepo,
                          UserRepository userRepo) {
        this.problemRepo = problemRepo;
        this.testcaseRepo = testcaseRepo;
        this.contestProblemRepo = contestProblemRepo;
        this.userRepo = userRepo;
    }

    // ── Create ────────────────────────────────────────────────────────────────

    @Transactional
    public Problem createProblem(CreateProblemRequest dto, UUID createdById) {
        User creator = userRepo.findById(createdById)
            .orElseThrow(() -> new NotFoundException("User not found: " + createdById));

        Problem p = new Problem();
        p.setTitle(dto.title());
        p.setStatementMd(dto.statementMd());
        p.setTimeLimitMs(dto.timeLimitMs() > 0 ? dto.timeLimitMs() : 2000);
        p.setMemoryLimitKb(dto.memoryLimitKb() > 0 ? dto.memoryLimitKb() : 262144);
        p.setCheckerType(dto.checkerType() != null ? dto.checkerType() : "EXACT");
        p.setCreatedBy(creator);

        return problemRepo.save(p);
    }
    // ── List ──────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<Problem> listAllProblems() {
        return problemRepo.findAll();
    }
    // ── Testcases ─────────────────────────────────────────────────────────────

    /**
     * Add a testcase.
     * inputRef / expectedRef are storage references (file paths or MinIO keys).
     * For the demo milestone, pass the content directly as small strings.
     */
    @Transactional
    public Testcase addTestcase(UUID problemId, String inputRef, String expectedRef,
                                int points, boolean isSample, Integer groupNo) {
        Problem problem = problemRepo.findById(problemId)
            .orElseThrow(() -> new NotFoundException("Problem not found: " + problemId));

        int nextOrdinal = testcaseRepo.findByProblemIdOrderByOrdinal(problemId).size() + 1;

        Testcase tc = new Testcase();
        tc.setProblem(problem);
        tc.setOrdinal(nextOrdinal);
        tc.setInputRef(inputRef);
        tc.setExpectedRef(expectedRef);
        tc.setPoints(points);
        tc.setSample(isSample);
        tc.setHidden(!isSample);
        tc.setGroupNo(groupNo);

        return testcaseRepo.save(tc);
    }

    // ── Student view ──────────────────────────────────────────────────────────

    /**
     * Return problem data safe for a student:
     * - full statement
     * - ONLY sample test cases (is_sample = true, is_hidden = false)
     * - NEVER hidden tests
     */
    @Transactional(readOnly = true)
    public ProblemView getProblemForStudent(UUID problemId, UUID contestId) {
        Problem p = problemRepo.findById(problemId)
            .orElseThrow(() -> new NotFoundException("Problem not found: " + problemId));

        // Verify problem is part of this contest
        if (!contestProblemRepo.existsByContestIdAndProblemId(contestId, problemId)) {
            throw new NotFoundException("Problem not found in contest");
        }

        List<Testcase> sampleTests = testcaseRepo
            .findByProblemIdAndIsSampleTrueOrderByOrdinal(problemId);

        List<ProblemView.SampleTestcase> samples = sampleTests.stream()
            .map(tc -> new ProblemView.SampleTestcase(tc.getId(), tc.getInputRef(), tc.getExpectedRef()))
            .toList();

        return new ProblemView(
            p.getId(), p.getTitle(), p.getStatementMd(),
            p.getTimeLimitMs(), p.getMemoryLimitKb(),
            samples
        );
    }

    // ── Exception ─────────────────────────────────────────────────────────────

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) { super(message); }
    }
}
