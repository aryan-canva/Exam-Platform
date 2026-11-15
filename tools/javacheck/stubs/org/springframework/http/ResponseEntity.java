package org.springframework.http;
public class ResponseEntity<T> {
  public static <T> ResponseEntity<T> ok(T b) { return new ResponseEntity<>(); }
  public static BodyBuilder ok() { return new BodyBuilder(); }
  public static BodyBuilder status(HttpStatus s) { return new BodyBuilder(); }
  public static class BodyBuilder { public <T> ResponseEntity<T> build() { return new ResponseEntity<>(); } public <T> ResponseEntity<T> body(T b) { return new ResponseEntity<>(); } }
}
