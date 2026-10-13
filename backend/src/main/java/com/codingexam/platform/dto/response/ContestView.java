package com.codingexam.platform.dto.response;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ContestView(
    UUID id,
    String title,
    String status,
    Instant startsAt,
    Instant endsAt,
    int durationSec,
    List<ProblemSummary> problems
) {
    public record ProblemSummary(UUID id, String label, String title, int points) {}
}
