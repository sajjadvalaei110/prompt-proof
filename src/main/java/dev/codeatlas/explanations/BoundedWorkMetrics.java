package dev.codeatlas.explanations;

import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicInteger;

/** Deterministic high-water marks used for diagnostics and constrained-memory verification. */
@Component
public class BoundedWorkMetrics {
    private final AtomicInteger rows = new AtomicInteger();
    private final AtomicInteger symbols = new AtomicInteger();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicInteger maxInFlight = new AtomicInteger();
    private final AtomicInteger promptBytes = new AtomicInteger();
    private final AtomicInteger responseBytes = new AtomicInteger();

    public void rowsLoaded(int count) { rows.accumulateAndGet(count, Math::max); }
    public void symbolsRetained(int count) { symbols.accumulateAndGet(count, Math::max); }
    public void prompt(String system, String user) {
        promptBytes.accumulateAndGet(bytes(system) + bytes(user), Math::max);
    }
    public void responseBytes(int count) { responseBytes.accumulateAndGet(count, Math::max); }
    public AutoCloseable requestStarted() {
        int current = inFlight.incrementAndGet();
        maxInFlight.accumulateAndGet(current, Math::max);
        return inFlight::decrementAndGet;
    }
    public Snapshot snapshot() {
        return new Snapshot(rows.get(), symbols.get(), maxInFlight.get(), promptBytes.get(), responseBytes.get());
    }
    public void reset() {
        rows.set(0); symbols.set(0); inFlight.set(0); maxInFlight.set(0); promptBytes.set(0); responseBytes.set(0);
    }
    public static int utf8Bytes(String value) {
        if (value == null) return 0;
        long bytes = 0;
        for (int i = 0; i < value.length();) {
            int point = value.codePointAt(i);
            bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
            if (bytes >= Integer.MAX_VALUE) return Integer.MAX_VALUE;
            i += Character.charCount(point);
        }
        return (int) bytes;
    }
    private static int bytes(String value) { return utf8Bytes(value); }
    public record Snapshot(int maximumRowsLoadedPerQuery, int maximumSymbolsRetainedPerBatch,
                           int maximumSimultaneousRequests, int maximumPromptBytes, int maximumResponseBytes) {}
}
