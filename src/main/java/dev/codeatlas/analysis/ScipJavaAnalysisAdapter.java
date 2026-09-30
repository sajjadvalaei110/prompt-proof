package dev.codeatlas.analysis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.scip.JavaSignature;
import dev.codeatlas.analysis.scip.ScipIndex;
import dev.codeatlas.analysis.scip.ScipJavaTool;
import dev.codeatlas.analysis.scip.ScipSymbol;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.IntConsumer;

/**
 * The scip-java engine for Java (ADR 0012): the project's own Gradle build compiles the code with the SemanticDB
 * javac plugin, and scip-java turns that into a SCIP index. Every name in the index was resolved by javac, so
 * facts are {@code RESOLVED}; what javac resolved to something outside the workspace (the JDK, libraries, other
 * modules of the build) is not a graph symbol and produces no edge, only an occurrence-index row.
 *
 * <p>Graph facts use the JavaParser engine's shapes so the explorer, Spring pass, change detection and
 * explanations work unchanged: the same symbol kinds and qualified names ({@code pkg.Type.method(ParamType)}),
 * the same relationship kinds (EXTENDS, IMPLEMENTS, CALLS, CONSTRUCTS, USES_TYPE, DEPENDS_ON, OVERRIDES), explicit
 * constructors only, fields and locals outside the graph. Relationship evidence is the exact name token javac
 * resolved rather than the whole expression. In addition every resolved name, including locals, parameters and
 * fields, is written to {@code code_occurrences} for go-to-definition.</p>
 */
@Component
public class ScipJavaAnalysisAdapter implements AnalysisPort {

    public static final String INDEXER = "scip-java";
    private static final ObjectMapper JSON = new ObjectMapper();
    /** Text before a constructor's name in {@code new T(..)}, {@code new pkg.Outer.Inner(..)} or {@code outer.new Inner(..)}. */
    private static final java.util.regex.Pattern INSTANCE_CREATION = java.util.regex.Pattern.compile("(?:^|[^\\w$])new\\s+(?:[\\w$]+\\s*\\.\\s*)*$");
    private static final String RESOLVED_REASON = "Resolved by javac (scip-java); runtime dispatch may vary";
    private static final String OVERRIDE_REASON = "javac records this method as overriding or implementing the in-source supertype method; calls to it may dispatch here at runtime";

    private final JdbcTemplate db;
    private final ScipJavaTool tool;
    private final JavaParserAdapter javaParser;
    private final SpringAnnotationAnalyzer springAnalyzer;

    private final List<String> diagnostics = new ArrayList<>();
    private Path root;
    /** Workspace-relative path -> its SCIP document. */
    private final Map<String, ScipIndex.Document> documents = new HashMap<>();
    /** Descriptor key -> symbol information, from every document of the build. */
    private final Map<String, ScipIndex.SymbolInformation> infoByKey = new HashMap<>();
    /** Descriptor key -> the graph symbol a workspace definition becomes (planned in {@link #prepare}). */
    private final Map<String, GraphSymbol> graphSymbols = new HashMap<>();
    /** Qualified name -> committed symbol id; absent while not (yet) committed. */
    private final Map<String, String> idCache = new HashMap<>();
    private final List<Override> overrides = new ArrayList<>();
    /** Type key -> supertype keys written in its header, gathered during the relationship pass. */
    private final Map<String, java.util.Set<String>> declaredSupertypes = new HashMap<>();

    private record GraphSymbol(String key, String qualifiedName, String simpleName, String kind, String ownerKey, JavaSignature signature) {
        boolean isType() { return ownerKey == null || !kind.equals("METHOD") && !kind.equals("CONSTRUCTOR"); }
    }
    private record Override(String sourceKey, String targetKey, String fileId, ScipIndex.Occurrence name, String[] lines) {}
    /** A graph definition's full source range in one file; the innermost one containing a reference owns it. */
    private record Owner(GraphSymbol symbol, int startLine, int startChar, int endLine, int endChar, ScipIndex.Occurrence name) {
        boolean contains(int line, int character) {
            return compare(startLine, startChar, line, character) <= 0 && compare(line, character, endLine, endChar) < 0;
        }
        long span() { return (long) (endLine - startLine) * 100_000L + (endChar - startChar); }
    }

