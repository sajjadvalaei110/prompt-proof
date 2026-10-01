package dev.codeatlas.analysis.scip;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class JavaSignatureTest {

    @Test void methodSignatureMatchesTheJavaParserEngineShapes() {
        JavaSignature signature = JavaSignature.parse("@Override\npublic List<String> greetAll(List<String> names)", "greetAll");
        assertEquals(List.of("Override"), signature.annotations());
        assertEquals("List<String>", signature.returnType());
        assertEquals(List.of("List<String>"), signature.parameterTypes());
        assertEquals("(List<String>)", signature.parameterList());
        assertEquals("List<String> greetAll(List<String>)", signature.declaration("greetAll"));
    }

    @Test void varargsGenericsAnnotationsAndThrowsAreNormalized() {
        JavaSignature signature = JavaSignature.parse(
                "@Deprecated(since = \"1\") public static <T extends Comparable<T>> Map<String, T> index(@Nonnull final Map<String, T> base, String... keys) throws IOException", "index");
        assertEquals(List.of("Deprecated"), signature.annotations());
        assertEquals("Map<String, T>", signature.returnType());
        assertEquals(List.of("Map<String, T>", "String[]"), signature.parameterTypes());
        assertEquals("(Map<String, T>,String[])", signature.parameterList());
    }

    @Test void constructorsHaveNoReturnType() {
        JavaSignature signature = JavaSignature.parse("protected BaseGreeter(String prefix)", "BaseGreeter");
        assertNull(signature.returnType());
        assertEquals("BaseGreeter(String)", signature.declaration("BaseGreeter"));
        assertEquals("()", JavaSignature.parse("public Main()", "Main").parameterList());
    }

    @Test void typeKeywordsAreRecognized() {
        assertEquals("interface", JavaSignature.parse("public interface Greeter", "Greeter").typeKeyword());
        assertEquals("class", JavaSignature.parse("public abstract class BaseGreeter", "BaseGreeter").typeKeyword());
        assertEquals("record", JavaSignature.parse("public record Point(int x, int y)", "Point").typeKeyword());
        assertEquals("@interface", JavaSignature.parse("public @interface Marker", "Marker").typeKeyword());
        assertEquals("enum", JavaSignature.parse("@SuppressWarnings(\"x\") enum Color", "Color").typeKeyword());
    }
}
