import java.lang.reflect.*;
public class Run {
  public static void main(String[] a) throws Exception {
    int pass = 0, fail = 0;
    for (String cn : a) {
      Class<?> c = Class.forName(cn); Constructor<?> k = c.getDeclaredConstructor(); k.setAccessible(true);
      for (Method m : c.getDeclaredMethods()) {
        if (!m.isAnnotationPresent(org.junit.jupiter.api.Test.class)) continue;
        Object o = k.newInstance();
        try {
          for (Method b : c.getDeclaredMethods()) if (b.isAnnotationPresent(org.junit.jupiter.api.BeforeEach.class)) { b.setAccessible(true); b.invoke(o); }
          m.setAccessible(true); m.invoke(o); pass++; System.out.println("PASS " + c.getSimpleName() + "." + m.getName());
        } catch (InvocationTargetException e) { fail++; System.out.println("FAIL " + c.getSimpleName() + "." + m.getName() + " -> " + e.getCause()); }
      }
    }
    System.out.println(pass + " passed, " + fail + " failed"); System.exit(fail == 0 ? 0 : 1);
  }
}
