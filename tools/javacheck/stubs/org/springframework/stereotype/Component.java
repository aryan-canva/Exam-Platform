package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) public @interface Component { boolean readOnly() default false; String value() default ""; }
