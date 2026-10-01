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
    /** Workspace-relative path -> the exact text the build compiled, which the document's ranges belong to. */
    private final Map<String, String> indexedSources = new HashMap<>();
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
        ScipJavaTool.IndexedBuild build = tool.index(layout, diagnostics::add);
        load(build.index(), layout.modulePath());
        loadSources(build.sources(), layout.modulePath());
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

    /** Keeps the indexed text of the workspace's documents, re-keyed from build-root to workspace-relative paths. */
    void loadSources(Map<String, String> sources, String modulePath) {
        String prefix = modulePath == null || modulePath.isEmpty() ? "" : modulePath.endsWith("/") ? modulePath : modulePath + "/";
        sources.forEach((path, content) -> {
            if (path.startsWith(prefix) && documents.containsKey(path.substring(prefix.length()))) indexedSources.put(path.substring(prefix.length()), content);
        });
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
            String relative = relative(file);
            ScipIndex.Document document = documents.get(relative);
            String indexed = document == null ? null : indexedSources.get(relative);
            // The index's ranges belong to the text the build compiled, so that text is what the snapshot keeps.
            String content = indexed != null ? indexed : Files.readString(file.toPath());
            if (indexed != null && !indexed.equals(readIfPresent(file))) {
                diagnostics.add(relative + ": changed on disk while scip-java indexed it; the snapshot shows the copy the build compiled. Re-analyze to pick up the change.");
            }
            String fileId = UUID.randomUUID().toString();
            db.update("INSERT INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) VALUES (?, ?, ?, ?, ?)",
                    fileId, snapshotId, relative, hash(content), content);
            if (document == null) {
                diagnostics.add(relative + ": not compiled by the Gradle build (no scip-java facts); file excluded from graph.");
                return;
            }
            if (indexed == null) {
                diagnostics.add(relative + ": the text the Gradle build compiled is unavailable (no scip-java facts); file excluded from graph.");
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
        String relative = relative(file);
        ScipIndex.Document document = documents.get(relative);
        if (document == null) return;
        List<String> fileIds = db.queryForList("SELECT id FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshotId, relative);
        if (fileIds.isEmpty()) return;
        String fileId = fileIds.get(0);
        String content = indexedSources.get(relative);
        if (content == null) return; // declarations recorded it as excluded
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
                ConstructorSite site = constructorSite(lines, occurrence.startLine(), occurrence.startChar(), occurrence.endLine(), occurrence.endChar());
                if (site == ConstructorSite.NONE) continue;
                boolean reference = site == ConstructorSite.METHOD_REFERENCE;
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
    }

    /** The file's current text on disk, or null when it can no longer be read. */
    private static String readIfPresent(File file) {
        try {
            return Files.readString(file.toPath());
        } catch (IOException e) {
            return null;
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

    /** How a constructor symbol's name occurrence is used. */
    enum ConstructorSite { INSTANCE_CREATION, METHOD_REFERENCE, NONE }

    /**
     * Classifies a constructor-symbol occurrence (SCIP's 0-based start, end-exclusive end) by its significant tokens,
     * across line boundaries. {@code T::new} is a method reference: scip-java's occurrence spans the whole expression
     * (or just {@code new}), so it ends with {@code new} after {@code ::}. Otherwise the tokens before the name
     * decide: {@code new T(..)} (also {@code new pkg.Outer.T(..)}, {@code outer.new T(..)}, {@code new <A> T(..)},
     * {@code new @Ann T(..)}) is an instance creation; anything else ({@code super(..)}, {@code this(..)}, an
     * identifier like {@code renew}) is neither. Whitespace, line comments and block comments between tokens are
     * skipped. Visible for tests.
     */
    static ConstructorSite constructorSite(String[] lines, int startLine, int startChar, int endLine, int endChar) {
        if (startLine < 0 || startLine >= lines.length) return ConstructorSite.NONE;
        if (endLine >= startLine && endLine < lines.length) {
            Backward end = new Backward(lines, endLine, Math.min(Math.max(endChar, 0), lines[endLine].length()));
            if (end.skipSpace() && Character.isJavaIdentifierPart(end.peek()) && end.identifier().equals("new")) {
                return end.skipSpace() && end.peek() == ':' && end.previousIs(':') ? ConstructorSite.METHOD_REFERENCE : ConstructorSite.NONE;
            }
        }
        Backward scan = new Backward(lines, startLine, Math.min(startChar, lines[startLine].length()));
        while (true) {
            if (!scan.skipSpace()) return ConstructorSite.NONE;
            char c = scan.peek();
            if (c == '.') {                                // a qualifier: `pkg.Outer.` or `outer.new` handled below
                scan.back();
                if (!scan.skipSpace()) return ConstructorSite.NONE;
                if (scan.peek() == '>') { if (!scan.skipTypeArguments()) return ConstructorSite.NONE; if (!scan.skipSpace()) return ConstructorSite.NONE; }
                if (!Character.isJavaIdentifierPart(scan.peek())) return ConstructorSite.NONE;
                String word = scan.identifier();
                if (word.equals("new")) return ConstructorSite.INSTANCE_CREATION; // `x.new` cannot precede a name
                skipAnnotationMarker(scan);
                continue;
            }
            if (c == '>') {                                // explicit constructor type arguments: `new <String> T(..)`
                if (!scan.skipTypeArguments()) return ConstructorSite.NONE;
                continue;
            }
            if (c == ')') {                                // an annotation's arguments: `new @Ann(x) T(..)`
                if (!scan.skipParentheses()) return ConstructorSite.NONE;
                if (!scan.skipSpace() || !Character.isJavaIdentifierPart(scan.peek())) return ConstructorSite.NONE;
                String name = scan.identifier();
                if (!skipAnnotationMarker(scan) || name.isEmpty()) return ConstructorSite.NONE;
                continue;
            }
            if (Character.isJavaIdentifierPart(c)) {
                String word = scan.identifier();
                if (word.equals("new")) return ConstructorSite.INSTANCE_CREATION;
                if (skipAnnotationMarker(scan)) continue;      // `new @Ann T(..)`
                Backward probe = scan.copy();
                if (probe.skipSpace() && probe.peek() == '.') continue; // a qualified annotation: `new @a.Ann T(..)`
                return ConstructorSite.NONE;                   // `renew T(..)`, `return T(..)`, ...
            }
            return ConstructorSite.NONE;
        }
    }

    /** Consumes an annotation's {@code @} (allowing whitespace) right before the scan position; false when absent. */
    private static boolean skipAnnotationMarker(Backward scan) {
        Backward probe = scan.copy();
        if (probe.skipSpace() && probe.peek() == '@') {
            probe.back();
            scan.restore(probe);
            return true;
        }
        return false;
    }

    /** A cursor that walks source text backwards across lines, skipping whitespace and comments. */
    private static final class Backward {
        private final String[] lines;
        private int line;
        private int column; // the next character to read is lines[line].charAt(column - 1)

        Backward(String[] lines, int line, int column) { this.lines = lines; this.line = line; this.column = column; }

        Backward copy() { return new Backward(lines, line, column); }
        void restore(Backward other) { line = other.line; column = other.column; }

        /** Moves before whitespace and comments; false at the start of the file. */
        boolean skipSpace() {
            while (true) {
                if (column == 0) {
                    if (line == 0) return false;
                    line--;
                    column = codeLength(lines[line]);
                    continue;
                }
                char c = lines[line].charAt(column - 1);
                if (Character.isWhitespace(c)) { column--; continue; }
                if (c == '/' && column >= 2 && lines[line].charAt(column - 2) == '*') {
                    if (!skipBlockComment()) return false;
                    continue;
                }
                return true;
            }
        }

        /** The line's length without a trailing {@code //} comment (outside string and char literals, best effort). */
        private static int codeLength(String text) {
            boolean inString = false, inChar = false, inBlock = false;
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (inBlock) { if (c == '*' && i + 1 < text.length() && text.charAt(i + 1) == '/') { inBlock = false; i++; } continue; }
                if (inString) { if (c == '\\') i++; else if (c == '"') inString = false; continue; }
                if (inChar) { if (c == '\\') i++; else if (c == '\'') inChar = false; continue; }
                if (c == '"') inString = true;
                else if (c == '\'') inChar = true;
                else if (c == '/' && i + 1 < text.length() && text.charAt(i + 1) == '/') return i;
                else if (c == '/' && i + 1 < text.length() && text.charAt(i + 1) == '*') { inBlock = true; i++; }
            }
            return text.length();
        }

        /** Positioned right after a block comment's closing {@code *}{@code /}: moves before its opening. */
        private boolean skipBlockComment() {
            column -= 2;
            while (true) {
                String text = lines[line];
                int open = text.lastIndexOf("/*", column - 1);
                if (open >= 0) { column = open; return true; }
                if (line == 0) return false;
                line--;
                column = lines[line].length();
            }
        }

        char peek() { return lines[line].charAt(column - 1); }
        void back() { column--; }

        /** Whether the character before the one at the cursor is {@code c} (no skipping). */
        boolean previousIs(char c) { return column >= 2 && lines[line].charAt(column - 2) == c; }

        /** Reads the identifier ending at the cursor and moves before it. */
        String identifier() {
            int end = column;
            while (column > 0 && Character.isJavaIdentifierPart(lines[line].charAt(column - 1))) column--;
            return lines[line].substring(column, end);
        }

        /** Positioned after a {@code >}: moves before the matching {@code <}. */
        boolean skipTypeArguments() { return skipBalanced('>', '<'); }

        /** Positioned after a {@code )}: moves before the matching {@code (}. */
        boolean skipParentheses() { return skipBalanced(')', '('); }

        private boolean skipBalanced(char close, char open) {
            int depth = 0;
            while (true) {
                if (!skipSpace()) return false;
                char c = peek();
                back();
                if (c == close) depth++;
                else if (c == open && --depth == 0) return true;
            }
        }
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
        // The Spring pass's line numbers must match the stored text, so it parses the copy the build compiled.
        return SpringFrameworkPass.run(springAnalyzer, files, file -> indexedSources.get(relative(file)), workspaceId, snapshotId, completedFileCount, diagnostics::add);
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
        indexedSources.clear();
        infoByKey.clear();
        graphSymbols.clear();
        idCache.clear();
        overrides.clear();
        declaredSupertypes.clear();
    }
}
