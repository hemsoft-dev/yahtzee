package maestro.orchestra

import kotlinx.coroutines.runBlocking
import maestro.*
import maestro.orchestra.yaml.YamlCommandReader
import maestro.orchestra.util.Env.withEnv
import maestro.js.JsEngine
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.nio.file.Path
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn

private class Marker : Error()
fun main(args: Array<String>) {
    val baseline = System.getProperty("baseline") == "true"
    val commands = YamlCommandReader.readCommands(Path.of(args[0]))
    val command = commands[8].assertConditionCommand!!
    var invocationCommand = command
    var nodes = listOf(TreeNode(attributes = mutableMapOf("text" to "Current: 5 dice", "bounds" to "[0,0][100,100]")))
    var queryError: Throwable? = null
    var queries = 0
    val driver = Proxy.newProxyInstance(Driver::class.java.classLoader, arrayOf(Driver::class.java)) { _, method, _ ->
        when(method.name.substringBefore("-")) {
            "contentDescriptor" -> { queries++; queryError?.let { throw it }; TreeNode(children = nodes) }
            "deviceInfo" -> DeviceInfo(maestro.device.Platform.IOS, 100, 100, 100, 100)
            "capabilities" -> emptyList<Capability>()
            "name", "toString" -> "fixture-driver"
            "setAndroidChromeDevToolsEnabled" -> null
            else -> error("Unexpected driver operation")
        }
    } as Driver
    val orchestra = Orchestra(Maestro(driver), lookupTimeoutMs = 3L)
    val events = ArrayList<String>()
    fun reset(on: Boolean = true, clock: () -> Long = System::nanoTime, sink: (String) -> Unit = { events.add(it); Unit }) {
        events.clear(); QualificationAssertResult.control(on, clock, sink)
    }
    suspend fun invoke(context: QualificationAssertResult.Context?): Boolean = suspendCoroutineUninterceptedOrReturn { continuation ->
        val method = Orchestra::class.java.declaredMethods.single { it.name == "assertConditionCommand" && it.parameterCount == if(baseline) 2 else 3 }
        method.isAccessible = true
        try {
            if(baseline) method.invoke(orchestra, invocationCommand, continuation) else method.invoke(orchestra, invocationCommand, context, continuation)
        } catch(e: InvocationTargetException) { throw e.targetException }
    }
    fun context() = QualificationAssertResult.context(8, commands[8]) ?: error("CONTROL_CONTEXT_UNBOUND")
    reset(); queries = 0
    val first = context()
    check(!runBlocking { invoke(first) })
    check(queries == 1) { "Unexpected original query count $queries" }
    if(System.getProperty("expectObservation") == "true") check(events.isNotEmpty()) { "MISSING_ASSERTION_MATCH_RESULT" }
    if(baseline) { check(events.isEmpty()); println("ORIGINAL_BOUNDARY_CONTROL_PASS"); return }
    check(events.any { it.contains("\"stage\":2,\"phase\":1") && it.contains("\"matches\":1") })
    check(events.any { it.contains("\"stage\":3") && it.contains("\"condition\":1") })
    check(events.first().contains("\"stage\":1,\"phase\":0") && events.last().contains("\"stage\":1,\"phase\":1"))
    reset(); nodes = nodes + TreeNode(attributes=mutableMapOf("text" to "Current: 10 dice", "bounds" to "[0,100][100,200]"))
    check(!runBlocking { invoke(context()) }); check(events.any { it.contains("\"matches\":1") }) // Original deepest/clickable reduction is not a uniqueness oracle.
    reset(); nodes = listOf(TreeNode(attributes=mutableMapOf("text" to "private-token-DO-NOT-EXPORT", "bounds" to "[0,0][100,100]")))
    try { runBlocking { invoke(context()) }; error("Missing original assertion failure") } catch(e: MaestroException.AssertionFailure) { }
    check(events.any { it.contains("\"matches\":0") }); check(events.any { it.contains("\"condition\":0") }); check(events.last().contains("\"phase\":2"))
    check(events.none { it.contains("private-token") || it.contains("Current") || it.contains("bounds") })
    reset(); nodes = emptyList()
    try { runBlocking { invoke(context()) }; error("Missing absent-target failure") } catch(e: MaestroException.AssertionFailure) { }
    check(events.any { it.contains("\"matches\":0") })
    reset(); val marker = Marker(); queryError = marker
    try { runBlocking { invoke(context()) }; error("Missing original query error") } catch(e: Throwable) { check(e === marker) }
    check(events.none { it.contains("\"stage\":2") }); check(events.last().contains("\"phase\":2"))
    queryError = null; nodes = listOf(TreeNode(attributes=mutableMapOf("text" to "Current: 5 dice", "bounds" to "[0,0][100,100]")))
    reset(false); check(QualificationAssertResult.context(8, commands[8]) == null); check(!runBlocking { invoke(null) }); check(events.isEmpty())
    reset(); check(QualificationAssertResult.context(3, commands[3]) == null)
    check(QualificationAssertResult.context(-1, commands[8]) == null)
    val changed = commands[8].copy(sourceInfo = commands[8].sourceInfo!!.copy(source = commands[8].sourceInfo!!.source + " "))
    check(QualificationAssertResult.context(8, changed) == null)
    // Actual pinned env insertion/evaluation preserves authored source while changing runtime index.
    reset()
    val engine = Proxy.newProxyInstance(JsEngine::class.java.classLoader, arrayOf(JsEngine::class.java)) { _, _, _ -> error("No script should execute") } as JsEngine
    val evaluated = commands.withEnv(mapOf("CPU_FIXTURE" to "1"))[9].evaluateScripts(engine)
    invocationCommand = evaluated.assertConditionCommand!!
    check(!runBlocking { invoke(QualificationAssertResult.context(9, evaluated) ?: error("Evaluated source binding missing")) })
    check(events.all { it.contains("\"runtimeCommand\":9") })
    invocationCommand = command
    reset(clock = { throw marker }); check(!runBlocking { invoke(context()) }); check(events.all { it.contains("\"monoNs\":null") })
    reset(sink = { throw marker }); check(!runBlocking { invoke(context()) })
    reset(); val used = context(); check(!runBlocking { invoke(used) }); val count=events.size
    check(!runBlocking { invoke(used) }); check(events.size == count)
    reset(); val scope=context(); check(QualificationAssertResult.begin(scope,command)===scope)
    var filters=0; val original: ElementFilter = { filters++; it }
    val wrapped=QualificationAssertResult.filter(scope,original)
    val list=nodes; repeat(21) { check(wrapped(list)===list) }; check(filters==21)
    QualificationAssertResult.end(scope); check(events.count { it.contains("\"stage\":2,\"phase\":0") }==16)
    check(events.count { it.contains("\"stage\":4") }==1)
    check(events.size<=40 && events.sumOf { it.toByteArray().size+1 }<=16384)
    reset(); val throwScope=context(); QualificationAssertResult.begin(throwScope,command)
    val throwing=QualificationAssertResult.filter(throwScope) { throw marker }
    try { throwing(list); error("Missing filter error") } catch(e:Throwable) { check(e===marker) }
    QualificationAssertResult.end(throwScope); check(events.any { it.contains("\"stage\":2,\"phase\":2") })
    reset(); val immutableScope=context(); QualificationAssertResult.begin(immutableScope,command)
    val mutable = nodes.toMutableList()
    val same = QualificationAssertResult.filter(immutableScope) { mutable }(emptyList())
    check(same === mutable); mutable.clear(); QualificationAssertResult.end(immutableScope)
    check(events.any { it.contains("\"matches\":1") })
    reset(); val sizeScope=context(); QualificationAssertResult.begin(sizeScope,command)
    val unsupported = object : AbstractList<TreeNode>() {
        override val size: Int get() = throw marker
        override fun get(index: Int): TreeNode = throw marker
    }
    check(QualificationAssertResult.filter(sizeScope) { unsupported }(emptyList()) === unsupported)
    QualificationAssertResult.end(sizeScope); check(events.any { it.contains("\"stage\":2,\"phase\":1") && it.contains("\"matches\":-1") })
    println("ASSERTION_MATCH_CONTROLS_PASS originalForwarding=true actualFilter=true resultsErrorsIdentity=true")
}
