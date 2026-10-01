package dev.codeatlas.analysis.scip;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * A parsed SCIP symbol string ({@code scip.proto}, "Symbol" grammar):
 * {@code <scheme> ' ' <manager> ' ' <package-name> ' ' <version> ' ' <descriptor>+} or {@code local <id>}.
 * A double space inside the first four fields is an escaped space.
 *
 * <p>{@link #key()} is the descriptor text alone. scip-java names the same declaration with different package
 * fields depending on which module refers to it (for example {@code . .} from inside its own module and
 * {@code maven/<project>/core unspecified} from another), so the descriptors are the stable identity of an
 * in-project Java symbol.</p>
 */
public record ScipSymbol(boolean local, String key, List<Descriptor> descriptors) {

    public enum Suffix { NAMESPACE, TYPE, TERM, METHOD, TYPE_PARAMETER, PARAMETER, META, MACRO }

    /** One descriptor; {@code disambiguator} is only set for methods ({@code +1} for the second overload). */
    public record Descriptor(String name, Suffix suffix, String disambiguator) {}

    public static ScipSymbol parse(String symbol) {
        if (symbol == null || symbol.isEmpty()) throw new IllegalArgumentException("Empty SCIP symbol");
        if (symbol.startsWith("local ")) return new ScipSymbol(true, symbol, List.of());
        int position = 0;
        for (int field = 0; field < 4; field++) position = skipField(symbol, position);
        String key = symbol.substring(position);
        return new ScipSymbol(false, key, descriptors(key));
    }

    /** Returns the index just past the field's terminating single space. */
    private static int skipField(String symbol, int position) {
        int i = position;
        while (i < symbol.length()) {
            if (symbol.charAt(i) == ' ') {
                if (i + 1 < symbol.length() && symbol.charAt(i + 1) == ' ') { i += 2; continue; }
                return i + 1;
            }
            i++;
        }
        throw new IllegalArgumentException("Malformed SCIP symbol: " + symbol);
    }

    private static List<Descriptor> descriptors(String text) {
        List<Descriptor> result = new ArrayList<>();
        int i = 0;
        while (i < text.length()) {
            char c = text.charAt(i);
            if (c == '[' || c == '(') {
                int[] next = new int[1];
                String name = name(text, i + 1, next);
                char close = c == '[' ? ']' : ')';
                if (next[0] >= text.length() || text.charAt(next[0]) != close) throw malformed(text);
                result.add(new Descriptor(name, c == '[' ? Suffix.TYPE_PARAMETER : Suffix.PARAMETER, null));
                i = next[0] + 1;
                continue;
            }
            int[] next = new int[1];
            String name = name(text, i, next);
            i = next[0];
            if (i >= text.length()) throw malformed(text);
            char suffix = text.charAt(i);
            switch (suffix) {
                case '/' -> { result.add(new Descriptor(name, Suffix.NAMESPACE, null)); i++; }
                case '#' -> { result.add(new Descriptor(name, Suffix.TYPE, null)); i++; }
                case '.' -> { result.add(new Descriptor(name, Suffix.TERM, null)); i++; }
                case ':' -> { result.add(new Descriptor(name, Suffix.META, null)); i++; }
                case '!' -> { result.add(new Descriptor(name, Suffix.MACRO, null)); i++; }
                case '(' -> {
                    int close = text.indexOf(')', i);
                    if (close < 0 || close + 1 >= text.length() || text.charAt(close + 1) != '.') throw malformed(text);
                    result.add(new Descriptor(name, Suffix.METHOD, text.substring(i + 1, close)));
                    i = close + 2;
                }
                default -> throw malformed(text);
            }
        }
        return List.copyOf(result);
    }

    /** A simple identifier, or a backtick-escaped one where a doubled backtick is a literal backtick. */
    private static String name(String text, int start, int[] next) {
        if (start < text.length() && text.charAt(start) == '`') {
            StringBuilder out = new StringBuilder();
            int i = start + 1;
            while (i < text.length()) {
                char c = text.charAt(i);
                if (c == '`') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '`') { out.append('`'); i += 2; continue; }
                    next[0] = i + 1;
                    return out.toString();
                }
                out.append(c);
                i++;
            }
            throw malformed(text);
        }
        int i = start;
        while (i < text.length()) {
            char c = text.charAt(i);
            if (!(Character.isLetterOrDigit(c) || c == '_' || c == '+' || c == '-' || c == '$')) break;
            i++;
        }
        next[0] = i;
        return text.substring(start, i);
    }

    private static IllegalArgumentException malformed(String text) {
        return new IllegalArgumentException("Malformed SCIP descriptor: " + text);
    }

    public Descriptor last() {
        return descriptors.isEmpty() ? null : descriptors.get(descriptors.size() - 1);
    }

    /** Dotted package: the leading namespace descriptors. Empty for the default package. */
    public String packageName() {
        return descriptors.stream().takeWhile(d -> d.suffix() == Suffix.NAMESPACE).map(Descriptor::name).collect(Collectors.joining("."));
    }

    /** Whether this is a namespace symbol ({@code com/example/}). */
    public boolean isNamespace() {
        return !local && !descriptors.isEmpty() && descriptors.stream().allMatch(d -> d.suffix() == Suffix.NAMESPACE);
    }

    /** Whether this names a type: its last descriptor is a type and everything before is package or type. */
    public boolean isType() {
        return !local && last() != null && last().suffix() == Suffix.TYPE
                && descriptors.stream().allMatch(d -> d.suffix() == Suffix.NAMESPACE || d.suffix() == Suffix.TYPE);
    }

    /** Whether this names a member (method or term) directly on a type. */
    public boolean isMember() {
        return !local && last() != null && (last().suffix() == Suffix.METHOD || last().suffix() == Suffix.TERM)
                && owner() != null && owner().isType();
    }

    public boolean isConstructor() {
        return isMember() && last().suffix() == Suffix.METHOD && "<init>".equals(last().name());
    }

    /** The symbol one descriptor up (a member's type, a nested type's outer type), or null at the top. */
    public ScipSymbol owner() {
        if (local || descriptors.size() < 2) return null;
        List<Descriptor> parent = descriptors.subList(0, descriptors.size() - 1);
        return new ScipSymbol(false, render(parent), List.copyOf(parent));
    }

    /**
     * The Java qualified name of a type as JavaParser prints it: package and enclosing types joined by dots
     * ({@code com.example.Outer.Inner}).
     */
    public String javaTypeName() {
        return descriptors.stream().filter(d -> d.suffix() == Suffix.NAMESPACE || d.suffix() == Suffix.TYPE)
                .map(Descriptor::name).collect(Collectors.joining("."));
    }

    private static String render(List<Descriptor> descriptors) {
        StringBuilder out = new StringBuilder();
        for (Descriptor d : descriptors) {
            String name = escape(d.name());
            switch (d.suffix()) {
                case NAMESPACE -> out.append(name).append('/');
                case TYPE -> out.append(name).append('#');
                case TERM -> out.append(name).append('.');
                case META -> out.append(name).append(':');
                case MACRO -> out.append(name).append('!');
                case METHOD -> out.append(name).append('(').append(d.disambiguator()).append(").");
                case TYPE_PARAMETER -> out.append('[').append(name).append(']');
                case PARAMETER -> out.append('(').append(name).append(')');
            }
        }
        return out.toString();
    }

    private static String escape(String name) {
        boolean simple = !name.isEmpty() && name.chars().allMatch(c -> Character.isLetterOrDigit(c) || c == '_' || c == '+' || c == '-' || c == '$');
        return simple ? name : "`" + name.replace("`", "``") + "`";
    }
}
