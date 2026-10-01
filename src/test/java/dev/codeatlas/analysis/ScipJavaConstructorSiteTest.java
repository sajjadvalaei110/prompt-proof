package dev.codeatlas.analysis;

import dev.codeatlas.analysis.ScipJavaAnalysisAdapter.ConstructorSite;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * How the scip-java engine tells a constructor expression from other constructor-symbol occurrences: by the
 * significant tokens before the name, across line boundaries, comments, qualifiers, type arguments and annotations.
 */
class ScipJavaConstructorSiteTest {

    /**
     * Classifies the occurrence that starts at {@code ^} and ends at {@code $} (both removed from the text) in
     * {@code source}; without {@code $} it ends after the identifier at {@code ^}.
     */
    private static ConstructorSite site(String source) {
        int start = source.indexOf('^');
        String text = source.substring(0, start) + source.substring(start + 1);
        int end = text.indexOf('$');
        if (end >= 0) {
            text = text.substring(0, end) + text.substring(end + 1);
        } else {
            end = start;
            while (end < text.length() && Character.isJavaIdentifierPart(text.charAt(end))) end++;
        }
        String[] lines = text.split("\n", -1);
        int[] from = position(lines, start), to = position(lines, end);
        return ScipJavaAnalysisAdapter.constructorSite(lines, from[0], from[1], to[0], to[1]);
    }

    private static int[] position(String[] lines, int offset) {
        int line = 0;
        while (offset > lines[line].length()) offset -= lines[line++].length() + 1;
        return new int[]{line, offset};
    }

    @Test void sameLine() {
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("Foo f = new ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("call(new ^Foo(), x);"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("x=new\t^Foo();"));
    }

    @Test void newlineBetweenNewAndTheType() {
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new\n    ^GreetingService();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new\n\n\t  \n    ^GreetingService();"));
    }

    @Test void commentsBetween() {
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new // a line comment\n    ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new /* inline */ ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new /* a\n block\n comment */\n ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("return new // first\n  /* second */ // third\n  ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("String s = \"//\"; Object o = new\n ^Foo();"),
                "`//` inside a string literal is not a comment");
        assertEquals(ConstructorSite.NONE, site("return renew(); // new\n ^Foo();"), "`new` inside a trailing comment does not count");
    }

    @Test void qualifiedNames() {
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new com.example.core.^FriendlyGreeter();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new com.example\n    .core.^FriendlyGreeter();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new com . example /* c */ .\n core // x\n . ^FriendlyGreeter();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new Outer<String>.^Inner();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("outer.new ^Inner();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("outer()\n  .new\n  ^Inner();"));
    }

    @Test void typeArgumentsAndAnnotations() {
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new <String> ^Foo(\"x\");"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new <Map<String, List<Integer>>>\n  ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new @NonNull ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new @ NonNull\n  @Other(value = \"x\") ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new @a.b.NonNull ^Foo();"));
        assertEquals(ConstructorSite.INSTANCE_CREATION, site("new pkg.@NonNull ^Foo();"));
    }

    @Test void nonMatches() {
        assertEquals(ConstructorSite.NONE, site("renew ^Foo();"));
        assertEquals(ConstructorSite.NONE, site("x = renew\n ^Foo();"));
        assertEquals(ConstructorSite.NONE, site("newer ^Foo();"));
        assertEquals(ConstructorSite.NONE, site("return ^Foo();"));
        assertEquals(ConstructorSite.NONE, site("enum E { A, ^B(1) }"));
        assertEquals(ConstructorSite.NONE, site("^Foo();"), "start of file");
        assertEquals(ConstructorSite.NONE, site("/* new */ ^Foo();"), "`new` inside a comment does not count");
    }

    @Test void methodReferences() {
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("Supplier<Foo> s = Foo::^new;"));
        // scip-java's occurrence for a constructor reference spans the whole expression, from the type to `new`.
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("Supplier<Foo> s = ^Foo::new$;"));
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("return ^GreetingService\n            ::new$;"));
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("return ^pkg.Foo // c\n  :: /* c */ new$;"));
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("Supplier<Foo> s = Foo\n    :: ^new;"));
        assertEquals(ConstructorSite.METHOD_REFERENCE, site("IntFunction<Foo[]> s = Foo[]::^new;"));
        assertEquals(ConstructorSite.NONE, site("x = y : ^new;"), "a single colon is not a method reference");
    }
}
