package dev.codeatlas.analysis.scip;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ScipSymbolTest {

    @Test void packageFieldsDoNotChangeTheDescriptorKey() {
        ScipSymbol sameModule = ScipSymbol.parse("semanticdb maven . . com/example/core/Greeter#greet().");
        ScipSymbol otherModule = ScipSymbol.parse("semanticdb maven maven/scip-gradle-project/core unspecified com/example/core/Greeter#greet().");
        assertEquals("com/example/core/Greeter#greet().", sameModule.key());
        assertEquals(sameModule.key(), otherModule.key());
        assertTrue(sameModule.isMember());
        assertFalse(sameModule.isType());
        assertEquals("com/example/core/Greeter#", sameModule.owner().key());
        assertEquals("com.example.core.Greeter", sameModule.owner().javaTypeName());
        assertEquals("com.example.core", sameModule.packageName());
    }

    @Test void escapedSpacesInPackageFieldsAndBacktickNamesParse() {
        ScipSymbol symbol = ScipSymbol.parse("semanticdb maven my  group . com/example/Main#`<init>`(+1).");
        assertEquals("com/example/Main#`<init>`(+1).", symbol.key());
        assertTrue(symbol.isConstructor());
        assertEquals("+1", symbol.last().disambiguator());
        assertEquals("<init>", symbol.last().name());
    }

    @Test void nestedTypesUseDottedJavaNames() {
        ScipSymbol inner = ScipSymbol.parse("semanticdb maven . . com/example/Outer#Inner#");
        assertTrue(inner.isType());
        assertEquals("com.example.Outer.Inner", inner.javaTypeName());
        assertTrue(inner.owner().isType());
        assertEquals("Inner", inner.last().name());
    }

    @Test void localsNamespacesAndFieldsAreClassified() {
        assertTrue(ScipSymbol.parse("local 12").local());
        assertTrue(ScipSymbol.parse("semanticdb maven . . com/example/").isNamespace());
        ScipSymbol field = ScipSymbol.parse("semanticdb maven jdk 21 java/lang/System#out.");
        assertTrue(field.isMember());
        assertEquals(ScipSymbol.Suffix.TERM, field.last().suffix());
        ScipSymbol typeParameter = ScipSymbol.parse("semanticdb maven . . com/example/Box#[T]");
        assertEquals(ScipSymbol.Suffix.TYPE_PARAMETER, typeParameter.last().suffix());
        assertFalse(typeParameter.isType());
    }

    @Test void malformedSymbolsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> ScipSymbol.parse(""));
        assertThrows(IllegalArgumentException.class, () -> ScipSymbol.parse("semanticdb maven"));
        assertThrows(IllegalArgumentException.class, () -> ScipSymbol.parse("semanticdb maven . . com/example/Main#`<init>"));
    }
}
