package com.codingexam.platform.model;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "submission_results")
public class SubmissionResult {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "submission_id", nullable = false)
    private Submission submission;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "testcase_id", nullable = false)
    private Testcase testcase;

    @Column(nullable = false, length = 10)
    private String verdict;

    @Column(name = "time_ms")
    private Integer timeMs;

    @Column(name = "memory_kb")
    private Integer memoryKb;

    @Column(name = "stdout_snippet", columnDefinition = "TEXT")
    private String stdoutSnippet;

    @Column(nullable = false)
    private int points = 0;

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Submission getSubmission() { return submission; }
    public void setSubmission(Submission submission) { this.submission = submission; }
    public Testcase getTestcase() { return testcase; }
    public void setTestcase(Testcase testcase) { this.testcase = testcase; }
    public String getVerdict() { return verdict; }
    public void setVerdict(String verdict) { this.verdict = verdict; }
    public Integer getTimeMs() { return timeMs; }
    public void setTimeMs(Integer timeMs) { this.timeMs = timeMs; }
    public Integer getMemoryKb() { return memoryKb; }
    public void setMemoryKb(Integer memoryKb) { this.memoryKb = memoryKb; }
    public String getStdoutSnippet() { return stdoutSnippet; }
    public void setStdoutSnippet(String stdoutSnippet) { this.stdoutSnippet = stdoutSnippet; }
    public int getPoints() { return points; }
    public void setPoints(int points) { this.points = points; }
}