    public ScipJavaAnalysisAdapter(JdbcTemplate db, ScipJavaTool tool, JavaParserAdapter javaParser, SpringAnnotationAnalyzer springAnalyzer) {
        this.db = db;
        this.tool = tool;
        this.javaParser = javaParser;
        this.springAnalyzer = springAnalyzer;
    }

    @java.lang.Override public String language() { return JavaAnalysisAdapter.LANGUAGE; }
    @java.lang.Override public String indexer() { return INDEXER; }
    @java.lang.Override public String indexerLabel() { return "scip-java (compiles with the project's Gradle build)"; }
    @java.lang.Override public boolean defaultIndexer() { return false; }
    @java.lang.Override public boolean executesTargetBuild() { return true; }
    @java.lang.Override public Optional<String> unavailableReason() { return tool.unavailableReason(); }

    @java.lang.Override
    public List<File> discoverFiles(File root) throws IOException {
        return SourceDiscoveryService.discover(root, ".java");
    }

    @java.lang.Override
    public void prepare(String workspacePath) {
        releaseRunCaches();
        root = Path.of(workspacePath).toAbsolutePath().normalize();
        ScipJavaTool.BuildLayout layout = ScipJavaTool.locate(root);
        if (!layout.modulePath().isEmpty()) {
            diagnostics.add("scip-java: built the Gradle build at " + layout.buildRoot() + " and indexed its " + layout.modulePath() + " directory.");
        }
        load(tool.index(layout, diagnostics::add), layout.modulePath());
        // The Spring pass parses sources with JavaParser; give it this workspace's source roots.
        javaParser.setupSymbolSolver(workspacePath);
    }

    /** Review captures hold sources only and must never run a build, so they always use the default engine. */
    @java.lang.Override
    public void prepare(String capturedPath, Path workspaceRoot) {
        throw new IllegalStateException("The scip-java engine does not analyze review captures");
    }

    /** Plans graph symbols from an index whose document paths are relative to the build root. Visible for tests. */
    void load(ScipIndex index, String modulePath) {
        String prefix = modulePath == null || modulePath.isEmpty() ? "" : modulePath.endsWith("/") ? modulePath : modulePath + "/";
        for (ScipIndex.Document document : index.documents()) {
            for (ScipIndex.SymbolInformation info : document.symbols()) {
                if (!info.symbol().startsWith("local ")) infoByKey.putIfAbsent(ScipSymbol.parse(info.symbol()).key(), info);
            }
            if (document.relativePath().startsWith(prefix)) documents.put(document.relativePath().substring(prefix.length()), document);
        }
        // Types first, outer before nested, so every member and nested type can name its owner.
        List<Map.Entry<ScipSymbol, ScipIndex.Occurrence>> definitions = new ArrayList<>();
        for (ScipIndex.Document document : documents.values()) {
            for (ScipIndex.Occurrence occurrence : document.occurrences()) {
                if (!occurrence.isDefinition() || occurrence.symbol().isEmpty() || occurrence.symbol().startsWith("local ")) continue;
                definitions.add(Map.entry(ScipSymbol.parse(occurrence.symbol()), occurrence));
            }
        }
        definitions.sort(Comparator.comparingInt(e -> e.getKey().descriptors().size()));
        for (var definition : definitions) {
            ScipSymbol symbol = definition.getKey();
            if (graphSymbols.containsKey(symbol.key())) continue;
            ScipIndex.SymbolInformation info = infoByKey.get(symbol.key());
            if (symbol.isType()) {
                JavaSignature signature = JavaSignature.parse(info == null ? "" : info.signature(), symbol.last().name());
                String kind = typeKind(signature.typeKeyword(), info == null ? 0 : info.kind());
                graphSymbols.put(symbol.key(), new GraphSymbol(symbol.key(), symbol.javaTypeName(), symbol.last().name(), kind,
                        symbol.owner() != null && symbol.owner().isType() ? symbol.owner().key() : null, signature));
            } else if (symbol.isMember() && symbol.last().suffix() == ScipSymbol.Suffix.METHOD) {
                GraphSymbol owner = graphSymbols.get(symbol.owner().key());
                // Implicit constructors (no declaration range) are not graph symbols, as in the JavaParser engine.
                if (owner == null || symbol.isConstructor() && !definition.getValue().hasEnclosingRange()) continue;
                String name = symbol.isConstructor() ? owner.simpleName() : symbol.last().name();
                JavaSignature signature = JavaSignature.parse(info == null ? "" : info.signature(), name);
                String qualifiedName = owner.qualifiedName() + "." + name + signature.parameterList();
                if (symbol.isConstructor() && graphSymbols.values().stream().anyMatch(g -> g.qualifiedName().equals(qualifiedName))) {
                    graphSymbols.put(symbol.key(), new GraphSymbol(symbol.key(), owner.qualifiedName() + ".<init>" + signature.parameterList(), name, "CONSTRUCTOR", owner.key(), signature));
                } else {
                    graphSymbols.put(symbol.key(), new GraphSymbol(symbol.key(), qualifiedName, name, symbol.isConstructor() ? "CONSTRUCTOR" : "METHOD", owner.key(), signature));
                }
            }
        }
    }

