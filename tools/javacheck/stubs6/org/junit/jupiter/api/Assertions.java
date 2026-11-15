package org.junit.jupiter.api;
import org.junit.jupiter.api.function.Executable;
public class Assertions {
  public static void assertEquals(Object e, Object a) { if (!java.util.Objects.equals(e, a)) throw new AssertionError("expected <" + e + "> but was <" + a + ">"); }
  public static void assertEquals(Object e, Object a, String m) { if (!java.util.Objects.equals(e, a)) throw new AssertionError(m + ": expected <" + e + "> but was <" + a + ">"); }
  public static void assertNotEquals(Object e, Object a) { if (java.util.Objects.equals(e, a)) throw new AssertionError("expected different from <" + e + ">"); }
  public static void assertTrue(boolean c) { if (!c) throw new AssertionError("expected true"); }
  public static void assertTrue(boolean c, String m) { if (!c) throw new AssertionError(m); }
  public static void assertFalse(boolean c) { if (c) throw new AssertionError("expected false"); }
  public static <T extends Throwable> T assertThrows(Class<T> t, Executable x) { try { x.execute(); } catch (Throwable e) { if (t.isInstance(e)) return t.cast(e); throw new AssertionError("expected " + t.getSimpleName() + " but got " + e); } throw new AssertionError("expected " + t.getSimpleName() + " but nothing was thrown"); }
}
