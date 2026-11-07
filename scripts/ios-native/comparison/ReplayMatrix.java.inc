import java.awt.Point;
import java.awt.image.BufferedImage;
import java.lang.management.ManagementFactory;
import java.lang.reflect.*;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.*;
import java.util.*;

/** Replay of region-work input only. Binary surrogate images are not the original screenshots. */
public class ReplayMatrix {
    static final java.lang.management.ThreadMXBean CPU = ManagementFactory.getThreadMXBean();
    static Object field(Object instance, String name) throws Exception {
        Field field = instance.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(instance);
    }
    static Class<?> load(Path first, Path original) throws Exception {
        return new URLClassLoader(new URL[] {first.toUri().toURL(), original.toUri().toURL()}, ClassLoader.getPlatformClassLoader())
            .loadClass("com.github.romankh3.image.comparison.ImageComparison");
    }
    static final class Result {
        final String rectangles, error;
        final int[][] matrix;
        final int counter, regions;
        Result(Object object, List<?> values, Throwable failure) throws Exception {
            StringBuilder out = new StringBuilder();
            if (values != null) for (Object rectangle : values) {
                Point min = (Point) rectangle.getClass().getMethod("getMinPoint").invoke(rectangle);
                Point max = (Point) rectangle.getClass().getMethod("getMaxPoint").invoke(rectangle);
                out.append(min.x).append(':').append(min.y).append(':').append(max.x).append(':').append(max.y).append(';');
            }
            rectangles = out.toString(); error = failure == null ? "" : failure.getClass().getName();
            matrix = (int[][]) field(object, "matrix");
            counter = (Integer) field(object, "counter"); regions = (Integer) field(object, "regionCount");
        }
        void same(Result other) {
            if (!rectangles.equals(other.rectangles) || !error.equals(other.error) || counter != other.counter || regions != other.regions ||
                !Arrays.deepEquals(matrix, other.matrix)) throw new AssertionError("REGION_ORACLE_DIFFERENCE");
        }
    }
    static Object object(Class<?> cls, BufferedImage expected, BufferedImage actual) throws Exception {
        return cls.getConstructor(BufferedImage.class, BufferedImage.class).newInstance(expected, actual);
    }
    static Result run(Class<?> cls, BufferedImage expected, BufferedImage actual, boolean timed, String name, int trial) throws Exception {
        Object comparison = object(cls, expected, actual);
        long cpu = CPU.getCurrentThreadCpuTime(), start = System.nanoTime();
        List<?> rectangles = null; Throwable failure = null;
        try { rectangles = (List<?>) cls.getMethod("createMask").invoke(comparison); }
        catch (InvocationTargetException error) { failure = error.getCause(); }
        long elapsed = System.nanoTime() - start, endCpu = CPU.getCurrentThreadCpuTime();
        // Verification and serialization are outside the timed original method call.
        Result result = new Result(comparison, rectangles, failure);
        if (timed) System.out.println("{\"kind\":\"trial\",\"mode\":\"" + name + "\",\"trial\":" + trial +
            ",\"elapsedNs\":" + elapsed + ",\"cpuNs\":" + (cpu >= 0 && endCpu >= cpu ? Long.toString(endCpu - cpu) : "null") + "}");
        return result;
    }
    public static void main(String[] args) throws Exception {
        if ("1".equals(System.getenv("THIRDROLL_COMPARISON_CAPTURE"))) throw new AssertionError("offline capture must be disabled");
        Path original = Path.of(args[0]), rebuilt = Path.of(args[1]), candidate = Path.of(args[2]), profile = Path.of(args[3]);
        byte[] packed = Files.readAllBytes(Path.of(args[4]));
        int width = Integer.parseInt(args[5]), height = Integer.parseInt(args[6]);
        long cells = (long) width * height;
        if (width < 1 || height < 1 || width > 8192 || height > 8192 || cells > 8_000_000 || packed.length != (cells + 7) / 8)
            throw new AssertionError("bounded binary state required");
        BufferedImage expected = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        BufferedImage actual = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        long count = 0;
        for (int i = 0; i < cells; i++) if (((packed[i >>> 3] >>> (i & 7)) & 1) != 0) {
            actual.setRGB(i % width, i / width, -1); count++;
        }
        Class<?>[] implementations = {load(original, original), load(rebuilt, original), load(candidate, original), load(profile, original)};
        String[] names = {"release", "unmodified-rebuild", "candidate", "profiled-candidate"};
        Object check = object(implementations[0], expected, actual);
        Method populate = implementations[0].getDeclaredMethod("populateTheMatrixOfTheDifferences"); populate.setAccessible(true);
        if (((Long) populate.invoke(check)) != count) throw new AssertionError("count reconstruction failed");
        int[][] binary = (int[][]) field(check, "matrix");
        for (int i = 0; i < cells; i++) if (binary[i / width][i % width] != ((packed[i >>> 3] >>> (i & 7)) & 1))
            throw new AssertionError("matrix reconstruction failed");
        Result golden = run(implementations[0], expected, actual, false, names[0], -1);
        for (int i = 1; i < implementations.length; i++) golden.same(run(implementations[i], expected, actual, false, names[i], -1));
        // Two warmups and four timed calls per implementation, balanced cyclic order.
        for (int round = 0; round < 2; round++) for (int offset = 0; offset < 4; offset++) {
            int i = (round + offset) % 4; golden.same(run(implementations[i], expected, actual, false, names[i], -1));
        }
        for (int round = 0; round < 4; round++) for (int offset = 0; offset < 4; offset++) {
            int i = (round + offset) % 4; golden.same(run(implementations[i], expected, actual, true, names[i], round));
        }
        Class<?> hooks = implementations[3].getClassLoader().loadClass("com.github.romankh3.image.comparison.ProfileHooks");
        Class<?> bridge = implementations[3].getClassLoader().loadClass("maestro.QualificationComparisonCapture");
        if (bridge.getField("calls").getInt(null) != 0) throw new AssertionError("offline capture branch executed");
        System.out.println("{\"kind\":\"profile\",\"phases\":" + hooks.getMethod("summary").invoke(null) + "}");
        System.out.println("{\"kind\":\"result\",\"regionOracleEquivalent\":true,\"fullComparatorEquivalence\":false," +
            "\"cells\":" + cells + ",\"count\":" + count + ",\"verificationMaskCalls\":4,\"warmupMaskCalls\":8,\"timedMaskCalls\":16," +
            "\"additionalReleaseMatrixChecks\":1,\"exceptionClass\":\"" + golden.error + "\"}");
    }
}
