package com.codingexam.platform.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Enables @Scheduled (used by JudgeQueueService to re-queue jobs whose worker vanished). */
@Configuration
@EnableScheduling
public class JudgeConfig {}
