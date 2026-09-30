package dev.codeatlas.analysis.scip;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Reads the Java declaration signature scip-java prints ({@code SymbolInformation.signature_documentation}, e.g.
 * {@code @Override public String greet(String name)}) into the pieces Code Atlas stores the way the JavaParser
 * engine does: annotation names, the declared type keyword, return type, and the parameter types as written
 * (a varargs {@code T...} becomes {@code T[]}, matching {@code JavaParserAdapter.parameterList}).
 */
public record JavaSignature(List<String> annotations, String typeKeyword, String returnType, List<String> parameterTypes) {

    private static final Set<String> MODIFIERS = Set.of("public", "protected", "private", "static", "final", "abstract",
            "default", "synchronized", "native", "strictfp", "transient", "volatile", "sealed", "non-sealed");
    private static final Set<String> TYPE_KEYWORDS = Set.of("class", "interface", "@interface", "enum", "record");

    /**
     * @param text the printed signature
     * @param name the declared name (a constructor passes its type's simple name)
     */
    public static JavaSignature parse(String text, String name) {
        // scip-java puts annotations on their own lines; any whitespace run is one separator here.
        String rest = text == null ? "" : text.strip().replaceAll("\\s+", " ");
        List<String> annotations = new ArrayList<>();
        // Leading annotations, each optionally with a balanced argument list, then modifiers.
        while (true) {
            if (rest.startsWith("@") && !rest.startsWith("@interface")) {
                int end = 1;
                while (end < rest.length() && (Character.isJavaIdentifierPart(rest.charAt(end)) || rest.charAt(end) == '.')) end++;
                String annotation = rest.substring(1, end);
                annotations.add(annotation.substring(annotation.lastIndexOf('.') + 1));
                if (end < rest.length() && rest.charAt(end) == '(') end = matching(rest, end, '(', ')') + 1;
                rest = rest.substring(Math.min(end, rest.length())).stripLeading();
                continue;
            }
            int space = rest.indexOf(' ');
            String word = space < 0 ? rest : rest.substring(0, space);
            if (MODIFIERS.contains(word)) { rest = rest.substring(word.length()).stripLeading(); continue; }
            break;
        }
        int space = rest.indexOf(' ');
        String first = space < 0 ? rest : rest.substring(0, space);
        if (TYPE_KEYWORDS.contains(first)) return new JavaSignature(List.copyOf(annotations), first, null, List.of());

        // A method or constructor: [<type params>] [returnType] name(params) [throws ...]
        if (rest.startsWith("<")) rest = rest.substring(matching(rest, 0, '<', '>') + 1).stripLeading();
        int open = nameCall(rest, name);
        if (open < 0) return new JavaSignature(List.copyOf(annotations), null, null, null);
        String head = rest.substring(0, open).strip();
        String returnType = head.endsWith(name) ? head.substring(0, head.length() - name.length()).strip() : head;
        int close = matching(rest, open, '(', ')');
        List<String> parameters = new ArrayList<>();
        for (String parameter : splitTopLevel(rest.substring(open + 1, close))) parameters.add(parameterType(parameter));
        return new JavaSignature(List.copyOf(annotations), null, returnType.isEmpty() ? null : returnType, List.copyOf(parameters));
    }

    /** JavaParser-style signature without modifiers or parameter names: {@code String greet(String)}. */
    public String declaration(String name) {
        String params = parameterTypes == null ? "" : String.join(", ", parameterTypes);
        return (returnType == null ? "" : returnType + " ") + name + "(" + params + ")";
    }

    /** {@code (String,int)}, the parameter list form of JavaParser qualified names. */
    public String parameterList() {
        return "(" + (parameterTypes == null ? "" : String.join(",", parameterTypes)) + ")";
    }

    /** Index of {@code name(} outside angle brackets, returning the index of the parenthesis. */
    private static int nameCall(String text, String name) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '<') depth++;
            else if (c == '>') depth--;
            else if (c == '(' && depth == 0) {
                int start = i - name.length();
                boolean boundary = start == 0 || start > 0 && !Character.isJavaIdentifierPart(text.charAt(start - 1));
                return start >= 0 && boundary && text.startsWith(name, start) ? i : -1;
            }
        }
        return -1;
    }

    private static String parameterType(String parameter) {
        String p = parameter.strip();
        while (p.startsWith("@")) {
            int end = 1;
            while (end < p.length() && (Character.isJavaIdentifierPart(p.charAt(end)) || p.charAt(end) == '.')) end++;
            if (end < p.length() && p.charAt(end) == '(') end = matching(p, end, '(', ')') + 1;
            p = p.substring(Math.min(end, p.length())).stripLeading();
        }
        if (p.startsWith("final ")) p = p.substring(6).stripLeading();
        int split = p.length();
        while (split > 0 && Character.isJavaIdentifierPart(p.charAt(split - 1))) split--;
        String type = split > 0 ? p.substring(0, split).strip() : p;
        if (type.isEmpty()) type = p;
        return type.endsWith("...") ? type.substring(0, type.length() - 3).strip() + "[]" : type;
    }

    private static List<String> splitTopLevel(String text) {
        List<String> parts = new ArrayList<>();
        if (text.isBlank()) return parts;
        int depth = 0, start = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '<' || c == '(' || c == '[') depth++;
            else if (c == '>' || c == ')' || c == ']') depth--;
            else if (c == ',' && depth == 0) { parts.add(text.substring(start, i)); start = i + 1; }
        }
        parts.add(text.substring(start));
        return parts;
    }

    /** Index of the bracket closing the one at {@code open}; the text end when unbalanced. */
    private static int matching(String text, int open, char opening, char closing) {
        int depth = 0;
        for (int i = open; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == opening) depth++;
            else if (c == closing && --depth == 0) return i;
        }
        return text.length() - 1;
    }
}
