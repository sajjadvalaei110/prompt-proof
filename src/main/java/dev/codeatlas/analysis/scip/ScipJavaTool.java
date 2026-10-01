package dev.codeatlas.analysis.scip;

import dev.codeatlas.config.CodeAtlasProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.stream.Stream;

/**
 * Locates, and runs, the scip-java indexer against a workspace's Gradle build (ADR 0012).
 *
 * <p>The target repository stays read-only: the Gradle build root is copied (without build outputs, VCS data or
 * dependency folders) into a private directory under {@code codeatlas.data-dir}, and scip-java runs Gradle there.
 * Gradle keeps using the machine's own Gradle user home, so the wrapper distribution and every dependency that is
 * already in the local cache are reused, and the first attempt is {@code --offline} by default.</p>
 */
@Component
public class ScipJavaTool {

    private static final Logger log = LoggerFactory.getLogger(ScipJavaTool.class);
    private static final String MAIN_CLASS = "com.sourcegraph.scip_java.ScipJava";
    private static final Set<String> SKIPPED_DIRECTORIES = Set.of(".git", ".gradle", "build", "out", "target", "node_modules", ".idea");
    private static final List<String> SETTINGS_FILES = List.of("settings.gradle", "settings.gradle.kts");
    private static final List<String> BUILD_FILES = List.of("build.gradle", "build.gradle.kts");
    private static final int LOG_TAIL_LINES = 25;

    /**
     * Where a workspace sits inside its repository: the Gradle build root scip-java runs in, the Git root that
     * bounds the search (null outside Git), and the workspace's path relative to the build root.
     */
    public record BuildLayout(Path buildRoot, Path gitRoot, Path workspaceRoot, String modulePath) {}

    private final CodeAtlasProperties properties;

    public ScipJavaTool(CodeAtlasProperties properties) {
        this.properties = properties;
    }

    private CodeAtlasProperties.ScipJava settings() {
        return properties.getIndexers().getScipJava();
    }

    /** The jar directory scip-java is launched from, when it contains the scip-java jar. */
    Path home() {
        String configured = settings().getHome();
        Path home = configured == null || configured.isBlank()
                ? Path.of(properties.getDataDir(), "tools", "scip-java") : Path.of(configured);
        return home.toAbsolutePath().normalize();
    }

    /** The command prefix that starts scip-java, or empty when it is not installed. */
    public Optional<List<String>> launcher() {
        Path home = home();
        for (Path lib : List.of(home.resolve("lib"), home)) {
            if (containsScipJavaJar(lib)) {
                String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
                return Optional.of(List.of(java, "-cp", lib + File.separator + "*", MAIN_CLASS));
            }
        }
        String command = settings().getCommand();
        if (command != null && !command.isBlank()) {
            Optional<Path> onPath = findOnPath(command.trim());
            if (onPath.isPresent()) return Optional.of(List.of(onPath.get().toString()));
        }
        return Optional.empty();
    }

    public Optional<String> unavailableReason() {
        if (launcher().isPresent()) return Optional.empty();
        return Optional.of("scip-java is not installed. Run ./gradlew installScipJava in the Code Atlas checkout "
                + "(it installs into " + home() + "), or put a scip-java command on PATH, then restart Code Atlas.");
    }

    private static boolean containsScipJavaJar(Path directory) {
        if (!Files.isDirectory(directory)) return false;
        try (Stream<Path> files = Files.list(directory)) {
            return files.anyMatch(p -> p.getFileName().toString().startsWith("scip-java_") && p.toString().endsWith(".jar"));
        } catch (IOException e) {
            return false;
        }
    }

