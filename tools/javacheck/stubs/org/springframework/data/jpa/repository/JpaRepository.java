package org.springframework.data.jpa.repository;
import java.util.*;
public interface JpaRepository<T, ID> { Optional<T> findById(ID id); <S extends T> S save(S s); }
