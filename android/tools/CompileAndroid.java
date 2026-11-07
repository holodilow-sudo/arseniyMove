import java.io.File;
import java.nio.file.AccessDeniedException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/** Uses the supported compiler API and reports compilation separately from ZIP cleanup. */
class CompileAndroid {
    public static void main(String[] args) throws Exception {
        if (args.length < 3) throw new IllegalArgumentException("SDK jar, output directory, source files required");
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("Full JDK required");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, java.nio.charset.StandardCharsets.UTF_8);
        List<File> sources = new ArrayList<>();
        for (int i = 2; i < args.length; i++) sources.add(new File(args[i]));
        boolean compiled = Boolean.TRUE.equals(compiler.getTask(null, files, diagnostics,
                Arrays.asList("-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", args[0], "-classpath", args[0], "-d", args[1]),
                null, files.getJavaFileObjectsFromFiles(sources)).call());
        for (Diagnostic<?> diagnostic : diagnostics.getDiagnostics()) System.err.println(diagnostic);
        files.flush();
        try {
            files.close();
        } catch (AccessDeniedException cleanupError) {
            // WindowsLinkSupport.toRealPath can fail after ZipFileSystem has
            // already closed its readable SDK archive. This does not change
            // the compiler task result. Remaining handles end with this JVM.
            System.err.println("SDK ZIP cleanup warning after compilation: " + cleanupError);
        }
        if (!compiled) System.exit(1);
        System.out.println("Android Java compilation: SUCCESS (compiler task returned true)");
    }
}
