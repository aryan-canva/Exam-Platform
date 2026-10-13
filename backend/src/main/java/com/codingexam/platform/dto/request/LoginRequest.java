package com.codingexam.platform.dto.request;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
    @NotBlank String username,
    @NotBlank String password,
    String deviceFp   // optional device fingerprint
) {}
