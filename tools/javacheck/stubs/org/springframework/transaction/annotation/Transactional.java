package org.springframework.transaction.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) public @interface Transactional { boolean readOnly() default false; String value() default ""; }
