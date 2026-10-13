package com.codingexam.platform.repository;

import com.codingexam.platform.model.Contest;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface ContestRepository extends JpaRepository<Contest, UUID> {
}
