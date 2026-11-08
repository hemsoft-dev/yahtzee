package maestro.cli.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.types.CallToolRequest
import kotlinx.serialization.json.*
import java.util.concurrent.atomic.AtomicInteger

/** Qualification-only. Never accepts a node or performs a hierarchy traversal. */
internal object QualificationCompact {
    private const val HELP = "help-viewport"
    private const val TARGET = "Delete all local data"
    private const val PREFIX = "THIRDROLL_COMPACT "
    private val invocations = AtomicInteger()
    private val bytes = AtomicInteger()
    private var controlSink: ((String) -> Unit)? = null
    private var controls = false
    private var clock: () -> Long = { System.nanoTime() / 1000 }
    fun control(sink: ((String) -> Unit)?, time: () -> Long = { System.nanoTime() / 1000 }) {
        controls = true; controlSink = sink; clock = time; invocations.set(0); bytes.set(0)
    }
    class Context(val invoke: Int, val flow: Int, val route: Int, val rpc: Int,
                  val source: String, val run: String, val attempt: String) {
        var query = 0; var formatter = 0; var handler = 0
        var queryBeginUs: Long? = null; var queryEndUs: Long? = null
        var formatBeginUs: Long? = null; var formatEndUs: Long? = null
        var visited = 0; var kept = 0; var zero = 0; var empty = 0
        var preHelp = 0; var preTarget = 0; var postHelp = 0; var postTarget = 0
        var partial = 0; var rows = 0
        val facts = ArrayList<Frame>(8)
    }
    class Frame(val id: Int, val parent: Int, val outputParent: Int, val depth: Int,
                val rawHelp: Int, val outputHelp: Int, val kind: Int, val bounds: List<Int>?) {
        var reason = -1; var post = 0; var enabled = -1
    }
    private fun safe(block: () -> Unit) { try { block() } catch (_: Throwable) { } }
    private fun integer(value: JsonElement?, min: Int, max: Int): Int? {
        val p = value as? JsonPrimitive ?: return null
        if (p.isString) return null
        return p.intOrNull?.takeIf { it in min..max }
    }
    fun begin(request: CallToolRequest): Context? = try {
        val env = System.getenv()
        val source = if (controls) "0".repeat(40) else env["THIRDROLL_COMPACT_SOURCE"] ?: ""
        val run = if (controls) "1" else env["THIRDROLL_COMPACT_RUN"] ?: ""
        val attempt = if (controls) "1" else env["THIRDROLL_COMPACT_ATTEMPT"] ?: ""
        val route = if (controls) 1 else env["THIRDROLL_COMPACT_ROUTE"]?.toIntOrNull()
        if (!source.matches(Regex("[a-f0-9]{40}")) || !run.matches(Regex("[1-9][0-9]{0,19}")) ||
            !attempt.matches(Regex("[1-9][0-9]{0,19}")) || route !in 1..2) null
        else {
            val meta = request.meta?.get("dev.hemsoft/compact") as? JsonObject
            if (meta == null || meta.keys != setOf("v", "invoke", "flow", "route", "rpc") || integer(meta["v"],1,1) == null ||
                integer(meta["route"],route!!,route) == null) null
            else {
                val invoke = integer(meta["invoke"],1,36)
                val flow = integer(meta["flow"],0,128)
                val rpc = integer(meta["rpc"],1,1000000)
                if (invoke == null || flow == null || rpc == null || invocations.incrementAndGet() != invoke) null
                else Context(invoke, flow, route, rpc, source, run, attempt)
            }
        }
    } catch (_: Throwable) { null }
    private fun time(): Long? = try { clock().takeIf { it >= 0 } } catch (_: Throwable) { null }
    private fun emit(context: Context, stage: Int, fields: String) = safe {
        if (context.rows >= 12) return@safe
        val mono = time()?.toString() ?: "null"
        val pid = ProcessHandle.current().pid()
        val line = "{\"v\":1,\"pid\":$pid,\"source\":\"${context.source}\",\"run\":\"${context.run}\",\"attempt\":\"${context.attempt}\",\"invoke\":${context.invoke},\"flow\":${context.flow},\"route\":${context.route},\"rpc\":${context.rpc},\"seq\":${context.rows},\"stage\":$stage,\"monoUs\":$mono,$fields}"
        val size = line.toByteArray(Charsets.UTF_8).size + PREFIX.length + 1
        if (size > 1024 || bytes.addAndGet(size) > 131072) return@safe
        context.rows++
        if (controls) controlSink?.invoke(line) else System.err.println(PREFIX + line)
    }
    fun <T> handler(context: Context?, operation: () -> T): T {
        if (context == null) return operation()
        emit(context,0,"\"phase\":0")
        try { val result = operation(); context.handler = 2; return result }
        catch (error: Throwable) { context.handler = 3; throw error }
        finally { finish(context) }
    }
    fun <T> query(context: Context?, operation: () -> T): T {
        if (context == null) return operation()
        context.query = 1
        context.queryBeginUs = time()
        try { val result = operation(); context.query = 2; return result }
        catch (error: Throwable) { context.query = 3; throw error }
        finally { context.queryEndUs = time() }
    }
    fun <T> format(context: Context?, operation: () -> T): T {
        if (context == null) return operation()
        context.formatter = 1
        context.formatBeginUs = time()
        try { val result = operation(); context.formatter = 2; return result }
        catch (error: Throwable) { context.formatter = 3; throw error }
        finally { context.formatEndUs = time() }
    }
    fun platform(context: Context?, platform: String): Context? {
        if (platform == "ios") return context
        if (context != null) context.partial = 4
        return null
    }
    private fun rect(value: String?): List<Int>? = try {
        if (value == null || value.length > 128) null else {
            val match = Regex("\\[(-?[0-9]+),(-?[0-9]+)\\]\\[(-?[0-9]+),(-?[0-9]+)\\]").matchEntire(value)
            match?.groupValues?.drop(1)?.map { it.toInt() }?.takeIf { it.all { n -> n in -1000000..1000000 } }
        }
    } catch (_: Throwable) { null }
    fun node(context: Context?, attributes: Map<String,String>, bounds: String?, depth: Int,
             parent: Int, outputParent: Int, rawHelp: Int, outputHelp: Int): Frame? {
        if (context == null || context.partial != 0) return null
        return try {
            if (context.visited >= 512 || depth > 24) { context.partial = 1; null }
            else {
                val id = ++context.visited
                val help = attributes["resource-id"] == HELP
                val target = attributes["accessibilityText"] == TARGET
                val text = attributes["text"] == TARGET
                if (help) context.preHelp++
                if (target || text) context.preTarget++
                val kind = (if (help) 1 else 0) + (if (target) 2 else 0) + (if (text) 4 else 0)
                val frame = Frame(id,parent,outputParent,depth,if(help) id else rawHelp,outputHelp,kind,if(kind!=0) rect(bounds) else null)
                if (kind != 0) {
                    if (context.facts.size >= 8) context.partial = 2 else context.facts.add(frame)
                }
                frame
            }
        } catch (_: Throwable) { context.partial = 3; null }
    }
    fun branch(context: Context?, frame: Frame?, reason: Int, element: Map<String,Any?>? = null) = safe {
        if (context == null || frame == null) return@safe
        frame.reason = reason
        when(reason) {
            1 -> context.zero++
            2 -> context.empty++
            0 -> {
                context.kept++
                val help = element?.get("rid") == HELP
                val target = element?.get("a11y") == TARGET
                val text = element?.get("txt") == TARGET
                if(help) context.postHelp++
                if(target || text) context.postTarget++
                frame.post = (if(help) 1 else 0) + (if(target) 2 else 0) + (if(text) 4 else 0)
                frame.enabled = if(element?.get("enabled") == false) 0 else 1
            }
        }
    }
    private fun finish(context: Context) = safe {
        for (fact in context.facts) emit(context,1,
            "\"node\":${fact.id},\"parent\":${fact.parent},\"outputParent\":${fact.outputParent},\"depth\":${fact.depth},\"rawHelp\":${fact.rawHelp},\"outputHelp\":${fact.outputHelp},\"kind\":${fact.kind},\"reason\":${fact.reason},\"post\":${fact.post},\"enabled\":${fact.enabled},\"rect\":${fact.bounds?.joinToString(prefix="[",postfix="]") ?: "null"}")
        emit(context,2,"\"query\":${context.query},\"formatter\":${context.formatter},\"handler\":${context.handler},\"visited\":${context.visited},\"kept\":${context.kept},\"zero\":${context.zero},\"empty\":${context.empty},\"preHelp\":${context.preHelp},\"preTarget\":${context.preTarget},\"postHelp\":${context.postHelp},\"postTarget\":${context.postTarget},\"partial\":${context.partial},\"facts\":${context.facts.size},\"queryBeginUs\":${context.queryBeginUs},\"queryEndUs\":${context.queryEndUs},\"formatBeginUs\":${context.formatBeginUs},\"formatEndUs\":${context.formatEndUs}")
    }
}
