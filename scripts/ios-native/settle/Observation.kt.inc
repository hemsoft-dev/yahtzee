package maestro

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Only the isolated qualification copy loads this class. */
internal object QualificationSettleObservation {
    private val next = AtomicLong()
    private val sequence = AtomicLong()
    private val queue = ArrayBlockingQueue<() -> Unit>(256)
    @Volatile private var enabled = true
    @Volatile private var clock: () -> Long = { System.nanoTime() }
    @Volatile private var sink: (String) -> Unit = { System.err.println(it) }
    private val pid = try { ProcessHandle.current().pid() } catch (_: Throwable) { 0L }
    private val writer = try {
        Thread({
            while (true) {
                try { queue.take().invoke() } catch (_: Throwable) { /* A sink failure cannot escape to the original call. */ }
            }
        }, "qualification-settle-writer").apply { isDaemon = true; start() }
    } catch (_: Throwable) { null }

    private fun event(id: Long, stage: Int, phase: Int) {
        try {
            if (writer == null) return
            val seq = sequence.getAndIncrement()
            if (seq >= 256) return
            val time = clock()
            val wall = System.currentTimeMillis()
            if (time < 0) return
            val value = "THIRDROLL_SETTLE {\"v\":1,\"seq\":$seq,\"id\":$id,\"stage\":$stage,\"phase\":$phase,\"monoNs\":$time,\"pid\":$pid,\"wallMs\":$wall}"
            val write = sink
            queue.offer({ write(value) }) // Never waits for I/O or for the writer to drain.
        } catch (_: Throwable) { /* Observation cannot replace the original result/error. */ }
    }

    fun <T> observe(stage: Int, original: () -> T): T {
        if (!enabled || stage !in 1..2) return original()
        val id = next.incrementAndGet()
        if (id > 128) return original()
        event(id, stage, 0)
        return try {
            val result = original()
            event(id, stage, 1)
            result
        } catch (error: Throwable) {
            event(id, stage, 2)
            throw error
        }
    }

    // No original CLI path calls these control-only functions or waits for the writer.
    fun drainControl(): Boolean {
        val finished = CountDownLatch(1)
        return queue.offer({ finished.countDown() }) && finished.await(2, TimeUnit.SECONDS)
    }
    fun control(on: Boolean, readClock: () -> Long, write: (String) -> Unit) {
        check(drainControl())
        enabled = on; clock = readClock; sink = write; next.set(0); sequence.set(0)
    }
}
