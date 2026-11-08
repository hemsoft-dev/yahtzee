@file:JvmName("CompactBoundaryControls")
package maestro.cli.mcp.tools

import io.modelcontextprotocol.kotlin.sdk.types.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import maestro.*
import maestro.cli.mcp.McpMaestroSessionManager
import java.lang.reflect.Proxy
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import kotlin.coroutines.Continuation
import kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn

private class OriginalMarker : Error()
private fun node(a: Map<String,String> = emptyMap(), vararg children: TreeNode) = TreeNode(attributes=a.toMutableMap(),children=children.toList())
private val targetAttributes = mapOf("accessibilityText" to "Delete all local data", "bounds" to "[1,80][99,99]")
private fun target() = node(targetAttributes)
private fun help(vararg children:TreeNode) = node(mapOf("resource-id" to "help-viewport","bounds" to "[0,0][100,100]"),*children)
private fun digest(s:String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

fun main(args:Array<String>) {
    val observed = System.getProperty("observed") == "true"
    val expect = System.getProperty("expectObservation") == "true"
    val events = mutableListOf<String>()
    var tree = help(target())
    var queries = 0
    var queryError:Throwable? = null
    var platform = "ios"
    val operations = mutableListOf<String>()
    val driver = Proxy.newProxyInstance(Driver::class.java.classLoader,arrayOf(Driver::class.java)) { _,method,_ ->
        operations.add(method.name.substringBefore("-"))
        when(method.name.substringBefore("-")) {
            "contentDescriptor" -> { queries++; queryError?.let { throw it }; tree }
            "deviceInfo" -> DeviceInfo(maestro.device.Platform.IOS,100,100,100,100)
            "capabilities" -> emptyList<Capability>()
            "name","toString" -> "fixture-driver"
            "setAndroidChromeDevToolsEnabled" -> null
            else -> error("Unexpected original driver operation")
        }
    } as Driver
    val manager = McpMaestroSessionManager()
    val sessionClass = Class.forName("maestro.cli.mcp.McpMaestroSessionManager\$McpMaestroSession")
    val constructor = sessionClass.constructors.single()
    val sessionsField = manager.javaClass.getDeclaredField("sessions"); sessionsField.isAccessible=true
    @Suppress("UNCHECKED_CAST")
    val sessions = sessionsField.get(manager) as MutableMap<String,Any>
    val maestro = Maestro(driver)
    val stream=constructor.parameterTypes[2].enumConstants.first()
    val tool=InspectScreenTool.create(manager)
    @Suppress("UNCHECKED_CAST")
    val handler=tool.handler as Function3<Any?,CallToolRequest,Continuation<CallToolResult>,Any?>
    fun request(meta:JsonObject? = buildJsonObject { putJsonObject("dev.hemsoft/compact") {
        put("v",1);put("invoke",1);put("flow",4);put("route",1);put("rpc",7)
    } }) = CallToolRequest(CallToolRequestParams(name="inspect_screen",arguments=buildJsonObject { put("device_id","cpu-owned-fixture") },meta=meta?.let { RequestMeta(it) }))
    fun reset(sink:((String)->Unit)? = { events.add(it); Unit }, time:()->Long={System.nanoTime()/1000}) {
        events.clear(); operations.clear(); queries=0
        QualificationCompact.control(sink,time)
        sessions["cpu-owned-fixture"]=constructor.newInstance(maestro,platform,stream,"cpu-owned-fixture")
    }
    fun invoke(req:CallToolRequest=request()):CallToolResult = runBlocking {
        suspendCoroutineUninterceptedOrReturn { handler.invoke(null,req,it) }
    }
    fun summary() = events.map { Json.parseToJsonElement(it).jsonObject }.single { it["stage"]!!.jsonPrimitive.int==2 }
    fun facts() = events.map { Json.parseToJsonElement(it).jsonObject }.filter { it["stage"]!!.jsonPrimitive.int==1 }
    fun checkCase(name:String, input:TreeNode, validate:()->Unit={}) {
        tree=input; reset()
        val result=invoke()
        check(result.isError != true)
        check(queries==1 && operations.count { it=="contentDescriptor" }==1)
        val text=(result.content.single() as TextContent).text
        println("CASE $name ${digest(text)} queries=$queries")
        if(observed) {
            check(events.first().contains("\"stage\":0"))
            check(summary()["query"]!!.jsonPrimitive.int==2 && summary()["formatter"]!!.jsonPrimitive.int==2)
            check(events.size<=12 && events.all { it.toByteArray().size<1024 })
            validate()
            check(events.none { it.contains("Delete") || it.contains("help-viewport") || it.contains("private-secret") })
        }
        for ((format, operation) in listOf<Pair<String,()->String>>(
            "csv" to { ViewHierarchyFormatters.extractCompactCsvOutput(input,platform) },
            "yaml" to { ViewHierarchyFormatters.extractCompactYamlOutput(input,platform) })) {
            val returned = operation()
            println("OTHER_FORMAT $name $format ${digest(returned)}")
        }
    }
    checkCase("owned",help(target())) { check(summary()["preTarget"]!!.jsonPrimitive.int==1);check(summary()["postTarget"]!!.jsonPrimitive.int==1) }
    if(expect) check(events.isNotEmpty()) { "MISSING_ORIGINAL_COMPACT_BOUNDARY" }
    checkCase("omitted",help(node(mapOf("accessibilityText" to "private-secret-token","bounds" to "[0,0][1,1]")))) { check(summary()["preTarget"]!!.jsonPrimitive.int==0) }
    checkCase("zero-target",help(node(targetAttributes+mapOf("bounds" to "[1,80][1,99]")))) { check(facts().single { it["kind"]!!.jsonPrimitive.int==2 }["reason"]!!.jsonPrimitive.int==1) }
    checkCase("zero-help-hoist",node(mapOf("resource-id" to "help-viewport","bounds" to "[0,0][0,100]"),target())) {
        val t=facts().single { it["kind"]!!.jsonPrimitive.int==2 };check(t["rawHelp"]!!.jsonPrimitive.int==1);check(t["outputHelp"]!!.jsonPrimitive.int==0);check(t["outputParent"]!!.jsonPrimitive.int==0)
    }
    checkCase("empty-wrapper-hoist",help(node(emptyMap(),target()))) { val t=facts().single { it["kind"]!!.jsonPrimitive.int==2 };check(t["parent"]!!.jsonPrimitive.int==2);check(t["outputParent"]!!.jsonPrimitive.int==1);check(summary()["empty"]!!.jsonPrimitive.int==1) }
    checkCase("ambiguous",help(target(),target())) { check(summary()["preTarget"]!!.jsonPrimitive.int==2) }
    checkCase("unowned",node(mapOf("bounds" to "[0,0][100,100]"),target())) { check(facts().single()["rawHelp"]!!.jsonPrimitive.int==0) }
    checkCase("disabled",help(TreeNode(attributes=targetAttributes.toMutableMap(),enabled=false))) { check(facts().single { it["kind"]!!.jsonPrimitive.int==2 }["enabled"]!!.jsonPrimitive.int==0) }
    checkCase("override",help(node(targetAttributes+mapOf("content-desc" to "private-secret-override")))) { check(summary()["preTarget"]!!.jsonPrimitive.int==1);check(summary()["postTarget"]!!.jsonPrimitive.int==0) }
    checkCase("upstream-filtered-unsupported-bounds",help(node(targetAttributes+mapOf("bounds" to "unsupported-private-secret")))) { check(summary()["preTarget"]!!.jsonPrimitive.int==0) }
    checkCase("negative-bounds",help(node(targetAttributes+mapOf("bounds" to "[-1,-2][99,99]"))))
    checkCase("node-cap",help(*Array(513) { node(mapOf("bounds" to "[0,0][1,1]")) })) { check(summary()["visited"]!!.jsonPrimitive.int==512);check(summary()["partial"]!!.jsonPrimitive.int==1) }
    checkCase("candidate-cap",help(*Array(9) { target() })) { check(summary()["partial"]!!.jsonPrimitive.int==2);check(facts().size==8) }
    var deep=target();repeat(26) { deep=node(emptyMap(),deep) }
    checkCase("depth-cap",help(deep)) { check(summary()["partial"]!!.jsonPrimitive.int==1) }
    platform="unsupported"
    checkCase("unsupported-platform",help(target())) { check(summary()["partial"]!!.jsonPrimitive.int==4);check(summary()["visited"]!!.jsonPrimitive.int==0) }
    platform="ios"
    tree=help(target());reset();val plain=invoke(request(null));check(events.isEmpty());check(queries==1);check(plain.isError!=true)
    reset();invoke(request(buildJsonObject { putJsonObject("dev.hemsoft/compact") {put("v",1);put("invoke",1);put("flow",4);put("route",2);put("rpc",7)} }));check(events.isEmpty())
    reset();queryError=OriginalMarker();val marker=queryError
    try { invoke();error("Original query error missing") } catch(error:Throwable) { check(error===marker) }
    check(queries==1)
    if(observed) check(summary()["query"]!!.jsonPrimitive.int==3 && summary()["formatter"]!!.jsonPrimitive.int==0)
    queryError=IllegalArgumentException("private-secret-query")
    reset();val errorResult=invoke();check(errorResult.isError==true);check(queries==1)
    println("CASE query-exception ${digest((errorResult.content.single() as TextContent).text)} queries=$queries")
    if(observed)check(summary()["query"]!!.jsonPrimitive.int==3 && summary()["handler"]!!.jsonPrimitive.int==2)
    queryError=null
    var boundsReads=0
    val changingBounds=object:MutableMap<String,String> by targetAttributes.toMutableMap() {
        override fun get(key:String):String? = if(key=="bounds") {
            boundsReads++
            if(boundsReads==1) "[1,80][99,99]" else "[99999999999999999999999,0][1,1]"
        } else targetAttributes[key]
    }
    tree=help(TreeNode(attributes=changingBounds))
    reset();val badFormatter=invoke();check(badFormatter.isError==true);check(queries==1)
    println("CASE formatter-exception ${digest((badFormatter.content.single() as TextContent).text)} queries=$queries")
    if(observed)check(summary()["formatter"]!!.jsonPrimitive.int==3)
    println("FORMATTER_THROW_BOUNDS_READS $boundsReads")
    tree=help(target());reset(sink={throw OriginalMarker()});check(invoke().isError!=true);check(queries==1)
    reset(time={throw OriginalMarker()});check(invoke().isError!=true)
    if(observed)check(events.all { Json.parseToJsonElement(it).jsonObject["monoUs"]==JsonNull })
    reset();val mutable=tree.attributes;invoke();val frozen=events.toList();mutable["accessibilityText"]="private-secret-later";check(events==frozen)
    reset();repeat(37) { index ->
        check(invoke(request(buildJsonObject { putJsonObject("dev.hemsoft/compact") {put("v",1);put("invoke",index+1);put("flow",4);put("route",1);put("rpc",index+7)} })).isError!=true)
    };check(queries==37);if(observed)check(events.count { Json.parseToJsonElement(it).jsonObject["stage"]!!.jsonPrimitive.int==0 }==36)
    // Retained cf is a compact result, expanded only as an offline formatter fixture.
    // It is never described as the historical pre-compaction hierarchy.
    val retained=args.firstOrNull()?.let { Json.parseToJsonElement(Files.readString(Path.of(it))).jsonObject }
    fun expand(value:JsonObject):TreeNode {
        val keys=mapOf("b" to "bounds","a11y" to "accessibilityText","txt" to "text","rid" to "resource-id","val" to "value","hint" to "hintText","cls" to "class")
        val attributes=mutableMapOf<String,String>()
        for((small,full) in keys) (value[small] as? JsonPrimitive)?.content?.let { attributes[full]=it }
        return TreeNode(attributes=attributes,children=(value["c"] as? JsonArray)?.map { expand(it.jsonObject) } ?: emptyList(),enabled=(value["enabled"] as? JsonPrimitive)?.booleanOrNull,
            clickable=(value["clickable"] as? JsonPrimitive)?.booleanOrNull,checked=(value["checked"] as? JsonPrimitive)?.booleanOrNull,focused=(value["focused"] as? JsonPrimitive)?.booleanOrNull,selected=(value["selected"] as? JsonPrimitive)?.booleanOrNull)
    }
    if(retained!=null) {
        // Exercise the actual formatter directly: replaying through the 100x100
        // fixture driver would filter this 1032-wide retained tree a second time.
        val expanded=node(emptyMap(),*retained["elements"]!!.jsonArray.map { expand(it.jsonObject) }.toTypedArray())
        reset()
        val method=ViewHierarchyFormatters::class.java.declaredMethods.single {
            it.name.startsWith("extractCompactJsonOutput") && java.lang.reflect.Modifier.isPublic(it.modifiers) &&
                it.parameterCount == if(observed) 3 else 2
        };method.isAccessible=true
        val context=QualificationCompact.begin(request())
        val value=if(observed) QualificationCompact.handler(context) {
            method.invoke(ViewHierarchyFormatters,expanded,"ios",context) as String
        } else method.invoke(ViewHierarchyFormatters,expanded,"ios") as String
        check(queries==0)
        if(observed) {
            check(summary()["visited"]!!.jsonPrimitive.int==60) // 59 retained nodes plus the authored empty root.
            check(summary()["preHelp"]!!.jsonPrimitive.int==1)
            check(summary()["preTarget"]!!.jsonPrimitive.int==0 && summary()["postTarget"]!!.jsonPrimitive.int==0)
        }
        println("FORMATTER_CASE retained-cf-expanded ${digest(value)} queries=0")
    }
    if(observed) {
        reset();val result=CallToolResult(content=listOf(TextContent("private-secret")))
        check(QualificationCompact.handler(QualificationCompact.begin(request())) {result}===result)
        check(QualificationCompact.query(null) {tree}===tree)
        check(QualificationCompact.format(null) {result}===result)
        val original=OriginalMarker()
        try { QualificationCompact.query(QualificationCompact.begin(request())) {throw original} } catch(error:Throwable) { check(error===original) }
        println("OBSERVED_BOUNDARY_CONTROLS_PASS")
    } else println("ORIGINAL_BOUNDARY_CONTROLS_PASS")
}
