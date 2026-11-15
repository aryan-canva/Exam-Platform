package org.springframework.web.bind.annotation;
public @interface ExceptionHandler { Class<?>[] value() default {}; }
