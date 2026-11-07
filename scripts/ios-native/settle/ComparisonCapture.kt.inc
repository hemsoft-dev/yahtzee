package maestro

import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.OpenOption
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Binary working-state only. No images, extra reads, original-call I/O or new worker. */
internal object QualificationComparisonCapture {
    const val MAX_CELLS = 8_000_000
    const val MAX_BYTES = 1_000_000
    const val COPY_NS = 200_000_000L
    const val WRITE_NS = 500_000_000L
    private val claimed = AtomicBoolean()
    private val seen = AtomicInteger()
    @Volatile private var clock: () -> Long = System::nanoTime
    @Volatile private var testRoot: Path? = null
    @Volatile private var testIdentity: Boolean = false
    @Volatile private var testWrite: ((Path, ByteArray) -> Unit)? = null

    private data class Identity(val root: Path, val source: String, val run: String, val attempt: String, val route: Int)
    private fun identity(): Identity? {
        if (testIdentity) return testRoot?.let { Identity(it, "a".repeat(40), "1", "1", 1) }
        if (System.getenv("THIRDROLL_COMPARISON_CAPTURE") != "1") return null
        val source = System.getenv("THIRDROLL_CAPTURE_SOURCE") ?: return null
        val run = System.getenv("GITHUB_RUN_ID") ?: return null
        val attempt = System.getenv("GITHUB_RUN_ATTEMPT") ?: return null
        val route = System.getenv("THIRDROLL_CAPTURE_ROUTE")?.toIntOrNull() ?: return null
        val directory = System.getenv("THIRDROLL_CAPTURE_DIRECTORY") ?: return null
        if (!source.matches(Regex("[0-9a-f]{40}")) || !run.matches(Regex("[0-9]{1,20}")) ||
            !attempt.matches(Regex("[0-9]{1,20}")) || route !in 1..2) return null
        val root = Path.of(directory)
        if (!root.isAbsolute || root.fileName.toString() != ".comparison-input") return null
        return Identity(root, source, run, attempt, route)
    }

    private fun inBudget(start: Long, budget: Long): Boolean {
        val end = clock()
        return start >= 0 && end >= start && end - start <= budget
    }

    private fun write(path: Path, bytes: ByteArray, start: Long) {
        testWrite?.let { it(path, bytes); return }
        check(Files.isDirectory(path.parent, LinkOption.NOFOLLOW_LINKS))
        val options = setOf<OpenOption>(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)
        val permissions = PosixFilePermissions.asFileAttribute(setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE))
        Files.newByteChannel(path, options, permissions).use { channel ->
            var offset = 0
            while (offset < bytes.size) {
                check(inBudget(start, WRITE_NS))
                val buffer = ByteBuffer.wrap(bytes, offset, minOf(8192, bytes.size - offset))
                val written = channel.write(buffer)
                check(written > 0)
                offset += written
            }
        }
        check(inBudget(start, WRITE_NS))
    }

    private fun metadata(id: Identity, context: LongArray, code: Int, ordinal: Int, extra: String = ""): String =
        "{\"v\":1,\"source\":\"${id.source}\",\"runId\":\"${id.run}\",\"attempt\":\"${id.attempt}\",\"route\":${id.route}," +
        "\"pid\":${ProcessHandle.current().pid()},\"stage\":6,\"id\":${context[0]},\"parentId\":${context[1]}," +
        "\"code\":$code,\"seenAtCopy\":$ordinal,\"omissionsAfterCopy\":null$extra}\n"

    private fun unavailable(id: Identity, context: LongArray, code: Int, ordinal: Int) {
        // One finite first-attempt status. It is not a complete-process summary.
        if (ordinal != 1 && !claimed.get()) return
        QualificationSettleObservation.offerComparisonWrite {
            try {
                val start = clock()
                write(id.root.resolve(if (ordinal == 1) "first.json" else "attempt.json"), metadata(id, context, code, ordinal).toByteArray(Charsets.UTF_8), start)
            } catch (_: Throwable) { /* Missing or partial status remains unavailable. */ }
        }
    }

    @JvmStatic
    fun snapshot(matrix: Array<IntArray>, count: Long, counter: Int, regions: Int, threshold: Int, minimum: Int?, allowing: Double) {
        try {
            val id = identity() ?: return
            val context = QualificationSettleObservation.comparisonContext() ?: return
            if (context.size != 2 || context[0] !in 1..128 || context[1] !in 1..128) return
            val ordinal = seen.incrementAndGet()
            if (ordinal > 128 || claimed.get()) return
            if (!claimed.compareAndSet(false, true)) return
            if (counter != 2 || regions != 2 || threshold != 5 || minimum != 1 || allowing != 0.0) {
                unavailable(id, context, 2, ordinal); return
            }
            val height = matrix.size
            val width = matrix.firstOrNull()?.size ?: 0
            val cells = width.toLong() * height
            if (height !in 1..8192 || width !in 1..8192 || cells !in 1..MAX_CELLS.toLong() || count !in 0..cells) {
                unavailable(id, context, 3, ordinal); return
            }
            val start = clock()
            val packed = ByteArray(((cells + 7) / 8).toInt())
            var index = 0
            var ones = 0L
            for (row in matrix) {
                if (row.size != width || !inBudget(start, COPY_NS)) { unavailable(id, context, 4, ordinal); return }
                for (value in row) {
                    if (value != 0 && value != 1) { unavailable(id, context, 5, ordinal); return }
                    if (value == 1) {
                        packed[index ushr 3] = (packed[index ushr 3].toInt() or (1 shl (index and 7))).toByte()
                        ones++
                    }
                    index++
                }
            }
            val end = clock()
            if (ones != count || end < start || end - start > COPY_NS || !inBudget(start, COPY_NS)) { unavailable(id, context, 4, ordinal); return }
            // Only the immutable packed copy escapes the call; no source-array reference is queued.
            QualificationSettleObservation.offerComparisonWrite {
                try {
                    val writeStart = clock()
                    val digest = MessageDigest.getInstance("SHA-256").digest(packed).joinToString("") { "%02x".format(it) }
                    if (!inBudget(writeStart, WRITE_NS)) return@offerComparisonWrite
                    write(id.root.resolve("matrix.bin"), packed, writeStart)
                    val extra = ",\"width\":$width,\"height\":$height,\"count\":$count,\"counter\":$counter,\"regions\":$regions," +
                        "\"threshold\":$threshold,\"minimum\":$minimum,\"allowing\":0,\"bytes\":${packed.size},\"sha256\":\"$digest\"," +
                        "\"copyBeginNs\":$start,\"copyEndNs\":$end,\"copyLimitNs\":$COPY_NS,\"writeLimitNs\":$WRITE_NS"
                    val encoded = metadata(id, context, 0, ordinal, extra).toByteArray(Charsets.UTF_8)
                    if (encoded.size <= 2048) write(id.root.resolve("matrix.json"), encoded, writeStart)
                } catch (_: Throwable) { /* No complete metadata means no accepted capture. Never blocks the original call. */ }
            }
        } catch (_: Throwable) { /* Collection cannot replace the original result/error. */ }
    }

    // Controls only; no original route waits for, resets, or configures the writer.
    fun control(root: Path?, readClock: () -> Long = System::nanoTime, writer: ((Path, ByteArray) -> Unit)? = null) {
        check(QualificationSettleObservation.drainControl())
        testRoot = root; testIdentity = root != null; clock = readClock; testWrite = writer
        claimed.set(false); seen.set(0)
    }
}