    private static Optional<Path> findOnPath(String command) {
        Path direct = Path.of(command);
        if (direct.isAbsolute()) return Files.isExecutable(direct) ? Optional.of(direct) : Optional.empty();
        String path = System.getenv("PATH");
        if (path == null) return Optional.empty();
        for (String entry : path.split(File.pathSeparator)) {
            if (entry.isBlank()) continue;
            Path candidate = Path.of(entry, command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return Optional.of(candidate);
        }
        return Optional.empty();
    }

    /**
     * Finds the Gradle build that owns {@code workspaceRoot}: the nearest directory at or above it with a
     * settings file, else the nearest with a build file. The search never leaves the enclosing Git repository,
     * so a workspace inside a repository is never built with an unrelated build above it.
     */
    public static BuildLayout locate(Path workspaceRoot) {
        return locate(workspaceRoot, null);
    }

    /**
     * {@link #locate(Path)} bounded by an explicit repository root (ADR 0015), or by the nearest {@code .git} when
     * {@code boundary} is null. The walk checks the boundary itself and never goes above it.
     */
    public static BuildLayout locate(Path workspaceRoot, Path boundary) {
        Path workspace = workspaceRoot.toAbsolutePath().normalize();
        return find(workspace, boundary).orElseThrow(() -> {
            Path limit = limit(workspace, boundary);
            return new IllegalArgumentException("scip-java needs a Gradle build: no settings.gradle(.kts) or build.gradle(.kts) was found at "
                    + workspace + (limit != null ? (boundary != null ? " or above it inside the repository root " : " or above it inside the Git repository at ") + limit : " or above it") + ".");
        });
    }

    /** The build layout for {@code workspaceRoot} within {@code boundary} (null: the nearest Git root), or empty. */
    public static Optional<BuildLayout> find(Path workspaceRoot, Path boundary) {
        Path workspace = workspaceRoot.toAbsolutePath().normalize();
        Path gitRoot = limit(workspace, boundary);
        Path settingsRoot = null, buildFileRoot = null;
        for (Path dir = workspace; dir != null; dir = dir.getParent()) {
            if (settingsRoot == null && containsAny(dir, SETTINGS_FILES)) settingsRoot = dir;
            if (buildFileRoot == null && containsAny(dir, BUILD_FILES)) buildFileRoot = dir;
            if (settingsRoot != null || dir.equals(gitRoot)) break;
        }
        Path buildRoot = settingsRoot != null ? settingsRoot : buildFileRoot;
        if (buildRoot == null) return Optional.empty();
        return Optional.of(new BuildLayout(buildRoot, gitRoot, workspace, buildRoot.relativize(workspace).toString().replace(File.separatorChar, '/')));
    }

    private static Path limit(Path workspace, Path boundary) {
        if (boundary != null) {
            Path root = boundary.toAbsolutePath().normalize();
            if (!workspace.startsWith(root)) throw new IllegalArgumentException("The repository root " + root + " does not contain the workspace " + workspace + ".");
            return root;
        }
        for (Path dir = workspace; dir != null; dir = dir.getParent()) {
            if (Files.exists(dir.resolve(".git"), LinkOption.NOFOLLOW_LINKS)) return dir;
        }
        return null;
    }

    private static boolean containsAny(Path directory, List<String> names) {
        return names.stream().anyMatch(f -> Files.isRegularFile(directory.resolve(f), LinkOption.NOFOLLOW_LINKS));
    }

    /**
     * What one scip-java run produced: the index, whose document paths are relative to the build root, and the
     * exact text of the workspace's indexed Java sources as the build compiled them (build-root relative path ->
     * content), read from the private copy after the build finished. The index's ranges belong to that text, which
     * can differ from the repository's files when they change during the build or a build task rewrites sources.
     */
    public record IndexedBuild(ScipIndex index, Map<String, String> sources) {
        public IndexedBuild {
            sources = Map.copyOf(sources);
        }
    }

    /**
     * Runs scip-java for {@code layout} and returns the parsed index with the indexed sources of the workspace.
     * The private copy is deleted afterwards unless {@code keep-work-directory} is set.
     *
     * <p>A failing build throws {@link ScipBuildFailedException}: its message names the failure only, and the
     * build output's tail travels separately so it is never written to the application log.</p>
     */
    public IndexedBuild index(BuildLayout layout, Consumer<String> diagnostics) {
        List<String> launcher = launcher().orElseThrow(() -> new IllegalStateException(unavailableReason().orElse("scip-java is unavailable")));
        Path work = Path.of(properties.getDataDir(), "indexer-work", "scip-java-" + UUID.randomUUID()).toAbsolutePath().normalize();
        try {
            Path source = work.resolve("source");
            copyBuild(layout.buildRoot(), source, work);
            Path output = work.resolve("index.scip");
            String mode = settings().getDependencyMode() == null ? "offline-first" : settings().getDependencyMode().trim().toLowerCase(Locale.ROOT);
            boolean offlineFirst = !mode.equals("online");
            Attempt attempt = run(launcher, source, output, work.resolve("scip-java-offline.log"), offlineFirst);
            if (!attempt.succeeded() && offlineFirst && mode.equals("offline-first") && attempt.missingOfflineDependency()) {
                diagnostics.accept("scip-java: Gradle needed dependencies that are not in the local Gradle cache; they were resolved online. "
                        + "Dependencies already in the cache were reused.");
                attempt = run(launcher, source, output, work.resolve("scip-java-online.log"), false);
            }
            if (!attempt.succeeded()) {
                throw new ScipBuildFailedException("scip-java could not index the Gradle build at " + layout.buildRoot()
                        + " (" + attempt.failure() + ").", attempt.tail());
            }
            ScipIndex index = ScipIndex.read(output);
            return new IndexedBuild(index, captureSources(index, source, layout.modulePath()));
        } catch (IOException e) {
            throw new IllegalStateException("scip-java indexing failed: " + e.getMessage(), e);
        } finally {
            if (!settings().isKeepWorkDirectory()) deleteRecursively(work);
        }
    }

    /**
     * The text of every indexed {@code .java} document under {@code modulePath} (the workspace, relative to the
     * build root), read from {@code sourceRoot}, keyed by its build-root relative path. Only the workspace's own
     * indexed documents are kept, so memory stays proportional to what becomes graph facts. A document that cannot
     * be read as UTF-8 text is left out; the adapter then treats its file as not indexed.
     */
    public static Map<String, String> captureSources(ScipIndex index, Path sourceRoot, String modulePath) {
        String prefix = modulePath == null || modulePath.isEmpty() ? "" : modulePath.endsWith("/") ? modulePath : modulePath + "/";
        Path root = sourceRoot.toAbsolutePath().normalize();
        Map<String, String> sources = new HashMap<>();
        for (ScipIndex.Document document : index.documents()) {
            String relative = document.relativePath();
            if (!relative.startsWith(prefix) || !relative.endsWith(".java")) continue;
            Path file = root.resolve(relative).normalize();
            // Only a plain path inside the copy (no `..` or `.` segments, no symlink) is read.
            if (!file.startsWith(root) || !root.relativize(file).toString().replace(File.separatorChar, '/').equals(relative)
                    || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
            try {
                sources.put(relative, Files.readString(file, StandardCharsets.UTF_8));
            } catch (IOException e) {
                // Not UTF-8 or unreadable: no indexed text, so the file gets no scip-java facts.
            }
        }
        return sources;
    }

    private record Attempt(boolean succeeded, String failure, String tail, boolean missingOfflineDependency) {}

    private Attempt run(List<String> launcher, Path source, Path output, Path logFile, boolean offline) throws IOException {
        List<String> command = new ArrayList<>(launcher);
        command.addAll(List.of("index", "--build-tool", "gradle", "--output", output.toString(), "--"));
        if (offline) command.add("--offline");
        command.addAll(List.of("clean", "scipPrintDependencies", "scipCompileAll"));
        Files.deleteIfExists(output);
        ProcessBuilder builder = new ProcessBuilder(command).directory(source.toFile())
                .redirectErrorStream(true).redirectOutput(logFile.toFile());
        log.info("Running scip-java ({}) in {}", offline ? "offline" : "online", source);
        Process process = builder.start();
        try {
            boolean finished = process.waitFor(Math.max(1, settings().getTimeoutMinutes()), TimeUnit.MINUTES);
            if (!finished) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                return new Attempt(false, "timed out after " + settings().getTimeoutMinutes() + " minutes", tail(logFile), false);
            }
        } catch (InterruptedException e) {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            return new Attempt(false, "interrupted", tail(logFile), false);
        }
        String text = Files.exists(logFile) ? Files.readString(logFile, StandardCharsets.UTF_8) : "";
        boolean succeeded = process.exitValue() == 0 && Files.isRegularFile(output);
        boolean missing = offline && (text.contains("No cached version") || text.contains("available for offline mode"));
        return new Attempt(succeeded, succeeded ? "" : "exit code " + process.exitValue(), tail(logFile), missing);
    }

    private static String tail(Path logFile) {
        try {
            if (!Files.exists(logFile)) return "";
            List<String> lines = Files.readAllLines(logFile, StandardCharsets.UTF_8);
            return String.join("\n", lines.subList(Math.max(0, lines.size() - LOG_TAIL_LINES), lines.size()));
        } catch (IOException e) {
            return "";
        }
    }

    /**
     * Copies the build root's regular files, skipping symlinks, build outputs, VCS and dependency folders, and the
     * Code Atlas work directory itself when it happens to live inside the repository.
     */
    static void copyBuild(Path buildRoot, Path target, Path work) throws IOException {
        Path root = buildRoot.toAbsolutePath().normalize();
        Path workDirectory = work.toAbsolutePath().normalize();
        Files.createDirectories(target);
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                if (!dir.equals(root) && (attrs.isSymbolicLink() || SKIPPED_DIRECTORIES.contains(dir.getFileName().toString())
                        || dir.startsWith(workDirectory))) {
                    return FileVisitResult.SKIP_SUBTREE;
                }
                Files.createDirectories(target.resolve(root.relativize(dir).toString()));
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                if (attrs.isRegularFile()) {
                    Files.copy(file, target.resolve(root.relativize(file).toString()), StandardCopyOption.COPY_ATTRIBUTES);
                }
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static void deleteRecursively(Path directory) {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return;
        try (Stream<Path> walk = Files.walk(directory)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try { Files.deleteIfExists(p); } catch (IOException ignored) { /* best effort */ }
            });
        } catch (IOException e) {
            log.warn("Could not delete scip-java work directory {}: {}", directory, e.getMessage());
        }
    }
}
