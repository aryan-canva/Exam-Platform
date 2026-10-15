package com.codingexam.platform.service;

import com.codingexam.platform.model.*;
import com.codingexam.platform.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
public class SessionService {

    private final SessionRepository sessionRepo;
    private final ContestRepository contestRepo;
    private final UserRepository userRepo;
    private final EnrollmentRepository enrollmentRepo;

    public SessionService(SessionRepository sessionRepo,
                          ContestRepository contestRepo,
                          UserRepository userRepo,
                          EnrollmentRepository enrollmentRepo) {
        this.sessionRepo    = sessionRepo;
        this.contestRepo    = contestRepo;
        this.userRepo       = userRepo;
        this.enrollmentRepo = enrollmentRepo;
    }

    @Transactional
    public Session startSession(UUID contestId, UUID userId,
                                String deviceFp, String clientVersion) {
        Optional<Session> existing = sessionRepo.findByContestIdAndUserId(contestId, userId);
        if (existing.isPresent()) {
            Session s = existing.get();
            if (s.getStatus() == Session.Status.ACTIVE) {
                s.setLastHeartbeatAt(Instant.now());
                return sessionRepo.save(s);
            }
            if (s.getStatus() == Session.Status.ENDED || s.getStatus() == Session.Status.TERMINATED) {
                throw new ConflictException("Session already ended for this contest");
            }
        }

        Contest contest = contestRepo.findById(contestId)
            .orElseThrow(() -> new NotFoundException("Contest not found: " + contestId));
                if (contest.getStatus() != Contest.Status.RUNNING) {
                    throw new ConflictException("Contest is not currently RUNNING (status: " + contest.getStatus() + ")");
                }
        if (!enrollmentRepo.existsByContestIdAndUserId(contestId, userId)) {
            throw new ForbiddenException("Not enrolled in this contest");
        }

        User user = userRepo.findById(userId)
            .orElseThrow(() -> new NotFoundException("User not found: " + userId));

        Session session = new Session();
        session.setContest(contest);
        session.setUser(user);
        session.setDeviceFp(deviceFp);
        session.setClientVersion(clientVersion);
        session.setStatus(Session.Status.ACTIVE);
        session.setLastHeartbeatAt(Instant.now());
        session.setLastSeq(0L);

        return sessionRepo.save(session);
    }

    @Transactional
    public Session heartbeat(UUID sessionId, UUID userId, long seq) {
        Session session = getActiveSessionOrThrow(sessionId, userId);
        if (seq <= session.getLastSeq()) {
            throw new ConflictException("Heartbeat seq must be greater than last seq");
        }
        session.setLastHeartbeatAt(Instant.now());
        session.setLastSeq(seq);
        return sessionRepo.save(session);
    }

    @Transactional
    public Session endSession(UUID sessionId, UUID userId) {
        Session session = getActiveSessionOrThrow(sessionId, userId);
        session.setStatus(Session.Status.ENDED);
        session.setEndedAt(Instant.now());
        return sessionRepo.save(session);
    }

    @Transactional(readOnly = true)
    public Session getSession(UUID sessionId, UUID userId) {
        Session session = sessionRepo.findById(sessionId)
            .orElseThrow(() -> new NotFoundException("Session not found: " + sessionId));
        if (!session.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Session does not belong to this user");
        }
        return session;
    }

    private Session getActiveSessionOrThrow(UUID sessionId, UUID userId) {
        Session session = sessionRepo.findById(sessionId)
            .orElseThrow(() -> new NotFoundException("Session not found: " + sessionId));
        if (!session.getUser().getId().equals(userId)) {
            throw new ForbiddenException("Session does not belong to this user");
        }
        if (session.getStatus() != Session.Status.ACTIVE) {
            throw new ConflictException("Session is not ACTIVE (status: " + session.getStatus() + ")");
        }
        return session;
    }

    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String msg) { super(msg); }
    }
    public static class ConflictException extends RuntimeException {
        public ConflictException(String msg) { super(msg); }
    }
    public static class ForbiddenException extends RuntimeException {
        public ForbiddenException(String msg) { super(msg); }
    }
}