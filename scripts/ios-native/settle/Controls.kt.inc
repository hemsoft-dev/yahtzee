package maestro

import kotlinx.coroutines.runBlocking
import maestro.cli.mcp.tools.RunTool
import maestro.orchestra.Orchestra
import java.lang.reflect.Proxy
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO
import okio.Buffer
import okio.Sink

private class Marker : Error()

fun main() {
    val events = mutableListOf<String>()
    var counter = 0L
    var enabled = true
    var calls = 0
    var screenshots = 0
    var thrown: Throwable? = null
    var expectedTimeout: Int? = 347
    val bytes = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()
    val driver = Proxy.newProxyInstance(Driver::class.java.classLoader, arrayOf(Driver::class.java)) { _, method, args ->
        when (method.name.substringBefore("-")) {
            "waitForAppToSettle" -> {
                calls++
                check(args[0] == null && args[1] == "fixture-only" && args[2] == expectedTimeout)
                thrown?.let { throw it }
                null
            }
            "takeScreenshot" -> {
                screenshots++
                check(args[1] == true)
                thrown?.let { throw it }
                (args[0] as Sink).write(Buffer().write(bytes), bytes.size.toLong())
                null
            }
            "deviceInfo" -> DeviceInfo(maestro.device.Platform.IOS, 100, 100, 100, 100)
            "capabilities" -> emptyList<Capability>()
            "name" -> "fixture-driver"
            "setAndroidChromeDevToolsEnabled" -> null
            "toString" -> "fixture-driver"
            else -> error("Unexpected driver operation")
        }
    } as Driver
    val maestro = Maestro(driver)
    fun setup(on: Boolean = true, clock: () -> Long = { ++counter }, sink: (String) -> Unit = { events.add(it); Unit }) {
        enabled = on; QualificationSettleObservation.control(on, clock, sink); events.clear()
    }
    fun flushed() { check(QualificationSettleObservation.drainControl()) }
    setup()
    check(runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) } == null)
    check(calls == 1)
    flushed()
    check(events.size == if (System.getProperty("baseline") == "true") 0 else 2) { "MISSING_SETTLE_PHASES" }
    val baseline = System.getProperty("baseline") == "true"
    if (!baseline) check(events[0].contains("\"stage\":2,\"phase\":0") && events[1].contains("\"stage\":2,\"phase\":1"))
    setup(); check(runBlocking { maestro.waitForAnimationToEnd("5000") }); flushed(); check(screenshots == 2)
    if (!baseline) check(events.size == 2 && events[0].contains("\"stage\":1,\"phase\":0") && events[1].contains("\"phase\":1"))
    val marker = Marker(); thrown = marker
    setup(); try { runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) }; error("Missing error") } catch(e: Throwable) { check(e === marker) }; flushed()
    if (!baseline) check(events.size == 2 && events[1].contains("\"phase\":2"))
    setup(); try { runBlocking { maestro.waitForAnimationToEnd("5000") }; error("Missing screenshot error") } catch(e: Throwable) { check(e === marker) }; flushed()
    if (!baseline) check(events.size == 2 && events[1].contains("\"stage\":1,\"phase\":2"))
    thrown = null
    setup(false); runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) }; flushed(); check(events.isEmpty())
    setup(clock = { throw marker }); runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) }; flushed(); check(events.isEmpty())
    setup(sink = { throw marker }); runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) }
    setup(clock = { -1 }); runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) }; flushed(); check(events.isEmpty())
    setup(); val before=calls
    repeat(140) { runBlocking { maestro.waitForAppToSettle(null, "fixture-only", expectedTimeout) } }
    flushed()
    check(calls-before==140); check(events.size == if(baseline)0 else 256)
    if (!baseline) check(events.all { it.matches(Regex("THIRDROLL_SETTLE \\{\"v\":1,\"seq\":[0-9]+,\"id\":[0-9]+,\"stage\":[12],\"phase\":[012],\"monoNs\":[0-9]+,\"pid\":[0-9]+,\"wallMs\":[0-9]+\\}")) })
    setup(); val ref=Any(); check(QualificationSettleObservation.observe(2) { ref } === ref)
    flushed()
    check(!events.joinToString().contains("fixture-only"))
    setup()
    val method=RunTool::class.java.declaredMethods.single { it.name == "runInline" }
    method.isAccessible=true
    val result=method.invoke(RunTool,"fixture-device",Orchestra(maestro),"appId: fixture-only\n---\n- waitForAnimationToEnd: {timeout: 5000}\n",emptyMap<String,String>())
    flushed()
    val success=result.javaClass.getDeclaredMethod("getSuccess"); success.isAccessible=true
    check(success.invoke(result)==true)
    if(!baseline) check(events.count { it.contains("\"stage\":1") }==2)
    val entered=java.util.concurrent.CountDownLatch(1)
    val release=java.util.concurrent.CountDownLatch(1)
    setup(sink={ entered.countDown(); release.await() })
    val stalledBefore=calls
    runBlocking { maestro.waitForAppToSettle(null,"fixture-only",expectedTimeout) }
    check(calls==stalledBefore+1)
    if(!baseline) check(entered.await(2,java.util.concurrent.TimeUnit.SECONDS))
    release.countDown(); flushed()
    println("SETTLE_CONTROLS_PASS baseline=$baseline calls=$calls screenshots=$screenshots requestReturned=true stalledSinkDidNotHoldOriginal=true")
}
