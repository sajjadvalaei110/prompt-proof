package dev.codeatlas.design;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The design layer's key vocabulary. Keys are the parser's logical symbol keys
 * (JavaParserAdapter): a package is its dotted name, a type is {@code package.Type} (nested
 * {@code package.Outer.Inner}), a method is {@code Owner.name(ParamType,...)} and a constructor
 * {@code Owner.Owner(ParamType,...)}. Building a key the same way the parser does is what lets a
 * planned resource become "implemented" once the code that declares it is analyzed.
 */
public final class DesignKeys {
    private DesignKeys() {}

    public static final Set<String> TYPE_KINDS = Set.of("CLASS", "INTERFACE", "ENUM", "RECORD", "ANNOTATION");
    public static final Set<String> MEMBER_KINDS = Set.of("METHOD", "CONSTRUCTOR");
    public static final Set<String> RELATION_KINDS = Set.of("EXTENDS", "IMPLEMENTS", "CALLS", "CONSTRUCTS", "USES_TYPE",
        "READS_FIELD", "WRITES_FIELD", "INJECTS", "DECLARES_BEAN", "HANDLES_ROUTE", "DEPENDS_ON", "OVERRIDES");
    public static final String DEFAULT_PACKAGE = "(default)";
    public static final int MAX_KEY = 1000, MAX_EXPLANATION = 20_000, MAX_AUTHOR = 80, MAX_SIGNATURE = 500;

    private static final Pattern IDENTIFIER = Pattern.compile("[\\p{L}_$][\\p{L}\\p{N}_$]*");
    private static final Pattern PACKAGE = Pattern.compile("[\\p{L}_$][\\p{L}\\p{N}_$]*(\\.[\\p{L}_$][\\p{L}\\p{N}_$]*)*");
    private static final Pattern PARAMETER = Pattern.compile("[^()\\r\\n]{1,200}");

    public static boolean isResourceKind(String kind) {
        return "PACKAGE".equals(kind) || TYPE_KINDS.contains(kind) || MEMBER_KINDS.contains(kind);
    }

    /** Which container kind a resource kind may sit in: null (top level), PACKAGE-or-type, or type. */
    public static void requireParentKind(String kind, String parentKind) {
        if ("PACKAGE".equals(kind)) {
            if (parentKind != null) throw new IllegalArgumentException("A package has no parent: packages are flat, named by their full dotted name");
        } else if (TYPE_KINDS.contains(kind)) {
            if (parentKind == null || !("PACKAGE".equals(parentKind) || TYPE_KINDS.contains(parentKind)))
                throw new IllegalArgumentException("A " + kind.toLowerCase() + " must sit in a package or (nested) in a type");
        } else if (MEMBER_KINDS.contains(kind)) {
            if (parentKind == null || !TYPE_KINDS.contains(parentKind))
                throw new IllegalArgumentException("A " + kind.toLowerCase() + " must sit in a type");
        } else {
            throw new IllegalArgumentException("Unsupported resource kind " + kind + "; use PACKAGE, CLASS, INTERFACE, ENUM, RECORD, ANNOTATION, METHOD or CONSTRUCTOR");
        }
    }

    /** Validates the name for its kind and returns the parser-shaped key. */
    public static String key(String kind, String parentKey, String name, List<String> parameterTypes) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("A resource needs a name");
        name = name.trim();
        String key;
        if ("PACKAGE".equals(kind)) {
            if (!PACKAGE.matcher(name).matches()) throw new IllegalArgumentException("Package name must be dotted Java identifiers, e.g. com.acme.billing");
            key = name;
        } else if (TYPE_KINDS.contains(kind)) {
            if (!IDENTIFIER.matcher(name).matches()) throw new IllegalArgumentException("Type name must be a Java identifier");
            key = parentKey == null || DEFAULT_PACKAGE.equals(parentKey) ? name : parentKey + "." + name;
        } else if (MEMBER_KINDS.contains(kind)) {
            if (!IDENTIFIER.matcher(name).matches()) throw new IllegalArgumentException("Method name must be a Java identifier");
            if ("CONSTRUCTOR".equals(kind) && parentKey != null && !name.equals(simpleName(parentKey)))
                throw new IllegalArgumentException("A constructor's name must be its type's name, " + simpleName(parentKey));
            List<String> params = parameterTypes == null ? List.of() : parameterTypes.stream().map(p -> p == null ? "" : p.trim()).toList();
            for (String p : params) if (!PARAMETER.matcher(p).matches()) throw new IllegalArgumentException("Parameter type '" + p + "' must be 1-200 characters without parentheses or line breaks");
            key = parentKey + "." + name + "(" + String.join(",", params) + ")";
        } else {
            throw new IllegalArgumentException("Unsupported resource kind " + kind);
        }
        if (key.length() > MAX_KEY) throw new IllegalArgumentException("Resource key exceeds " + MAX_KEY + " characters");
        return key;
    }

    /** The last segment of a type key (generic-free). */
    public static String simpleName(String typeKey) {
        int dot = typeKey.lastIndexOf('.');
        return dot < 0 ? typeKey : typeKey.substring(dot + 1);
    }

    /** First paragraph of an explanation: by convention the intent. */
    public static String intent(String explanation) {
        if (explanation == null) return "";
        String text = explanation.strip();
        int blank = text.indexOf("\n\n");
        String first = (blank < 0 ? text : text.substring(0, blank)).replaceAll("\\s+", " ").trim();
        return first.length() > 600 ? first.substring(0, 597) + "…" : first;
    }

    public static String explanation(String text) {
        if (text == null) return null;
        if (text.length() > MAX_EXPLANATION) throw new IllegalArgumentException("Explanation exceeds " + MAX_EXPLANATION + " characters");
        return text.strip();
    }

    public static String author(String author) {
        String a = author == null || author.isBlank() ? "user" : author.strip();
        if (a.length() > MAX_AUTHOR || a.contains("\n")) throw new IllegalArgumentException("Author must be a single line of at most " + MAX_AUTHOR + " characters");
        return a;
    }

    public static String signature(String signature) {
        if (signature == null || signature.isBlank()) return null;
        String s = signature.strip();
        if (s.length() > MAX_SIGNATURE || s.contains("\n")) throw new IllegalArgumentException("Signature must be one line of at most " + MAX_SIGNATURE + " characters");
        return s;
    }
}
