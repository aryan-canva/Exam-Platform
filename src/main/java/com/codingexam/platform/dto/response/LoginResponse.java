package com.codingexam.platform.dto.response;

import java.util.UUID;

public record LoginResponse(
    String accessToken,
    String refreshToken,
    UserDTO user
) {
    public record UserDTO(UUID id, String username, String role, String fullName) {}
}
