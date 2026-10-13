package com.codingexam.platform.repository;

import com.codingexam.platform.model.Problem;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface ProblemRepository extends JpaRepository<Problem, UUID> {
}