    private static String typeKind(String keyword, int scipKind) {
        if (keyword != null) {
            return switch (keyword) {
                case "interface" -> "INTERFACE";
                case "enum" -> "ENUM";
                case "record" -> "RECORD";
                case "@interface" -> "ANNOTATION";
                default -> "CLASS";
            };
        }
        return scipKind == ScipIndex.Kind.INTERFACE ? "INTERFACE" : scipKind == ScipIndex.Kind.ENUM ? "ENUM" : "CLASS";
    }

    @java.lang.Override
    public void parseDeclarations(File file, String workspaceId, String snapshotId) {
        try {
            String content = Files.readString(file.toPath());
            String relative = relative(file);
            String fileId = UUID.randomUUID().toString();
            db.update("INSERT INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) VALUES (?, ?, ?, ?, ?)",
                    fileId, snapshotId, relative, hash(content), content);
            ScipIndex.Document document = documents.get(relative);
            if (document == null) {
                diagnostics.add(relative + ": not compiled by the Gradle build (no scip-java facts); file excluded from graph.");
                return;
            }
            String[] lines = content.split("\n", -1);
            Map<String, String> localIds = new HashMap<>();
            List<Owner> owners = owners(document);
            owners.sort(Comparator.comparingInt((Owner o) -> ScipSymbol.parse(o.name().symbol()).descriptors().size()));
            for (Owner owner : owners) {
                GraphSymbol symbol = owner.symbol();
                String parentId;
                if (symbol.ownerKey() == null) {
                    String pkg = ScipSymbol.parse(owner.name().symbol()).packageName();
                    parentId = packageId(workspaceId, snapshotId, pkg.isEmpty() ? "(default)" : pkg);
                } else {
                    parentId = localIds.getOrDefault(symbol.ownerKey(), idOf(snapshotId, graphSymbols.get(symbol.ownerKey())));
                    if (parentId == null) continue;
                }
                String kind = symbol.isType() ? declaredTypeKind(lines, owner, symbol.kind()) : symbol.kind();
                String id = insertSymbol(workspaceId, snapshotId, symbol, kind, parentId, hash(content));
                localIds.put(symbol.key(), id);
                db.update("INSERT INTO symbol_evidence VALUES (?, ?)", id, evidence(fileId, owner.startLine(), owner.startChar(), owner.endLine(), owner.endChar(), lines, false));
            }
        } catch (IOException e) {
            throw new IllegalStateException("Declaration indexing failed for " + file.getName(), e);
        }
    }

