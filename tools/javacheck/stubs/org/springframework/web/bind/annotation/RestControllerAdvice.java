package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) public @interface RestControllerAdvice { boolean readOnly() default false; String value() default ""; }
