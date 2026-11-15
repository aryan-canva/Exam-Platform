package org.springframework.jdbc.core;
import java.util.*;
public class JdbcTemplate {
  public List<Map<String,Object>> queryForList(String sql, Object... args) { return new ArrayList<>(); }
  public <T> List<T> queryForList(String sql, Class<T> c, Object... args) { return new ArrayList<>(); }
  public int update(String sql, Object... args) { return 0; }
  public <T> T queryForObject(String sql, Class<T> c, Object... args) { return null; }
}