    private String insertSymbol(String workspaceId, String snapshotId, GraphSymbol symbol, String kind, String parentId, String contentHash) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", workspaceId, symbol.qualifiedName());
        db.update("INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, snapshotId, symbol.qualifiedName(), workspaceId, kind, symbol.qualifiedName(), symbol.simpleName(), parentId, contentHash);
        try {
            db.update("UPDATE symbol_versions SET annotations = ? WHERE id = ?", JSON.writeValueAsString(symbol.signature().annotations()), id);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        if (symbol.kind().equals("METHOD")) {
            db.update("UPDATE symbol_versions SET signature = ?, return_type = ? WHERE id = ?", symbol.signature().declaration(symbol.simpleName()), symbol.signature().returnType(), id);
        } else if (symbol.kind().equals("CONSTRUCTOR")) {
            db.update("UPDATE symbol_versions SET signature = ? WHERE id = ?", symbol.signature().declaration(symbol.simpleName()), id);
        }
        idCache.put(symbol.qualifiedName(), id);
        return id;
    }

    private String packageId(String workspaceId, String snapshotId, String pkg) {
        List<String> existing = db.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? AND kind = 'PACKAGE'", String.class, snapshotId, pkg);
        if (!existing.isEmpty()) return existing.get(0);
        String id = UUID.randomUUID().toString();
        db.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", workspaceId, pkg);
        db.update("INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, content_hash) VALUES (?, ?, ?, ?, 'PACKAGE', ?, ?, NULL, ?)",
                id, snapshotId, pkg, workspaceId, pkg, pkg, hash(pkg));
        return id;
    }

    /** The committed id of a graph symbol, or null when its file's declarations were never committed. */
    private String idOf(String snapshotId, GraphSymbol symbol) {
        if (symbol == null) return null;
        String cached = idCache.get(symbol.qualifiedName());
        if (cached != null && exists(cached)) return cached;
        List<String> ids = db.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? AND kind <> 'PACKAGE'", String.class, snapshotId, symbol.qualifiedName());
        if (ids.isEmpty()) { idCache.remove(symbol.qualifiedName()); return null; }
        idCache.put(symbol.qualifiedName(), ids.get(0));
        return ids.get(0);
    }

    private boolean exists(String id) {
        Integer count = db.queryForObject("SELECT COUNT(*) FROM symbol_versions WHERE id = ?", Integer.class, id);
        return count != null && count > 0;
    }

    /**
     * The declaration keyword written before a type's name ({@code class}, {@code interface}, {@code enum},
     * {@code record}, {@code @interface}). The source is authoritative: scip-java prints a record's signature
     * without its keyword ({@code public final Greeting}) and leaves its kind unspecified.
     */
    private static String declaredTypeKind(String[] lines, Owner owner, String planned) {
        ScipIndex.Occurrence name = owner.name();
        StringBuilder header = new StringBuilder();
        for (int line = owner.startLine(); line <= name.startLine() && line < lines.length; line++) {
            int from = line == owner.startLine() ? Math.min(owner.startChar(), lines[line].length()) : 0;
            int to = line == name.startLine() ? Math.min(name.startChar(), lines[line].length()) : lines[line].length();
            if (from <= to) header.append(lines[line], from, to);
            header.append(' ');
        }
        java.util.regex.Matcher keyword = java.util.regex.Pattern.compile("(@\\s*interface|\\binterface|\\benum|\\brecord|\\bclass)\\s*$").matcher(header.toString().stripTrailing());
        if (!keyword.find()) return planned;
        String word = keyword.group(1).replaceAll("\\s", "");
        return typeKind(word, 0);
    }

    /** Graph definitions of a document that carry a declaration range. */
    private List<Owner> owners(ScipIndex.Document document) {
        List<Owner> owners = new ArrayList<>();
        for (ScipIndex.Occurrence occurrence : document.occurrences()) {
            if (!occurrence.isDefinition() || occurrence.symbol().isEmpty() || occurrence.symbol().startsWith("local ") || !occurrence.hasEnclosingRange()) continue;
            GraphSymbol symbol = graphSymbols.get(ScipSymbol.parse(occurrence.symbol()).key());
            if (symbol == null) continue;
            int[] r = occurrence.enclosingRange();
            owners.add(r.length == 3 ? new Owner(symbol, r[0], r[1], r[0], r[2], occurrence) : new Owner(symbol, r[0], r[1], r[2], r[3], occurrence));
        }
        return owners;
    }

    @java.lang.Override
    public void parseRelationships(File file, String workspaceId, String snapshotId) {
        try {
            String relative = relative(file);
            ScipIndex.Document document = documents.get(relative);
            if (document == null) return;
            List<String> fileIds = db.queryForList("SELECT id FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshotId, relative);
            if (fileIds.isEmpty()) return;
            String fileId = fileIds.get(0);
            String content = Files.readString(file.toPath());
            String[] lines = content.split("\n", -1);
            List<Owner> owners = owners(document);
            Map<String, Owner> ownerByKey = new HashMap<>();
            for (Owner owner : owners) ownerByKey.put(owner.symbol().key(), owner);
            Map<String, String> usesTypeByPair = new HashMap<>();
            Map<String, String> dependsOnByPair = new LinkedHashMap<>();
            List<Object[]> occurrenceRows = new ArrayList<>();
            Map<String, ScipIndex.SymbolInformation> localInfo = new HashMap<>();
            for (ScipIndex.SymbolInformation info : document.symbols()) if (info.symbol().startsWith("local ")) localInfo.put(info.symbol(), info);

            for (ScipIndex.Occurrence occurrence : document.occurrences()) {
                if (occurrence.symbol().isEmpty()) continue;
                ScipSymbol symbol = ScipSymbol.parse(occurrence.symbol());
                if (symbol.isNamespace()) continue;
                occurrenceRows.add(occurrenceRow(snapshotId, fileId, occurrence, symbol, localInfo));
                if (occurrence.isDefinition() || symbol.local()) continue;

                Owner owner = innermost(owners, occurrence.startLine(), occurrence.startChar());
                if (owner == null) continue; // package and import statements
                String sourceId = idOf(snapshotId, owner.symbol());
                GraphSymbol declaringType = owner.symbol().isType() ? owner.symbol() : graphSymbols.get(owner.symbol().ownerKey());
                String declaringTypeId = idOf(snapshotId, declaringType);
                if (sourceId == null || declaringTypeId == null) continue;

                GraphSymbol target = graphSymbols.get(symbol.key());
                GraphSymbol targetType = symbol.isType() ? target
                        : symbol.isMember() ? graphSymbols.get(symbol.owner().key()) : null;
                String targetTypeId = idOf(snapshotId, targetType);
                if (targetTypeId == null) continue; // outside the workspace: occurrence index only

                String token = text(lines, occurrence);
                String evidence = null;
                if (symbol.isType()) {
                    String supertypeKind = owner.symbol().isType() ? supertypeKind(lines, owner, occurrence) : null;
                    evidence = evidence(fileId, occurrence, lines);
                    if (supertypeKind != null) {
                        declaredSupertypes.computeIfAbsent(owner.symbol().key(), k -> new java.util.LinkedHashSet<>()).add(symbol.key());
                        relationship(snapshotId, sourceId, targetTypeId, supertypeKind, RESOLVED_REASON, evidence);
                    } else if (!targetTypeId.equals(sourceId) && !targetTypeId.equals(declaringTypeId)) {
                        String pair = sourceId + ">" + targetTypeId;
                        String existing = usesTypeByPair.get(pair);
                        if (existing == null) usesTypeByPair.put(pair, relationship(snapshotId, sourceId, targetTypeId, "USES_TYPE", RESOLVED_REASON, evidence));
                        else addEvidence(existing, evidence);
                    }
                } else if (symbol.isConstructor()) {
                    if (token.equals("super") || token.equals("this")) continue; // explicit constructor invocation
                    String before = before(lines, occurrence);
                    boolean reference = before.stripTrailing().endsWith("::");
                    if (!reference && !INSTANCE_CREATION.matcher(before).find()) continue;
                    String constructorId = reference ? null : idOf(snapshotId, target);
                    String targetId = constructorId != null ? constructorId : targetTypeId;
                    evidence = evidence(fileId, occurrence, lines);
                    if (!targetId.equals(sourceId)) relationship(snapshotId, sourceId, targetId, "CONSTRUCTS", RESOLVED_REASON, evidence);
                } else if (symbol.isMember() && symbol.last().suffix() == ScipSymbol.Suffix.METHOD) {
                    evidence = evidence(fileId, occurrence, lines);
                    String targetId = idOf(snapshotId, target);
                    if (targetId != null) relationship(snapshotId, sourceId, targetId, "CALLS", RESOLVED_REASON, evidence);
                } else if (symbol.isMember()) {
                    evidence = evidence(fileId, occurrence, lines); // field access: summarized by DEPENDS_ON only
                }
                if (evidence != null && !targetTypeId.equals(declaringTypeId)) {
                    String pair = declaringTypeId + ">" + targetTypeId;
                    String existing = dependsOnByPair.get(pair);
                    if (existing == null) dependsOnByPair.put(pair, relationship(snapshotId, declaringTypeId, targetTypeId, "DEPENDS_ON", RESOLVED_REASON, evidence));
                    else addEvidence(existing, evidence);
                }
            }
            db.batchUpdate("INSERT INTO code_occurrences (id, snapshot_id, source_file_version_id, start_line, start_column, end_line, end_column, symbol, is_definition, symbol_version_id, display_name, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    localKeys(occurrenceRows, fileId));
            for (ScipIndex.Occurrence occurrence : document.occurrences()) {
                if (!occurrence.isDefinition() || occurrence.symbol().startsWith("local ") || occurrence.symbol().isEmpty()) continue;
                String key = ScipSymbol.parse(occurrence.symbol()).key();
                GraphSymbol method = graphSymbols.get(key);
                ScipIndex.SymbolInformation info = infoByKey.get(key);
                if (method == null || !method.kind().equals("METHOD") || info == null) continue;
                for (ScipIndex.Relationship relationship : info.relationships()) {
                    if (!relationship.isImplementation()) continue;
                    String target = ScipSymbol.parse(relationship.symbol()).key();
                    GraphSymbol overridden = graphSymbols.get(target);
                    if (overridden == null || !overridden.kind().equals("METHOD")) continue;
                    overrides.add(new Override(key, target, fileId, occurrence, lines));
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Relationship indexing failed for " + file.getName(), e);
        }
    }

    /** OVERRIDES from javac's overridden-symbol facts, once every file's symbols are committed. */
    @java.lang.Override
    public void linkRelationships(String snapshotId) {
        for (Override override : overrides) {
            if (!isSubtype(graphSymbols.get(override.sourceKey()).ownerKey(), graphSymbols.get(override.targetKey()).ownerKey())) continue;
            String source = idOf(snapshotId, graphSymbols.get(override.sourceKey()));
            String target = idOf(snapshotId, graphSymbols.get(override.targetKey()));
            if (source == null || target == null) continue;
            relationship(snapshotId, source, target, "OVERRIDES", OVERRIDE_REASON, evidence(override.fileId(), override.name(), override.lines()));
        }
        overrides.clear();
        declaredSupertypes.clear();
    }

    /**
     * Whether {@code supertypeKey} is a (transitive) supertype of {@code typeKey}, from javac's supertype facts and
     * the supertypes written in type headers (scip-java records none for records). scip-java links an overriding
     * method and the method it overrides in both directions, so only the subtype's side is an OVERRIDES fact.
     */
    private boolean isSubtype(String typeKey, String supertypeKey) {
        java.util.Set<String> seen = new java.util.HashSet<>();
        java.util.Deque<String> queue = new java.util.ArrayDeque<>(List.of(typeKey));
        while (!queue.isEmpty()) {
            String next = queue.removeFirst();
            if (!seen.add(next)) continue;
            List<String> supertypes = new ArrayList<>(declaredSupertypes.getOrDefault(next, java.util.Set.of()));
            ScipIndex.SymbolInformation info = infoByKey.get(next);
            if (info != null) for (ScipIndex.Relationship r : info.relationships()) if (r.isImplementation()) supertypes.add(ScipSymbol.parse(r.symbol()).key());
            for (String supertype : supertypes) {
                if (supertype.equals(supertypeKey)) return true;
                queue.addLast(supertype);
            }
        }
        return false;
    }

    private Object[] occurrenceRow(String snapshotId, String fileId, ScipIndex.Occurrence occurrence, ScipSymbol symbol,
                                   Map<String, ScipIndex.SymbolInformation> localInfo) {
        GraphSymbol graph = symbol.local() ? null : graphSymbols.get(symbol.key());
        ScipIndex.SymbolInformation info = symbol.local() ? localInfo.get(symbol.key()) : infoByKey.get(symbol.key());
        return new Object[]{UUID.randomUUID().toString(), snapshotId, fileId,
                occurrence.startLine() + 1, occurrence.startChar() + 1, occurrence.endLine() + 1, occurrence.endChar(),
                symbol.key(), occurrence.isDefinition() ? 1 : 0, graph == null ? null : idOf(snapshotId, graph),
                occurrence.isDefinition() && info != null ? info.displayName() : null,
                occurrence.isDefinition() && info != null ? info.signature() : null};
    }

    /** File-local symbols ({@code local N}) are only unique inside their file, so their key carries the file id. */
    private List<Object[]> localKeys(List<Object[]> rows, String fileId) {
        for (Object[] row : rows) {
            if (((String) row[7]).startsWith("local ")) row[7] = fileId + ":" + row[7];
        }
        return rows;
    }

    private static Owner innermost(List<Owner> owners, int line, int character) {
        Owner best = null;
        for (Owner owner : owners) {
            if (owner.contains(line, character) && (best == null || owner.span() < best.span())) best = owner;
        }
        return best;
    }

    /**
     * EXTENDS or IMPLEMENTS when a type reference is a direct supertype in its type's header: after the declared
     * name, before the body's opening brace, outside type arguments, following {@code extends} or
     * {@code implements}. An interface's {@code extends} list is EXTENDS, as in the JavaParser engine.
     */
    private static String supertypeKind(String[] lines, Owner owner, ScipIndex.Occurrence reference) {
        ScipIndex.Occurrence name = owner.name();
        if (compare(reference.startLine(), reference.startChar(), name.endLine(), name.endChar()) < 0) return null;
        StringBuilder header = new StringBuilder();
        for (int line = name.endLine(); line <= reference.startLine() && line < lines.length; line++) {
            int from = line == name.endLine() ? Math.min(name.endChar(), lines[line].length()) : 0;
            int to = line == reference.startLine() ? Math.min(reference.startChar(), lines[line].length()) : lines[line].length();
            if (from <= to) header.append(lines[line], from, to);
            header.append(' ');
        }
        String text = header.toString();
        if (text.indexOf('{') >= 0) return null;
        // Type arguments (<..>) and a record's components ((..)) are skipped: a reference inside them is not a supertype.
        int depth = 0;
        String keyword = null;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '<' || c == '(') depth++;
            else if (c == '>' || c == ')') depth--;
            else if (depth == 0 && Character.isJavaIdentifierStart(c) && (i == 0 || !Character.isJavaIdentifierPart(text.charAt(i - 1)))) {
                int end = i;
                while (end < text.length() && Character.isJavaIdentifierPart(text.charAt(end))) end++;
                String word = text.substring(i, end);
                if (word.equals("extends")) keyword = "EXTENDS";
                else if (word.equals("implements")) keyword = "IMPLEMENTS";
                else if (word.equals("permits")) keyword = null;
                i = end - 1;
            }
        }
        return depth == 0 ? keyword : null;
    }

    private String relationship(String snapshotId, String source, String target, String kind, String reason, String evidence) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, kind, resolution, reason) VALUES (?, ?, ?, ?, ?, 'RESOLVED', ?)",
                id, snapshotId, source, target, kind, reason);
        addEvidence(id, evidence);
        return id;
    }

