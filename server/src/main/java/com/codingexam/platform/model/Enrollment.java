package com.codingexam.platform.model;

import jakarta.persistence.*;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "enrollments")
public class Enrollment {

    @EmbeddedId
    private EnrollmentId id = new EnrollmentId();

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("contestId")
    @JoinColumn(name = "contest_id")
    private Contest contest;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "extra_time_sec", nullable = false)
    private int extraTimeSec = 0;

    @Column(nullable = false, length = 20)
    private String status = "ACTIVE";

    @Embeddable
    public static class EnrollmentId implements Serializable {
        private UUID contestId;
        private UUID userId;

        public EnrollmentId() {}
        public EnrollmentId(UUID contestId, UUID userId) {
            this.contestId = contestId;
            this.userId = userId;
        }

        public UUID getContestId() { return contestId; }
        public void setContestId(UUID contestId) { this.contestId = contestId; }
        public UUID getUserId() { return userId; }
        public void setUserId(UUID userId) { this.userId = userId; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof EnrollmentId that)) return false;
            return Objects.equals(contestId, that.contestId) && Objects.equals(userId, that.userId);
        }
        @Override
        public int hashCode() { return Objects.hash(contestId, userId); }
    }

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public EnrollmentId getId() { return id; }
    public void setId(EnrollmentId id) { this.id = id; }
    public Contest getContest() { return contest; }
    public void setContest(Contest contest) { this.contest = contest; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
    public int getExtraTimeSec() { return extraTimeSec; }
    public void setExtraTimeSec(int extraTimeSec) { this.extraTimeSec = extraTimeSec; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
