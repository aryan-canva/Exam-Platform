package jakarta.persistence;
public @interface UniqueConstraint { String[] columnNames() default {}; }