    private void addEvidence(String relationshipId, String evidenceId) {
        db.update("INSERT OR IGNORE INTO relationship_evidence VALUES (?, ?)", relationshipId, evidenceId);
    }

    /** Evidence for a resolved name: the token's exact range, with its source line as the snippet. */
    private String evidence(String fileId, ScipIndex.Occurrence occurrence, String[] lines) {
        return evidence(fileId, occurrence.startLine(), occurrence.startChar(), occurrence.endLine(), occurrence.endChar(), lines, true);
    }

    /** SCIP 0-based lines and end-exclusive characters become evidence's 1-based lines and inclusive end column. */
    private String evidence(String fileId, int startLine, int startChar, int endLine, int endChar, String[] lines, boolean lineSnippet) {
        String snippet;
        if (lineSnippet) {
            snippet = startLine < lines.length ? lines[startLine].strip() : "";
        } else {
            StringBuilder text = new StringBuilder();
            for (int line = startLine; line <= endLine && line < lines.length; line++) {
                String value = lines[line];
                int from = line == startLine ? Math.min(startChar, value.length()) : 0;
                int to = line == endLine ? Math.min(endChar, value.length()) : value.length();
                text.append(value, Math.min(from, to), to);
                if (line < endLine) text.append('\n');
            }
            snippet = text.toString();
        }
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO evidence (id, source_file_version_id, start_line, start_column, end_line, end_column, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, fileId, startLine + 1, startChar + 1, endLine + 1, endChar, snippet);
        return id;
    }

