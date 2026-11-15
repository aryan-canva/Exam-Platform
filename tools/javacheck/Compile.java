import javax.tools.*;
import java.util.*;
import java.io.*;
public class Compile {
  public static void main(String[] a) throws Exception {
    JavaCompiler c = ToolProvider.getSystemJavaCompiler();
    if (c == null) { System.out.println("NO COMPILER"); System.exit(2); }
    // args: outDir sourcepath files...
    List<String> opts = new ArrayList<>(List.of("-d", a[0], "-sourcepath", a[1], "-proc:none", "-Xlint:-options", "-implicit:class"));
    StandardJavaFileManager fm = c.getStandardFileManager(null, null, null);
    List<File> files = new ArrayList<>(); for (int i = 2; i < a.length; i++) files.add(new File(a[i]));
    DiagnosticCollector<JavaFileObject> d = new DiagnosticCollector<>();
    boolean ok = c.getTask(null, fm, d, opts, null, fm.getJavaFileObjectsFromFiles(files)).call();
    for (Diagnostic<?> x : d.getDiagnostics()) if (x.getKind() == Diagnostic.Kind.ERROR) System.out.println(x.getSource() == null ? x.getMessage(null) : ((JavaFileObject) x.getSource()).getName().replaceAll(".*/platform/", "") + ":" + x.getLineNumber() + ": " + x.getMessage(null));
    System.out.println(ok ? "COMPILE OK" : "COMPILE FAILED");
  }
}
