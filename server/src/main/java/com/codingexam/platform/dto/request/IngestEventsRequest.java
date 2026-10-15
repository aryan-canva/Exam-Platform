package com.codingexam.platform.dto.request;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record IngestEventsRequest(
    @NotNull UUID sessionId,
    @NotEmpty List<EventDto> events
) {
    public record EventDto(
        long seq,
        @NotNull String type,
        String severity,
        @NotNull Instant ts,
        String payloadJson,
        String prevHash,
        @NotNull String hash,
        @NotNull String hmac
    ) {}
}