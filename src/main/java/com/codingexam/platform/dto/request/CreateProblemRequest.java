package com.codingexam.platform.dto.request;

import jakarta.validation.constraints.NotBlank;

public record CreateProblemRequest(
    @NotBlank String title,
    @NotBlank String statementMd,
    int timeLimitMs,
    int memoryLimitKb,
    String checkerType
) {}
