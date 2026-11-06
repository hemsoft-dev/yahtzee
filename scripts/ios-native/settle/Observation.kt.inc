package maestro

import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Only the isolated qualification copy loads this class. */
internal object QualificationSettleObservation {
    private val next = AtomicLong()
    private val sequence = AtomicLong()
    private data class Span(val id: Long, val stage: Int)
    private val scope = ThreadLocal<Span>()
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

    private fun event(id: Long, parentId: Long, stage: Int, phase: Int) {
        try {
            if (writer == null) return
            val seq = sequence.getAndIncrement()
            if (seq >= 256) return
            val time = clock()
            val wall = System.currentTimeMillis()
            if (time < 0) return
            val value = "THIRDROLL_SETTLE {\"v\":2,\"seq\":$seq,\"id\":$id,\"parentId\":$parentId,\"stage\":$stage,\"phase\":$phase,\"monoNs\":$time,\"pid\":$pid,\"wallMs\":$wall}"
            val write = sink
            queue.offer({ write(value) }) // Never waits for I/O or for the writer to drain.
        } catch (_: Throwable) { /* Observation cannot replace the original result/error. */ }
    }

    fun <T> observe(stage: Int, original: () -> T): T {
        if (!enabled || stage !in 1..2) return original()
        return observed(stage, 0, true, original)
    }

    // No inherited/global scope: unrelated or asynchronous device calls remain unobserved.
    fun <T> device(stage: Int, original: () -> T): T {
        val parent = try { scope.get() } catch (_: Throwable) { null }
        if (!enabled || parent == null || !((stage == 3 && parent.stage == 1) || (stage == 4 && parent.stage == 2))) return original()
        return observed(stage, parent.id, false, original)
    }

    private fun <T> observed(stage: Int, parentId: Long, ownScope: Boolean, original: () -> T): T {
        val id = next.incrementAndGet()
        if (id > 128) return original()
        val previous = try { scope.get() } catch (_: Throwable) { null }
        if (ownScope) try { scope.set(Span(id, stage)) } catch (_: Throwable) { /* Inner coverage unavailable. */ }
        event(id, parentId, stage, 0)
        return try {
            val result = original()
            event(id, parentId, stage, 1)
            result
        } catch (error: Throwable) {
            event(id, parentId, stage, 2)
            throw error
        } finally {
            if (ownScope) try {
                if (previous == null) scope.remove() else scope.set(previous)
            } catch (_: Throwable) { /* Cannot replace original result/error. */ }
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
