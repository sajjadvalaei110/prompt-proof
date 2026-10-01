package dev.codeatlas.analysis.scip;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * The part of a SCIP index (github.com/sourcegraph/scip, {@code scip.proto}) that Code Atlas reads, decoded
 * straight from the protobuf wire format. Only the fields below are kept; every other field is skipped by its
 * wire type, so newer producers that add fields still decode. No protobuf runtime is needed (ADR 0012).
 *
 * <p>Ranges keep SCIP's convention: 0-based lines and 0-based, end-exclusive character offsets, either
 * {@code [startLine, startChar, endChar]} or {@code [startLine, startChar, endLine, endChar]}.</p>
 */
public record ScipIndex(String projectRoot, List<Document> documents) {

    /** {@code SymbolRole.Definition}. */
    public static final int ROLE_DEFINITION = 1;

    /** A {@code SymbolInformation.Kind} value; only the kinds Code Atlas maps are named. */
    public static final class Kind {
        public static final int CLASS = 7, CONSTRUCTOR = 9, ENUM = 11, ENUM_MEMBER = 12, FIELD = 15, INTERFACE = 21,
                METHOD = 26, ABSTRACT_METHOD = 66, STATIC_METHOD = 80;
        private Kind() { }
    }

    public record Document(String relativePath, List<Occurrence> occurrences, List<SymbolInformation> symbols) {}

    public record Occurrence(int[] range, String symbol, int roles, int[] enclosingRange) {
        public boolean isDefinition() { return (roles & ROLE_DEFINITION) != 0; }
        public int startLine() { return range[0]; }
        public int startChar() { return range[1]; }
        public int endLine() { return range.length == 3 ? range[0] : range[2]; }
        public int endChar() { return range.length == 3 ? range[2] : range[3]; }
        public boolean hasEnclosingRange() { return enclosingRange.length == 3 || enclosingRange.length == 4; }
    }

    public record SymbolInformation(String symbol, int kind, String displayName, String signature,
                                    String enclosingSymbol, List<Relationship> relationships) {}

    public record Relationship(String symbol, boolean isReference, boolean isImplementation,
                               boolean isTypeDefinition, boolean isDefinition) {}

