package com.codingexam.platform.model;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "testcases",
       uniqueConstraints = @UniqueConstraint(columnNames = {"problem_id", "ordinal"}))
public class Testcase {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "problem_id", nullable = false)
    private Problem problem;

    @Column(nullable = false)
    private int ordinal;

    @Column(name = "input_ref", nullable = false)
    private String inputRef;

    @Column(name = "expected_ref", nullable = false)
    private String expectedRef;

    @Column(name = "group_no")
    private Integer groupNo;

    @Column(nullable = false)
    private int points = 0;

    @Column(name = "is_sample", nullable = false)
    private boolean isSample = false;

    @Column(name = "is_hidden", nullable = false)
    private boolean isHidden = true;

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Problem getProblem() { return problem; }
    public void setProblem(Problem problem) { this.problem = problem; }
    public int getOrdinal() { return ordinal; }
    public void setOrdinal(int ordinal) { this.ordinal = ordinal; }
    public String getInputRef() { return inputRef; }
    public void setInputRef(String inputRef) { this.inputRef = inputRef; }
    public String getExpectedRef() { return expectedRef; }
    public void setExpectedRef(String expectedRef) { this.expectedRef = expectedRef; }
    public Integer getGroupNo() { return groupNo; }
    public void setGroupNo(Integer groupNo) { this.groupNo = groupNo; }
    public int getPoints() { return points; }
    public void setPoints(int points) { this.points = points; }
    public boolean isSample() { return isSample; }
    public void setSample(boolean sample) { isSample = sample; }
    public boolean isHidden() { return isHidden; }
    public void setHidden(boolean hidden) { isHidden = hidden; }
}
