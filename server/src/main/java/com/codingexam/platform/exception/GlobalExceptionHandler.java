package com.codingexam.platform.exception;

import com.codingexam.platform.security.AuthContext;
import com.codingexam.platform.service.AuthService;
import com.codingexam.platform.service.ContestService;
import com.codingexam.platform.service.EventService;
import com.codingexam.platform.service.PolicyService;
import com.codingexam.platform.service.ProblemService;
import com.codingexam.platform.service.SessionService;
import com.codingexam.platform.service.SubmissionService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler({
        ProblemService.NotFoundException.class,
        ContestService.NotFoundException.class,
        PolicyService.NotFoundException.class,
        SessionService.NotFoundException.class,
        SubmissionService.NotFoundException.class,
        EventService.NotFoundException.class
    })
    public ResponseEntity<Map<String, Object>> handleNotFound(RuntimeException ex) {
        return error(HttpStatus.NOT_FOUND, "NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler({
        ContestService.ConflictException.class,
        SessionService.ConflictException.class,
        SubmissionService.ConflictException.class,
        EventService.ConflictException.class
    })
    public ResponseEntity<Map<String, Object>> handleConflict(RuntimeException ex) {
        return error(HttpStatus.CONFLICT, "CONFLICT", ex.getMessage());
    }

    @ExceptionHandler({
        AuthContext.ForbiddenException.class,
        ContestService.ForbiddenException.class,
        SessionService.ForbiddenException.class,
        SubmissionService.ForbiddenException.class,
        EventService.ForbiddenException.class
    })
    public ResponseEntity<Map<String, Object>> handleForbidden(RuntimeException ex) {
        return error(HttpStatus.FORBIDDEN, "FORBIDDEN", ex.getMessage());
    }

    @ExceptionHandler(AuthService.AuthException.class)
    public ResponseEntity<Map<String, Object>> handleAuth(AuthService.AuthException ex) {
        return error(HttpStatus.UNAUTHORIZED, "AUTH_INVALID", ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", ex.getMessage());
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
            "code", code,
            "message", message != null ? message : "An error occurred",
            "timestamp", Instant.now().toString()
        ));
    }
}