    public static ScipIndex read(Path file) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            return parse(in.readAllBytes());
        }
    }

    public static ScipIndex parse(byte[] bytes) {
        Reader in = new Reader(bytes, 0, bytes.length);
        String projectRoot = "";
        List<Document> documents = new ArrayList<>();
        while (in.more()) {
            int tag = in.varint32();
            switch (tag) {
                case (1 << 3) | 2 -> projectRoot = metadataProjectRoot(in.message());
                case (2 << 3) | 2 -> documents.add(document(in.message()));
                default -> in.skip(tag);
            }
        }
        return new ScipIndex(projectRoot, List.copyOf(documents));
    }

    private static String metadataProjectRoot(Reader in) {
        String root = "";
        while (in.more()) {
            int tag = in.varint32();
            if (tag == ((3 << 3) | 2)) root = in.string(); else in.skip(tag);
        }
        return root;
    }

    private static Document document(Reader in) {
        String path = "";
        List<Occurrence> occurrences = new ArrayList<>();
        List<SymbolInformation> symbols = new ArrayList<>();
        while (in.more()) {
            int tag = in.varint32();
            switch (tag) {
                case (1 << 3) | 2 -> path = in.string();
                case (2 << 3) | 2 -> occurrences.add(occurrence(in.message()));
                case (3 << 3) | 2 -> symbols.add(symbolInformation(in.message()));
                default -> in.skip(tag);
            }
        }
        return new Document(path, List.copyOf(occurrences), List.copyOf(symbols));
    }

    private static Occurrence occurrence(Reader in) {
        IntList range = new IntList(), enclosing = new IntList();
        String symbol = "";
        int roles = 0;
        while (in.more()) {
            int tag = in.varint32();
            switch (tag) {
                case (1 << 3) | 2 -> in.packedInt32(range);
                case (1 << 3) -> range.add(in.varint32());
                case (2 << 3) | 2 -> symbol = in.string();
                case (3 << 3) -> roles = in.varint32();
                case (7 << 3) | 2 -> in.packedInt32(enclosing);
                case (7 << 3) -> enclosing.add(in.varint32());
                default -> in.skip(tag);
            }
        }
        int[] r = range.toArray();
        if (r.length != 3 && r.length != 4) throw new IllegalArgumentException("Malformed SCIP occurrence range of length " + r.length);
        return new Occurrence(r, symbol, roles, enclosing.toArray());
    }

    private static SymbolInformation symbolInformation(Reader in) {
        String symbol = "", displayName = "", signature = "", enclosing = "";
        int kind = 0;
        List<Relationship> relationships = new ArrayList<>();
        while (in.more()) {
            int tag = in.varint32();
            switch (tag) {
                case (1 << 3) | 2 -> symbol = in.string();
                case (4 << 3) | 2 -> relationships.add(relationship(in.message()));
                case (5 << 3) -> kind = in.varint32();
                case (6 << 3) | 2 -> displayName = in.string();
                case (7 << 3) | 2 -> signature = signatureText(in.message());
                case (8 << 3) | 2 -> enclosing = in.string();
                default -> in.skip(tag);
            }
        }
        return new SymbolInformation(symbol, kind, displayName, signature, enclosing, List.copyOf(relationships));
    }

    /** {@code signature_documentation} is a nested Document whose {@code text} (field 5) is the signature. */
    private static String signatureText(Reader in) {
        String text = "";
        while (in.more()) {
            int tag = in.varint32();
            if (tag == ((5 << 3) | 2)) text = in.string(); else in.skip(tag);
        }
        return text;
    }

    private static Relationship relationship(Reader in) {
        String symbol = "";
        boolean reference = false, implementation = false, typeDefinition = false, definition = false;
        while (in.more()) {
            int tag = in.varint32();
            switch (tag) {
                case (1 << 3) | 2 -> symbol = in.string();
                case (2 << 3) -> reference = in.varint64() != 0;
                case (3 << 3) -> implementation = in.varint64() != 0;
                case (4 << 3) -> typeDefinition = in.varint64() != 0;
                case (5 << 3) -> definition = in.varint64() != 0;
                default -> in.skip(tag);
            }
        }
        return new Relationship(symbol, reference, implementation, typeDefinition, definition);
    }

    /** A bounded view over the buffer; a nested message is a sub-reader over its length-delimited bytes. */
    private static final class Reader {
        private final byte[] bytes;
        private int position;
        private final int limit;

        Reader(byte[] bytes, int position, int limit) {
            this.bytes = bytes;
            this.position = position;
            this.limit = limit;
        }

        boolean more() { return position < limit; }

        long varint64() {
            long result = 0;
            for (int shift = 0; shift < 64; shift += 7) {
                if (position >= limit) throw new IllegalArgumentException("Truncated SCIP varint");
                byte b = bytes[position++];
                result |= (long) (b & 0x7F) << shift;
                if ((b & 0x80) == 0) return result;
            }
            throw new IllegalArgumentException("Malformed SCIP varint");
        }

        /** int32 fields are encoded as sign-extended varints; truncation restores negative values. */
        int varint32() { return (int) varint64(); }

        Reader message() {
            int length = length();
            Reader nested = new Reader(bytes, position, position + length);
            position += length;
            return nested;
        }

        String string() {
            int length = length();
            String value = new String(bytes, position, length, StandardCharsets.UTF_8);
            position += length;
            return value;
        }

        void packedInt32(IntList into) {
            Reader packed = message();
            while (packed.more()) into.add(packed.varint32());
        }

        private int length() {
            long length = varint64();
            if (length < 0 || length > limit - position) throw new IllegalArgumentException("Truncated SCIP field");
            return (int) length;
        }

        void skip(int tag) {
            switch (tag & 7) {
                case 0 -> varint64();
                case 1 -> advance(8);
                case 2 -> advance(length());
                case 5 -> advance(4);
                default -> throw new IllegalArgumentException("Unsupported SCIP wire type " + (tag & 7));
            }
        }

        private void advance(int count) {
            if (count > limit - position) throw new IllegalArgumentException("Truncated SCIP field");
            position += count;
        }
    }

    private static final class IntList {
        private int[] values = new int[4];
        private int size;

        void add(int value) {
            if (size == values.length) values = java.util.Arrays.copyOf(values, size * 2);
            values[size++] = value;
        }

        int[] toArray() { return java.util.Arrays.copyOf(values, size); }
    }
}