    private static String text(String[] lines, ScipIndex.Occurrence occurrence) {
        if (occurrence.startLine() >= lines.length || occurrence.endLine() != occurrence.startLine()) return "";
        String line = lines[occurrence.startLine()];
        return line.substring(Math.min(occurrence.startChar(), line.length()), Math.min(occurrence.endChar(), line.length()));
    }

    private static String before(String[] lines, ScipIndex.Occurrence occurrence) {
        if (occurrence.startLine() >= lines.length) return "";
        String line = lines[occurrence.startLine()];
        return line.substring(0, Math.min(occurrence.startChar(), line.length()));
    }

    private static int compare(int lineA, int charA, int lineB, int charB) {
        return lineA != lineB ? Integer.compare(lineA, lineB) : Integer.compare(charA, charB);
    }

    private String relative(File file) {
        return root.relativize(file.toPath().toAbsolutePath().normalize()).toString().replace(File.separatorChar, '/');
    }

    private static String hash(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @java.lang.Override
    public boolean supportsFrameworkPass() {
        return true;
    }

    @java.lang.Override
    public int runFrameworkPass(List<File> files, String workspaceId, String snapshotId, IntConsumer completedFileCount) {
        return SpringFrameworkPass.run(springAnalyzer, files, workspaceId, snapshotId, completedFileCount, diagnostics::add);
    }

    @java.lang.Override
    public List<String> diagnostics() {
        return List.copyOf(diagnostics);
    }

    @java.lang.Override
    public void addDiagnostic(String message) {
        diagnostics.add(message);
    }

    @java.lang.Override
    public void releaseRunCaches() {
        diagnostics.clear();
        documents.clear();
        infoByKey.clear();
        graphSymbols.clear();
        idCache.clear();
        overrides.clear();
        declaredSupertypes.clear();
    }
}
