package com.codingexam.platform.dto.request;

import jakarta.validation.constraints.NotBlank;
import java.time.Instant;

public record CreateContestRequest(
    @NotBlank String title,
    int durationSec,
    String scoringMode,
    Instant startsAt,
    Instant endsAt
) {}
