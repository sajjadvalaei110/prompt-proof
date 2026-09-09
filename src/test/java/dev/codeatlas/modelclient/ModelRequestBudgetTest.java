package dev.codeatlas.modelclient;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ModelRequestBudgetTest {
    @Test void reservesOutputAndFramingWithoutAnArbitraryLargeWindowCap() {
        var budget = new ModelRequestBudget(2_000_000, 65_536);
        assertTrue(budget.fits("system", "source".repeat(100_000), 65_536));
        assertFalse(new ModelRequestBudget(4096, 2048).fits("system", "code".repeat(2000), 2048));
        assertThrows(IllegalArgumentException.class, () -> new ModelRequestBudget(4096, 4096));
        assertThrows(IllegalArgumentException.class, () -> new ModelRequestBudget(4096, 0));
    }

    @Test void unicodePrefixesStayWithinBudgetAndPreserveCodePoints() {
        String source = "abc قیمت 😀 日本語 XYZ";
        for (int limit = 0; limit <= ModelRequestBudget.estimate(source); limit++) {
            String prefix = ModelRequestBudget.prefix(source, limit);
            assertTrue(source.startsWith(prefix));
            assertTrue(ModelRequestBudget.estimate(prefix) <= limit);
            assertFalse(!prefix.isEmpty() && Character.isHighSurrogate(prefix.charAt(prefix.length() - 1)));
        }
        assertEquals(source, ModelRequestBudget.prefix(source, 100));
        assertEquals(2, ModelRequestBudget.estimate("abcdef"));
    }
}
