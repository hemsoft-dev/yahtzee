package com.github.romankh3.image.comparison;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.util.function.Supplier;

/** Offline-only, synchronous phase controls. Never packaged in the qualification CLI. */
public final class ProfileHooks {
    private static final ThreadMXBean CPU = ManagementFactory.getThreadMXBean();
    private static final long[] ELAPSED = new long[4], CPUS = new long[4], CALLS = new long[4];
    public static long cpu() { return CPU.isCurrentThreadCpuTimeSupported() && CPU.isThreadCpuTimeEnabled() ? CPU.getCurrentThreadCpuTime() : -1; }
    public static void end(int stage, long time, long cpu) {
        long end = System.nanoTime(), endCpu = cpu();
        ELAPSED[stage - 1] += end - time;
        if (cpu >= 0 && endCpu >= cpu) CPUS[stage - 1] += endCpu - cpu;
        else CPUS[stage - 1] = Long.MIN_VALUE;
        CALLS[stage - 1]++;
    }
    public static <T> T measure(int stage, Supplier<T> call) {
        long time = System.nanoTime(), cpu = cpu();
        try { return call.get(); } finally { end(stage, time, cpu); }
    }
    public static void group(Runnable call) { measure(2, () -> { call.run(); return null; }); }
    public static String summary() {
        String out = "[";
        for (int i = 0; i < 4; i++) {
            if (i != 0) out += ",";
            out += "{\"stage\":" + (i + 1) + ",\"calls\":" + CALLS[i] + ",\"elapsedNs\":" + ELAPSED[i] +
                ",\"cpuNs\":" + (CPUS[i] >= 0 ? Long.toString(CPUS[i]) : "null") + "}";
        }
        return out + "]";
    }
}
