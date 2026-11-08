package maestro.orchestra

import maestro.ElementFilter
import maestro.MaestroException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong

/** Qualification copy only. No hierarchy, text, target getter or device access. */
internal object QualificationAssertResult {
    private const val FLOW_SHA = "e907175ef83d139cb9b9eae9800a683fac40b3f966754c277a993ffb6b5647c4"
    private val next = AtomicLong()
    private val pid = try { ProcessHandle.current().pid() } catch (_: Throwable) { 0L }
    private data class Identity(val source: String, val run: String, val attempt: String)
    private var identity: Identity? = try {
        val source = System.getenv("THIRDROLL_ASSERT_SOURCE") ?: ""
        val run = System.getenv("THIRDROLL_ASSERT_RUN") ?: ""
        val attempt = System.getenv("THIRDROLL_ASSERT_ATTEMPT") ?: ""
        if (System.getenv("THIRDROLL_ASSERT_ENABLE") == "1" && source.matches(Regex("[a-f0-9]{40}")) &&
            run.matches(Regex("[1-9][0-9]{0,19}")) && attempt.matches(Regex("[1-9][0-9]{0,19}"))) Identity(source, run, attempt) else null
    } catch (_: Throwable) { null }
    private var clock: () -> Long = System::nanoTime
    private var sink: (String) -> Unit = { System.err.println(it) }

    class Context internal constructor(internal val original: AssertConditionCommand, internal val id: Long, internal val runtimeCommand: Int) {
        internal var active = false
        internal var used = false
        internal var queries = 0
        internal var capped = false
        internal var count = 0
        internal var bytes = 0
        internal var condition = -1
        internal var error = 0
        internal val rows = ArrayList<String>(40)
    }

    fun context(index: Int, command: MaestroCommand): Context? = try {
        if (identity == null || index !in 0..1000) null else {
            val assertion = command.assertConditionCommand
            val info = command.sourceInfo
            if (assertion == null || info == null || assertion.optional || assertion.label != null ||
                assertion.condition.visible?.textRegex != "Current: .*" || assertion.condition.notVisible != null ||
                assertion.condition.scriptCondition != null || assertion.condition.platform != null || assertion.condition.label != null) null
            else {
                val hash = if (info.source.length > 262144) null else MessageDigest.getInstance("SHA-256").digest(info.source.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
                if (hash != FLOW_SHA) null else next.incrementAndGet().takeIf { it <= 2 }?.let { Context(assertion, it, index) }
            }
        }
    } catch (_: Throwable) { null }

    fun begin(context: Context?, command: AssertConditionCommand): Context? = try {
        if (context == null || context.used || context.original !== command || identity == null) null
        else { context.used = true; context.active = true; event(context, 1, 0); context }
    } catch (_: Throwable) { null }

    private fun event(context: Context, stage: Int, phase: Int, query: Int = 0, matches: Int = -1) {
        try {
            val bound = identity ?: return
            if (context.count >= 40) return
            val time = try { clock().takeIf { it in 0..9007199254740991L } } catch (_: Throwable) { null }
            val row = "THIRDROLL_ASSERT {\"v\":1,\"source\":\"${bound.source}\",\"run\":\"${bound.run}\",\"attempt\":\"${bound.attempt}\",\"pid\":$pid,\"id\":${context.id},\"flow\":4,\"command\":8,\"runtimeCommand\":${context.runtimeCommand},\"selector\":1,\"polarity\":1,\"seq\":${context.count},\"stage\":$stage,\"phase\":$phase,\"query\":$query,\"monoNs\":$time,\"matches\":$matches,\"condition\":${context.condition},\"error\":${context.error}}"
            val size = row.toByteArray(Charsets.UTF_8).size + 1
            if (size > 1024 || context.bytes + size > 16384) return
            context.rows.add(row); context.bytes += size; context.count++
        } catch (_: Throwable) { /* Primitive retention cannot change the original computation. */ }
    }

    fun filter(context: Context?, original: ElementFilter): ElementFilter {
        if (context == null) return original
        return { nodes ->
            val query = try {
                if (!context.active || context.queries >= 16) {
                    if (context.active && !context.capped) { context.capped = true; event(context, 4, 3) }
                    0
                } else { context.queries++; event(context, 2, 0, context.queries); context.queries }
            } catch (_: Throwable) { 0 }
            try {
                val result = original(nodes)
                if (query > 0) {
                    val count = try { result.size.takeIf { it in 0..10000 } ?: -1 } catch (_: Throwable) { -1 }
                    event(context, 2, 1, query, count)
                }
                result
            } catch (error: Throwable) {
                if (query > 0) event(context, 2, 2, query)
                throw error
            }
        }
    }

    fun result(context: Context?, value: Boolean): Boolean {
        try { if (context?.active == true) { context.condition = if (value) 1 else 0; event(context, 3, 1) } } catch (_: Throwable) { }
        return value
    }
    fun failed(context: Context?, error: Throwable) {
        try { if (context?.active == true) context.error = if (error is MaestroException.AssertionFailure) 1 else 2 } catch (_: Throwable) { }
    }
    fun end(context: Context?) {
        try {
            if (context?.active != true) return
            event(context, 1, if (context.error == 0) 1 else 2)
            context.active = false
            // At most16KiB, after the original assertion completion, on its existing stderr channel.
            // No writer thread/timer. Kernel/PrintStream blocking and delivery remain unattested.
            for (row in context.rows) try { sink(row) } catch (_: Throwable) { break }
        } catch (_: Throwable) { }
    }
    fun control(enabled: Boolean = true, readClock: () -> Long = System::nanoTime, write: (String) -> Unit = {}) {
        identity = if (enabled) Identity("a".repeat(40), "1", "1") else null
        next.set(0); clock = readClock; sink = write
    }
}
