package com.codingexam.platform.model;

import jakarta.persistence.*;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "contest_problems")
public class ContestProblem {

    @EmbeddedId
    private ContestProblemId id = new ContestProblemId();

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("contestId")
    @JoinColumn(name = "contest_id")
    private Contest contest;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("problemId")
    @JoinColumn(name = "problem_id")
    private Problem problem;

    @Column(nullable = false, length = 10)
    private String label;

    @Column(nullable = false)
    private int points = 100;

    @Embeddable
    public static class ContestProblemId implements Serializable {
        private UUID contestId;
        private UUID problemId;

        public ContestProblemId() {}
        public ContestProblemId(UUID contestId, UUID problemId) {
            this.contestId = contestId;
            this.problemId = problemId;
        }

        public UUID getContestId() { return contestId; }
        public void setContestId(UUID contestId) { this.contestId = contestId; }
        public UUID getProblemId() { return problemId; }
        public void setProblemId(UUID problemId) { this.problemId = problemId; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ContestProblemId that)) return false;
            return Objects.equals(contestId, that.contestId) && Objects.equals(problemId, that.problemId);
        }
        @Override
        public int hashCode() { return Objects.hash(contestId, problemId); }
    }

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public ContestProblemId getId() { return id; }
    public void setId(ContestProblemId id) { this.id = id; }
    public Contest getContest() { return contest; }
    public void setContest(Contest contest) { this.contest = contest; }
    public Problem getProblem() { return problem; }
    public void setProblem(Problem problem) { this.problem = problem; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public int getPoints() { return points; }
    public void setPoints(int points) { this.points = points; }
}
