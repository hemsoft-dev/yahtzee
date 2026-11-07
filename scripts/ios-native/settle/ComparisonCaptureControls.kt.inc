package maestro

import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private fun <T> captured(block: () -> T): T = QualificationSettleObservation.observe(1) {
    QualificationSettleObservation.device(6) { block() }
}

fun main(args: Array<String>) {
    if (args.size == 2 && args[1] == "shutdown") {
        val root = Files.createDirectory(Path.of(args[0]))
        val entered = CountDownLatch(1)
        QualificationComparisonCapture.control(root, writer = { _, _ -> entered.countDown(); CountDownLatch(1).await() })
        val value = captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0); 37 }
        check(value == 37 && entered.await(2, TimeUnit.SECONDS))
        println("CAPTURE_BLOCKED_DAEMON_NORMAL_EXIT")
        return // Existing writer is still blocked; normal JVM exit must not wait for it.
    }
    val root = Path.of(args.single())
    Files.createDirectories(root)
    var calls = 0
    fun fresh(name: String): Path = Files.createDirectory(root.resolve(name))
    fun drain() = check(QualificationSettleObservation.drainControl())
    val matrix = arrayOf(intArrayOf(0, 1, 1), intArrayOf(1, 0, 0))
    val positive = fresh("positive")
    QualificationComparisonCapture.control(positive)
    captured { QualificationComparisonCapture.snapshot(matrix, 3, 2, 2, 5, 1, 0.0); calls++ }
    matrix.forEach { it.fill(0) }
    drain()
    check(Files.readAllBytes(positive.resolve("matrix.bin")).contentEquals(byteArrayOf(14)))

    val meta = Files.readString(positive.resolve("matrix.json"))
    check(meta.contains("\"count\":3") && meta.contains("\"stage\":6") && meta.contains("\"source\":\"${"a".repeat(40)}\""))
    captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0) }
    drain()
    check(Files.list(positive).use { it.count() } == 2L) // One matrix; no later state replacement.
    check(Files.readAllBytes(positive.resolve("matrix.bin")).contentEquals(byteArrayOf(14)))

    val zero = fresh("zero")
    QualificationComparisonCapture.control(zero)
    captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(0, 0)), 0, 2, 2, 5, 1, 0.0) }
    drain(); check(Files.readAllBytes(zero.resolve("matrix.bin")).contentEquals(byteArrayOf(0)))
    check(Files.readString(zero.resolve("matrix.json")).contains("\"count\":0"))

    val outside = fresh("outside")
    QualificationComparisonCapture.control(outside)
    QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0)
    drain(); check(Files.list(outside).use { it.count() } == 0L)

    val marker = IllegalArgumentException("owned-control-marker")
    val errors = fresh("errors")
    QualificationComparisonCapture.control(errors, { throw marker })
    try {
        captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0); calls++; throw marker }
    } catch (error: Throwable) { check(error === marker) }
    drain(); check(!Files.exists(errors.resolve("matrix.json")))

    val oversized = fresh("oversized")
    QualificationComparisonCapture.control(oversized)
    captured { QualificationComparisonCapture.snapshot(Array(1001) { IntArray(8000) }, 1, 2, 2, 5, 1, 0.0) }
    drain(); check(Files.readString(oversized.resolve("first.json")).contains("\"code\":3"))

    for ((name, invalid) in listOf("ragged" to arrayOf(intArrayOf(1, 0), intArrayOf(0)), "nonbinary" to arrayOf(intArrayOf(2)),
                                  "count" to arrayOf(intArrayOf(1, 1)))) {
        val output = fresh(name)
        QualificationComparisonCapture.control(output)
        captured { QualificationComparisonCapture.snapshot(invalid, 1, 2, 2, 5, 1, 0.0) }
        drain(); check(!Files.exists(output.resolve("matrix.json")))
    }
    val timeout = fresh("copy-budget")
    var reads = 0
    QualificationComparisonCapture.control(timeout, { if (reads++ == 0) 0 else QualificationComparisonCapture.COPY_NS + 1 })
    captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0) }
    drain(); check(!Files.exists(timeout.resolve("matrix.json")))

    val partial = fresh("partial")
    QualificationComparisonCapture.control(partial, writer = { path, bytes -> Files.write(path, bytes.take(1).toByteArray()); throw marker })
    captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0); calls++ }
    drain(); check(!Files.exists(partial.resolve("matrix.json")))

    val blocked = fresh("blocked")
    val entered = CountDownLatch(1); val release = CountDownLatch(1)
    QualificationComparisonCapture.control(blocked, writer = { _, _ -> entered.countDown(); release.await() })
    val result = captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0); calls++; 37 }
    check(result == 37 && entered.await(2, TimeUnit.SECONDS))
    // Original has already returned while the existing writer is blocked. No new thread.
    release.countDown(); drain()

    val full = fresh("queue-full")
    QualificationComparisonCapture.control(full)
    val writerEntered = CountDownLatch(1); val writerRelease = CountDownLatch(1); val lastQueued = CountDownLatch(1)
    check(QualificationSettleObservation.offerComparisonWrite { writerEntered.countDown(); writerRelease.await() })
    check(writerEntered.await(2, TimeUnit.SECONDS))
    repeat(256) { index -> check(QualificationSettleObservation.offerComparisonWrite { if (index == 255) lastQueued.countDown() }) }
    check(!QualificationSettleObservation.offerComparisonWrite {})
    val unchanged = captured { QualificationComparisonCapture.snapshot(arrayOf(intArrayOf(1)), 1, 2, 2, 5, 1, 0.0); calls++; 51 }
    check(unchanged == 51)
    writerRelease.countDown(); check(lastQueued.await(2, TimeUnit.SECONDS)); drain()
    check(!Files.exists(full.resolve("matrix.json")))
    QualificationComparisonCapture.control(null)
    check(calls == 5)
    println("COMPARISON_CAPTURE_CONTROLS_PASS immutable=true bounded=true originalResultErrorIdentity=true existingWriterOnly=true")
}
