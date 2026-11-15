package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) public @interface Service { boolean readOnly() default false; String value() default ""; }
