package maestro

import kotlinx.coroutines.runBlocking
import maestro.cli.mcp.tools.RunTool
import maestro.orchestra.Orchestra
import java.lang.reflect.Proxy
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import okio.Buffer
import okio.Sink
import device.IOSDevice
import maestro.drivers.IOSDriver

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
    if (!baseline) {
        check(events.first().contains("\"stage\":1,\"phase\":0") && events.last().contains("\"stage\":1,\"phase\":1"))
        check(events.count { it.contains("\"stage\":5,") }==4 && events.count { it.contains("\"stage\":6,") }==2) { "MISSING_IMAGE_PHASES" }
    }
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
    if (!baseline) check(events.all { it.matches(Regex("THIRDROLL_SETTLE \\{\"v\":3,\"seq\":[0-9]+,\"id\":[0-9]+,\"parentId\":[0-9]+,\"stage\":[123456],\"phase\":[012],\"monoNs\":[0-9]+,\"pid\":[0-9]+,\"wallMs\":[0-9]+\\}")) })
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
    // The real IOSDriver, not a Driver proxy, forwards to a bounded IOSDevice fixture.
    var deviceScreenshots=0; var deviceStatic=0; var staticValue=true
    var deviceError: Throwable?=null; var expectedSink: Sink?=null; var expectedCompressed=true
    val device = Proxy.newProxyInstance(IOSDevice::class.java.classLoader, arrayOf(IOSDevice::class.java)) { _, method, args ->
        when(method.name) {
            "getDeviceId" -> "fixture-device"
            "takeScreenshot" -> {
                deviceScreenshots++; check(args[1]==expectedCompressed)
                if(expectedSink!=null) check(args[0]===expectedSink)
                deviceError?.let { throw it }
                (args[0] as Sink).write(Buffer().write(bytes),bytes.size.toLong()); null
            }
            "isScreenStatic" -> { deviceStatic++; deviceError?.let { throw it }; staticValue }
            else -> error("Unexpected IOSDevice operation")
        }
    } as IOSDevice
    val ios=IOSDriver(device); val iosMaestro=Maestro(ios)
    fun fields(event:String,key:String)=Regex("\\\"$key\\\":([0-9]+)").find(event)!!.groupValues[1].toLong()
    // Read counts/close/error behavior are compared with the actual JDK call.
    class DecodeStream(val fail:Throwable?=null):ByteArrayInputStream(bytes) {
        var reads=0; var closes=0
        override fun read(buffer:ByteArray,offset:Int,length:Int):Int { reads++; fail?.let { throw it }; return super.read(buffer,offset,length) }
        override fun close() { closes++; super.close() }
    }
    val direct=DecodeStream(); val originalImage=ImageIO.read(direct)
    setup(); val observedInput=DecodeStream()
    val observedImage=QualificationSettleObservation.observe(1) { QualificationSettleObservation.readImage(observedInput) }
    flushed(); check(originalImage.width==observedImage!!.width && originalImage.height==observedImage.height)
    check(originalImage.getRGB(0,0)==observedImage.getRGB(0,0) && direct.reads==observedInput.reads && direct.closes==observedInput.closes)
    check(events.count { fields(it,"stage")==5L }==2)
    setup(); check(QualificationSettleObservation.readImage(DecodeStream())!=null); flushed(); check(events.isEmpty())
    setup(); QualificationSettleObservation.observe(2) { check(QualificationSettleObservation.readImage(DecodeStream())!=null) }; flushed()
    check(events.size==2 && events.none { fields(it,"stage")==5L })
    setup(); check(QualificationSettleObservation.observe(1) { QualificationSettleObservation.readImage(ByteArrayInputStream(byteArrayOf(0))) }==null); flushed()
    check(events.count { fields(it,"stage")==5L && fields(it,"phase")==1L }==1)
    setup(); val decodeError=Marker()
    try { ImageIO.read(DecodeStream(decodeError)); error("Missing original decode error") } catch(e:Throwable) { check(e===decodeError) }
    try { QualificationSettleObservation.observe(1) { QualificationSettleObservation.readImage(DecodeStream(decodeError)) }; error("Missing observed decode error") } catch(e:Throwable) { check(e===decodeError) }
    flushed(); check(events.count { fields(it,"stage")==5L && fields(it,"phase")==2L }==1)
    setup(); val comparisonResult=17.5
    check(QualificationSettleObservation.observe(1) { QualificationSettleObservation.device(6) { comparisonResult } }==comparisonResult)
    flushed(); check(events.count { fields(it,"stage")==6L }==2)
    fun inner(stage:Int, count:Int) {
        flushed()
        if(baseline) { check(events.isEmpty()); return }
        val rows=events.filter { fields(it,"stage")==stage.toLong() }
        check(rows.size==count*2) { "MISSING_INNER_SETTLE_PHASES" }
        val outer=events.first(); check(fields(outer,"parentId")==0L)
        check(rows.all { fields(it,"parentId")==fields(outer,"id") })
        check(rows.chunked(2).all { fields(it[0],"phase")==0L && fields(it[1],"phase") in 1L..2L })
    }
    setup(); check(runBlocking { iosMaestro.waitForAnimationToEnd("5000") }); check(deviceScreenshots==2); inner(3,2)
    setup(); check(runBlocking { iosMaestro.waitForAppToSettle(null,"fixture-only",347) }==null); check(deviceStatic==1); inner(4,1)
    setup(); val output=Buffer(); expectedSink=output; expectedCompressed=false
    ios.takeScreenshot(output,false); check(output.readByteArray().contentEquals(bytes)); check(ios.waitUntilScreenIsStatic(100)); flushed(); check(events.isEmpty())
    expectedSink=null; expectedCompressed=true
    setup(); deviceError=marker
    try { runBlocking { iosMaestro.waitForAnimationToEnd("5000") }; error("Missing IOS screenshot error") } catch(e:Throwable) { check(e===marker) }
    inner(3,1)
    setup(); try { runBlocking { iosMaestro.waitForAppToSettle(null,"fixture-only",347) }; error("Missing IOS static error") } catch(e:Throwable) { check(e===marker) }
    inner(4,1); deviceError=null
    // Scope is restored after either throw; ordinary device calls must remain unobserved.
    setup(); ios.takeScreenshot(Buffer(),true); ios.waitUntilScreenIsStatic(100); flushed(); check(events.isEmpty())
    setup(); staticValue=false
    val staticMethod=IOSDriver::class.java.getDeclaredMethod("isScreenStatic"); staticMethod.isAccessible=true
    check(QualificationSettleObservation.observe(2) { staticMethod.invoke(ios) }==false); flushed()
    if(!baseline) inner(4,1)
    staticValue=true
    setup(); QualificationSettleObservation.observe(1) {
        val other=Thread { ios.takeScreenshot(Buffer(),true) }; other.start(); other.join()
    }; flushed(); check(events.none { fields(it,"stage")==3L })
    setup(); QualificationSettleObservation.observe(1) {
        ios.takeScreenshot(Buffer(),true)
        QualificationSettleObservation.observe(2) { ios.waitUntilScreenIsStatic(100) }
        ios.takeScreenshot(Buffer(),true)
    }; flushed()
    if(!baseline) {
        check(events.count { fields(it,"stage")==3L }==4)
        check(events.count { fields(it,"stage")==4L }==2)
        check(events.filter { fields(it,"stage")==3L }.all { fields(it,"parentId")==1L })
        check(events.filter { fields(it,"stage")==4L }.all { fields(it,"parentId")==3L })
    }
    setup(); QualificationSettleObservation.observe(2) { ios.takeScreenshot(Buffer(),true) }
    QualificationSettleObservation.observe(1) { ios.waitUntilScreenIsStatic(100) }; flushed()
    check(events.size==4 && events.all { fields(it,"stage")<=2L })
    check(events.map { fields(it,"id") }==listOf(1L,1L,2L,2L))
    setup(false); runBlocking { iosMaestro.waitForAnimationToEnd("5000") }; flushed(); check(events.isEmpty())
    setup(clock={ throw marker }); runBlocking { iosMaestro.waitForAnimationToEnd("5000") }; flushed(); check(events.isEmpty())
    setup(sink={ throw marker }); runBlocking { iosMaestro.waitForAppToSettle(null,"fixture-only",347) }; flushed()
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
