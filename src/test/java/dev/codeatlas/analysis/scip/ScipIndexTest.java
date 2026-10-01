package dev.codeatlas.analysis.scip;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Decodes {@code scip/scip-gradle-project.scip}, produced by scip-java 0.12.3 from
 * {@code test-fixtures/scip-gradle-project} (see that fixture's README for the command).
 */
class ScipIndexTest {

    private static final Path GOLDEN = Path.of("src/test/resources/scip/scip-gradle-project.scip");

    @Test void goldenIndexDecodesDocumentsOccurrencesAndSymbols() throws Exception {
        ScipIndex index = ScipIndex.read(GOLDEN);
        Map<String, ScipIndex.Document> documents = index.documents().stream()
                .collect(Collectors.toMap(ScipIndex.Document::relativePath, Function.identity()));
        assertEquals(java.util.Set.of(
                "app/src/main/java/com/example/app/Main.java",
                "app/src/main/java/com/example/app/GreetingService.java",
                "app/src/main/java/com/example/app/Factories.java",
                "core/src/main/java/com/example/core/BaseGreeter.java",
                "core/src/main/java/com/example/core/FriendlyGreeter.java",
                "core/src/main/java/com/example/core/Greeting.java",
                "core/src/main/java/com/example/core/Greeter.java"), documents.keySet());
        assertTrue(index.projectRoot().startsWith("file:"));

        ScipIndex.Document service = documents.get("app/src/main/java/com/example/app/GreetingService.java");
        // `greeter.greet(name)` on line 14 (0-based 13): the call resolves to the interface method in another module.
        ScipIndex.Occurrence greet = service.occurrences().stream()
                .filter(o -> o.symbol().endsWith("com/example/core/Greeter#greet().")).findFirst().orElseThrow();
        assertFalse(greet.isDefinition());
        assertEquals(13, greet.startLine());
        assertEquals(31, greet.startChar());
        assertEquals(36, greet.endChar());

        ScipIndex.Occurrence definition = service.occurrences().stream()
                .filter(o -> o.isDefinition() && o.symbol().endsWith("GreetingService#greetAll().")).findFirst().orElseThrow();
        assertTrue(definition.hasEnclosingRange());
        assertArrayEquals(new int[]{10, 4, 16, 5}, definition.enclosingRange());

        ScipIndex.SymbolInformation friendly = documents.get("core/src/main/java/com/example/core/FriendlyGreeter.java").symbols().stream()
                .filter(s -> s.symbol().endsWith("FriendlyGreeter#greet().")).findFirst().orElseThrow();
        assertEquals(ScipIndex.Kind.METHOD, friendly.kind());
        assertEquals("@Override\npublic String greet(String name)", friendly.signature());
        assertTrue(friendly.relationships().stream().anyMatch(r -> r.isImplementation() && r.symbol().endsWith("Greeter#greet().")));
    }

    @Test void truncatedInputIsRejectedNotMisread() throws Exception {
        byte[] bytes = java.nio.file.Files.readAllBytes(GOLDEN);
        assertThrows(IllegalArgumentException.class, () -> ScipIndex.parse(java.util.Arrays.copyOf(bytes, bytes.length / 2)));
    }

    @Test void unknownFieldsAreSkipped() {
        // Index { field 9 (varint 7), documents { relative_path "A.java" } }
        byte[] bytes = {(9 << 3), 7, (2 << 3) | 2, 8, (1 << 3) | 2, 6, 'A', '.', 'j', 'a', 'v', 'a'};
        ScipIndex index = ScipIndex.parse(bytes);
        assertEquals(1, index.documents().size());
        assertEquals("A.java", index.documents().get(0).relativePath());
    }
}
