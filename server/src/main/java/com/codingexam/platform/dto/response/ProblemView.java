package com.codingexam.platform.dto.response;

import java.util.List;
import java.util.UUID;

public record ProblemView(
    UUID id,
    String title,
    String statementMd,
    int timeLimitMs,
    int memoryLimitKb,
    List<SampleTestcase> sampleTestcases
) {
    public record SampleTestcase(UUID id, String inputRef, String expectedRef) {}
}
