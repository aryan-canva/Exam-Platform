package com.codingexam.platform.repository;

import com.codingexam.platform.model.Testcase;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface TestcaseRepository extends JpaRepository<Testcase, UUID> {
    List<Testcase> findByProblemIdOrderByOrdinal(UUID problemId);
    List<Testcase> findByProblemIdAndIsSampleTrueOrderByOrdinal(UUID problemId);
}
