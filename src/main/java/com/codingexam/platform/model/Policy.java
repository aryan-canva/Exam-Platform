package com.codingexam.platform.model;

import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "policies",
       uniqueConstraints = @UniqueConstraint(columnNames = {"contest_id", "version"}))
public class Policy {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "contest_id", nullable = false)
    private Contest contest;

    @Column(nullable = false)
    private int version = 1;

    @Column(nullable = false, columnDefinition = "jsonb")
    private String json;

    @Column(nullable = false, columnDefinition = "bytea")
    private byte[] signature;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public Contest getContest() { return contest; }
    public void setContest(Contest contest) { this.contest = contest; }
    public int getVersion() { return version; }
    public void setVersion(int version) { this.version = version; }
    public String getJson() { return json; }
    public void setJson(String json) { this.json = json; }
    public byte[] getSignature() { return signature; }
    public void setSignature(byte[] signature) { this.signature = signature; }
    public Instant getCreatedAt() { return createdAt; }
}
