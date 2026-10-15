package com.codingexam.platform.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record SubmitRequest(
    @NotNull UUID sessionId,
    @NotNull UUID contestId,
    @NotNull UUID problemId,
    @NotBlank String language,
    @NotBlank String sourceCode
) {}