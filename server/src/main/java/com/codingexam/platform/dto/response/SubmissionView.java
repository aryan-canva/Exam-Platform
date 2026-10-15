package com.codingexam.platform.dto.response;

import com.codingexam.platform.model.Submission;
import java.time.Instant;
import java.util.UUID;

public record SubmissionView(
    UUID id,
    UUID problemId,
    String language,
    String status,
    String verdict,
    int score,
    Integer runtimeMs,
    Integer memoryKb,
    Instant createdAt,
    Instant judgedAt
) {
    public static SubmissionView from(Submission s) {
        return new SubmissionView(
            s.getId(),
            s.getProblem().getId(),
            s.getLanguage(),
            s.getStatus(),
            s.getVerdict(),
            s.getScore(),
            s.getRuntimeMs(),
            s.getMemoryKb(),
            s.getCreatedAt(),
            s.getJudgedAt()
        );
    }
}