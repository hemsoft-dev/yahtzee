import com.github.romankh3.image.comparison.ImageComparison;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import maestro.QualificationSettleObservation;

/** Real released/candidate comparator calls, not a replacement implementation. */
public class CaptureForwarding {
    static final RuntimeException MARKER = new IllegalStateException("owned-control-marker");
    static class Image extends BufferedImage {
        int reads;
        final boolean throwing;
        Image(boolean throwing) { super(4, 4, TYPE_INT_ARGB); this.throwing = throwing; }
        @Override public int getRGB(int x, int y) {
            reads++;
            if (throwing && x == 2 && y == 1) throw MARKER;
            return super.getRGB(x, y);
        }
    }
    public static void main(String[] args) throws Exception {
        Image expected = new Image(false), actual = new Image(false);
        for (int y = 1; y < 3; y++) for (int x = 1; x < 3; x++) actual.setRGB(x, y, -1);
        int size = QualificationSettleObservation.INSTANCE.observe(1, () ->
            QualificationSettleObservation.INSTANCE.device(6, () -> new ImageComparison(expected, actual).createMask().size()));
        if (size != 1 || expected.reads != 16 || actual.reads != 16) throw new AssertionError("original call/order/result changed");
        System.out.println("ORIGINAL_MASK_RETURNED rectangles=1 reads=16/16");
        // This occurs after original grouping has already mutated its own matrix.
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) actual.setRGB(x, y, 0);
        try {
            QualificationSettleObservation.INSTANCE.observe(1, () ->
                QualificationSettleObservation.INSTANCE.device(6, () -> new ImageComparison(expected, new Image(true)).createMask()));
            throw new AssertionError("missing original exception");
        } catch (RuntimeException error) {
            if (error != MARKER) throw new AssertionError("original error identity changed");
        }
        if (!QualificationSettleObservation.INSTANCE.drainControl()) throw new AssertionError("control drain");
        Path directory = Path.of(args[0]);
        if (!Files.exists(directory.resolve("matrix.json"))) throw new AssertionError("MISSING_COMPARISON_CAPTURE");
        byte[] packed = Files.readAllBytes(directory.resolve("matrix.bin"));
        if (!java.util.Arrays.equals(packed, new byte[] {96, 6})) throw new AssertionError("snapshot mutated or extra image read");
        String metadata = Files.readString(directory.resolve("matrix.json"));
        if (!metadata.contains("\"count\":4") || !metadata.contains("\"stage\":6")) throw new AssertionError("wrong finite state");
        System.out.println("CAPTURE_FORWARDING_PASS result=true getterOrder=true exceptionIdentity=true immutable=true");
    }
}
