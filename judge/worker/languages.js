'use strict';
// Language table. `compile` returns null when there is no compile step.
// Timing factors give slow-startup runtimes extra headroom (override via env).
const env = (k, d) => process.env[k] || d;

const LANGUAGES = {
  C: {
    file: 'main.c',
    image: env('IMAGE_C', 'gcc:13'),
    compile: () => ['gcc', '-O2', '-std=gnu17', '-o', 'main', 'main.c', '-lm'],
    run: () => ['./main'],
    timeFactor: 1,
  },
  CPP: {
    file: 'main.cpp',
    image: env('IMAGE_CPP', 'gcc:13'),
    compile: () => ['g++', '-O2', '-std=gnu++17', '-o', 'main', 'main.cpp'],
    run: () => ['./main'],
    timeFactor: 1,
  },
  JAVA: {
    file: 'Main.java', // students must name their public class Main
    image: env('IMAGE_JAVA', 'eclipse-temurin:21-jdk'),
    compile: () => ['javac', '-encoding', 'UTF-8', 'Main.java'],
    run: (memMb) => ['java', `-Xmx${memMb}m`, '-Xss64m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', 'Main'],
    timeFactor: Number(env('TIME_FACTOR_JAVA', 2)),
    extraMemMb: 192, // JVM overhead on top of -Xmx
  },
  PYTHON: {
    file: 'main.py',
    image: env('IMAGE_PYTHON', 'python:3.12-slim'),
    compile: () => null,
    run: () => ['python3', '-B', 'main.py'],
    timeFactor: Number(env('TIME_FACTOR_PYTHON', 2)),
  },
};

module.exports = { LANGUAGES };
