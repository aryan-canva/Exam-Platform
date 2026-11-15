package com.codingexam.platform.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/** ts is the exact text that was signed (yyyy-MM-ddTHH:mm:ss.SSSZ), so it is kept as a String, not parsed by Jackson. */
public record IngestEventsRequest(
    @NotNull UUID sessionId,
    @NotEmpty @Size(max = 200) List<@Valid EventDto> events
) {
    public record EventDto(
        long seq,
        @NotNull String type,
        String severity,
        @NotNull String ts,
        @NotNull @Size(max = 8192) String payloadJson,
        @NotNull String prevHash,
        @NotNull String hash,
        @NotNull String hmac
    ) {}
}
