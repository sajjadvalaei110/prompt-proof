package dev.codeatlas.review;

import org.springframework.stereotype.Component;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Small raw-object Git adapter.  It invokes no shell, does not consult diff drivers/textconv, and never
 * changes the repository.  Materialized files are private temporary input for the Java parser.
 */
@Component
public class GitReviewSourceAdapter {
    private static final Duration TIMEOUT = Duration.ofSeconds(20);
    private static final int MAX_OUTPUT = 32 * 1024 * 1024;
    private static final int MAX_BLOB = 8 * 1024 * 1024;
    private static final long MAX_CAPTURE = 128L * 1024 * 1024;
    private static final int MAX_FILES = 20_000;

    public record Base(String requestedRef, String oid, String warning) {}
    public record Capture(String headOid, String fingerprint, List<String> javaPaths) {}
    /** A non-text file has no trustworthy physical-line total. */
    public record FileDelta(String path, String status, int added, int removed, boolean javaFile, boolean lineCountsAvailable) {}
    public record Hunk(int oldStart, int oldCount, int newStart, int newCount) {}
    /**
     * {@code outsideWorkspace} counts changed files that lie outside the workspace's module path and were left out
     * of the comparison (ADR 0015); paths in {@code files} and {@code hunks} are relative to the workspace.
     */
    public record Diff(List<FileDelta> files, Map<String, List<Hunk>> hunks, int outsideWorkspace) {
        public Diff(List<FileDelta> files, Map<String, List<Hunk>> hunks) { this(files, hunks, 0); }
    }

    public Base resolveBase(Path repo, String requested) {
        if (requested != null && !requested.isBlank()) return new Base(requested.trim(), commit(repo, requested.trim()), null);
        try {
            String upstream = commit(repo, "@{upstream}");
            return new Base(null, text(repo, List.of("merge-base", "HEAD", upstream), 4096).trim(), null);
        } catch (GitFailure ignored) {
            return new Base(null, commit(repo, "HEAD"), "No locally available upstream; comparing the working tree with HEAD.");
        }
    }

    public String headOid(Path repo) { return commit(repo, "HEAD"); }
    /**
     * The Git work tree that holds {@code workspace} (ADR 0015): the nearest directory at or above it with a
     * {@code .git} entry, confirmed by Git as its own top level. Git itself is never asked to search upwards (every
     * call keeps the ceiling at the directory's parent), so an unrelated repository above is never picked up.
     */
    public Path discoverTopLevel(Path workspace) {
        for (Path dir = workspace.toAbsolutePath().normalize(); dir != null; dir = dir.getParent()) {
            if (Files.exists(dir.resolve(".git"), LinkOption.NOFOLLOW_LINKS)) {
                Path top = topLevel(dir);
                if (top.equals(dir)) return dir;
                break;
            }
        }
        throw new IllegalArgumentException("Workspace is not inside a supported local Git worktree.");
    }
    public Path topLevel(Path repo) {
        try { return Path.of(text(repo, List.of("rev-parse", "--show-toplevel"), 16 * 1024).trim()).toAbsolutePath().normalize(); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Workspace is not a supported local Git worktree."); }
    }
    /**
     * Identity of exactly the mutable inputs used for a review.  A diff is deliberately not used here:
     * index flags, attributes, and binary changes can make an otherwise mutable tracked file invisible to it.
     */
    public String comparisonFingerprint(Path repo, String base) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digestPart(digest, "head", headOid(repo).getBytes(StandardCharsets.UTF_8));
            digestPart(digest, "base", base.getBytes(StandardCharsets.UTF_8));
            List<String> paths = new ArrayList<>();
            paths.addAll(nulList(repo, List.of("ls-files", "-z", "--cached")));
            paths.addAll(nulList(repo, List.of("ls-files", "-z", "--others", "--exclude-standard")));
            List<String> distinct = paths.stream().distinct().sorted().toList();
            if (distinct.size() > MAX_FILES) throw new IllegalArgumentException("Review capture contains too many files.");
            long bytes = 0;
            for (String path : distinct) bytes = addBounded(bytes, digestWorkingFile(digest, repo, path));
            return HexFormat.of().formatHex(digest.digest());
        } catch (GitFailure e) { throw e; }
        catch (Exception e) { throw new IllegalArgumentException("Could not freeze the working-tree review input."); }
    }

    public Capture materializeBase(Path repo, String oid, Path destination) { return materializeBase(repo, oid, destination, ""); }

    /**
     * Writes the base commit's source files under {@code modulePath} (a Git-root-relative directory, empty for the
     * whole repository) to {@code destination}, keyed relative to that module so a capture is laid out like the
     * workspace it belongs to (ADR 0015).
     */
    public Capture materializeBase(Path repo, String oid, Path destination, String modulePath) {
        createDirectory(destination);
        record TreeEntry(String mode, String type, String object, String path) {}
        List<TreeEntry> entries = new ArrayList<>();
        for (String row : nulList(repo, List.of("ls-tree", "-r", "-z", "--full-tree", oid))) {
            int tab = row.indexOf('\t'); if (tab < 0) continue;
            String[] metadata = row.substring(0, tab).split(" ");
            if (metadata.length == 3) entries.add(new TreeEntry(metadata[0], metadata[1], metadata[2], row.substring(tab + 1)));
        }
        List<TreeEntry> javaEntries = entries.stream().filter(e -> capturedPath(e.path(), modulePath) != null).toList();
        if (javaEntries.size() > MAX_FILES) throw new IllegalArgumentException("Review capture contains too many Java files.");
        long[] bytes = {0};
        List<String> written = new ArrayList<>();
        for (TreeEntry entry : javaEntries) {
            validatePath(entry.path());
            String path = capturedPath(entry.path(), modulePath);
            // Raw-tree mode/type validation keeps symlinks and submodules out of parser input.
            if (!"blob".equals(entry.type()) || (!"100644".equals(entry.mode()) && !"100755".equals(entry.mode()))) continue;
            byte[] content = bytes(repo, List.of("cat-file", "blob", entry.object()), MAX_BLOB);
            bytes[0] = addBounded(bytes[0], content.length);
            write(destination, path, content);
            written.add(path);
        }
        return new Capture(oid, fingerprint(oid, written, destination), List.copyOf(written));
    }

    public Capture materializeWorkingTree(Path repo, Path destination) { return materializeWorkingTree(repo, destination, ""); }

    /** The working tree's counterpart of {@link #materializeBase(Path, String, Path, String)}. */
    public Capture materializeWorkingTree(Path repo, Path destination, String modulePath) {
        createDirectory(destination);
        // --cached names are sufficient: each is read as a raw filesystem path below.  Asking Git to
        // determine modified/deleted state may invoke a repository-configured clean filter.
        List<String> listed = nulList(repo, List.of("ls-files", "-z", "--cached", "--others", "--exclude-standard"));
        List<String> javaPaths = listed.stream().distinct().filter(p -> capturedPath(p, modulePath) != null).sorted().toList();
        if (javaPaths.size() > MAX_FILES) throw new IllegalArgumentException("Review capture contains too many Java files.");
        long[] bytes = {0};
        List<String> written = new ArrayList<>();
        for (String path : javaPaths) {
            validatePath(path);
            Path source = safeWorkingFile(repo, path);
            if (!Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) continue;
            try {
                byte[] content = readFileBounded(source);
                bytes[0] = addBounded(bytes[0], content.length);
                String captured = capturedPath(path, modulePath);
                write(destination, captured, content);
                written.add(captured);
            } catch (IOException e) {
                throw new IllegalArgumentException("Could not read a working-tree source file.");
            }
        }
        String oid = headOid(repo);
        return new Capture(oid, fingerprint(oid, written, destination), List.copyOf(written));
    }

    public List<FileDelta> fileDeltas(Path repo, String base) { return diff(repo, base).files(); }
    public Map<String, List<Hunk>> hunks(Path repo, String base) { return diff(repo, base).hunks(); }

    /**
     * Compares raw commit blobs to raw working-tree bytes.  The only diff process is run in a fresh
     * private directory, so repository attributes, filters, diff drivers, hooks, and fsmonitor cannot run.
     */
    public Diff diff(Path repo, String base) { return diff(repo, base, ""); }

    /** Changed files under {@code modulePath}, keyed relative to it; the rest are only counted (ADR 0015). */
    public Diff diff(Path repo, String base, String modulePath) {
        Map<String, Blob> baseObjects = treeBlobs(repo, base);
        Set<String> workingPaths = new TreeSet<>(nulList(repo, List.of("ls-files", "-z", "--cached")));
        workingPaths.addAll(nulList(repo, List.of("ls-files", "-z", "--others", "--exclude-standard")));
        Set<String> paths = new TreeSet<>(baseObjects.keySet());
        paths.addAll(workingPaths);
        if (paths.size() > MAX_FILES) throw new IllegalArgumentException("Review capture contains too many files.");
        List<FileDelta> files = new ArrayList<>();
        Map<String, List<Hunk>> hunks = new HashMap<>();
        long baseBytes = 0, headBytes = 0;
        int outside = 0;
        for (String path : paths) {
            validatePath(path);
            String scoped = scoped(path, modulePath);
            byte[] before = null, after = null;
            Blob object = baseObjects.get(path);
            if (object != null) { before = bytes(repo, List.of("cat-file", "blob", object.oid()), MAX_BLOB); baseBytes = addBounded(baseBytes, before.length); }
            try {
                Path file = safeWorkingFile(repo, path);
                if (workingPaths.contains(path) && Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) { after = readFileBounded(file); headBytes = addBounded(headBytes, after.length); }
            } catch (IOException e) { throw new IllegalArgumentException("Could not read a working-tree file for review."); }
            boolean modeChanged = object != null && after != null
                    && (object.executable() != Files.isExecutable(repo.resolve(path)));
            if (Arrays.equals(before, after) && !modeChanged) continue;
            if (scoped == null) { outside++; continue; }
            String status = before == null ? "ADDED" : after == null ? "DELETED" : "MODIFIED";
            boolean available = (before == null || isText(before)) && (after == null || isText(after));
            List<Hunk> fileHunks = available ? privateHunks(before, after) : List.of();
            int added = fileHunks.stream().mapToInt(Hunk::newCount).sum();
            int removed = fileHunks.stream().mapToInt(Hunk::oldCount).sum();
            files.add(new FileDelta(scoped, status, added, removed, javaPath(path) && javaPath(scoped), available));
            if (!fileHunks.isEmpty()) hunks.put(scoped, fileHunks);
        }
        return new Diff(List.copyOf(files), Map.copyOf(hunks), outside);
    }

    private String commit(Path repo, String expression) {
        if (expression.startsWith("-") || expression.indexOf('\u0000') >= 0 || expression.indexOf('\n') >= 0 || expression.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("Invalid baseRef.");
        }
        return text(repo, List.of("rev-parse", "--verify", "--end-of-options", expression + "^{commit}"), 4096).trim();
    }
    private List<String> nulList(Path repo, List<String> args) {
        try {
            String output = StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes(repo, args, MAX_OUTPUT))).toString();
            return Arrays.stream(output.split("\\u0000", -1)).filter(s -> !s.isEmpty()).toList();
        } catch (java.nio.charset.CharacterCodingException e) {
            throw new IllegalArgumentException("Review requires UTF-8 Git filenames.");
        }
    }
    private String text(Path repo, List<String> args, int max) { return new String(bytes(repo, args, max), StandardCharsets.UTF_8); }
    private byte[] bytes(Path repo, List<String> args, int max) { return runGit(repo, args, max, false); }

    /** No shell, no inherited Git redirections, bounded concurrent output drains and process lifetime. */
    private byte[] runGit(Path directory, List<String> args, int max, boolean diffExit) {
        List<String> command = new ArrayList<>(List.of("git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
                "-c", "core.pager=cat", "-c", "protocol.allow=never", "-c", "core.attributesFile=/dev/null", "-C", directory.toString()));
        command.addAll(args);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.environment().keySet().removeIf(key -> key.startsWith("GIT_"));
        builder.environment().putAll(Map.of("GIT_CONFIG_NOSYSTEM", "1", "GIT_CONFIG_GLOBAL", "/dev/null",
                "GIT_ATTR_NOSYSTEM", "1", "GIT_OPTIONAL_LOCKS", "0", "GIT_TERMINAL_PROMPT", "0",
                "GIT_NO_LAZY_FETCH", "1", "GIT_NO_REPLACE_OBJECTS", "1",
                "GIT_CEILING_DIRECTORIES", directory.getParent().toString()));
        Process process = null;
        try {
            process = builder.start();
            Process running = process;
            AtomicReference<byte[]> output = new AtomicReference<>();
            AtomicReference<IOException> failure = new AtomicReference<>();
            Thread reader = Thread.ofVirtual().start(() -> {
                try (InputStream in = running.getInputStream()) { output.set(readBounded(in, max)); }
                catch (IOException e) { failure.set(e); running.destroyForcibly(); }
            });
            Thread errors = Thread.ofVirtual().start(() -> {
                try (InputStream in = running.getErrorStream()) { readBounded(in, 8192); }
                catch (IOException e) { failure.set(e); running.destroyForcibly(); }
            });
            if (!process.waitFor(TIMEOUT.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS)) throw new GitFailure();
            reader.join(TIMEOUT.toMillis()); errors.join(TIMEOUT.toMillis());
            int exit = process.exitValue();
            if (failure.get() != null || output.get() == null || (exit != 0 && !(diffExit && exit == 1))) throw new GitFailure();
            return output.get();
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new GitFailure(); }
        catch (IOException e) { throw new IllegalArgumentException("Git is unavailable for this workspace."); }
        finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
    }
    private static byte[] readBounded(InputStream in, int maximum) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] chunk = new byte[8192]; int read;
        while ((read = in.read(chunk)) >= 0) { if (out.size() + read > maximum) throw new IOException("output limit"); out.write(chunk, 0, read); }
        return out.toByteArray();
    }
    private void write(Path root, String relative, byte[] content) {
        try { Path target = root.resolve(relative).normalize(); if (!target.startsWith(root)) throw new IllegalArgumentException("Invalid Git path."); Files.createDirectories(target.getParent()); Files.write(target, content, StandardOpenOption.CREATE_NEW); }
        catch (IOException e) { throw new IllegalArgumentException("Could not materialize review source."); }
    }
    private static void createDirectory(Path path) {
        try { Files.createDirectories(path); } catch (IOException e) { throw new IllegalArgumentException("Could not prepare review source storage."); }
    }
    private static byte[] readFileBounded(Path source) throws IOException {
        try (InputStream input = Files.newInputStream(source, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) { return readBounded(input, MAX_BLOB); }
    }
    private static Path safeWorkingFile(Path repo, String relative) {
        Path candidate = repo.resolve(relative).normalize();
        if (!candidate.startsWith(repo)) throw new IllegalArgumentException("Unsupported Git path in review capture.");
        Path current = repo;
        for (Path part : repo.relativize(candidate)) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw new IllegalArgumentException("Symbolic links are not supported in review capture.");
        }
        return candidate;
    }
    private static long digestWorkingFile(MessageDigest digest, Path repo, String path) throws IOException {
        validatePath(path);
        digestPart(digest, "working-path", path.getBytes(StandardCharsets.UTF_8));
        Path file = safeWorkingFile(repo, path);
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) {
            digestPart(digest, "working-state", "absent".getBytes(StandardCharsets.UTF_8));
            return 0;
        } else if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            // The source policy never follows symlinks or reads special files, but records their presence.
            digestPart(digest, "working-state", "non-regular".getBytes(StandardCharsets.UTF_8));
            return 0;
        } else {
            digestPart(digest, "working-state", (Files.isExecutable(file) ? "executable" : "regular").getBytes(StandardCharsets.UTF_8));
            byte[] content = readFileBounded(file);
            digestPart(digest, "working-content", content);
            return content.length;
        }
    }
    private record Blob(String oid, boolean executable) {}
    private Map<String, Blob> treeBlobs(Path repo, String oid) {
        Map<String, Blob> result = new TreeMap<>();
        for (String row : nulList(repo, List.of("ls-tree", "-r", "-z", "--full-tree", oid))) {
            int tab = row.indexOf('\t');
            if (tab < 0) continue;
            String[] metadata = row.substring(0, tab).split(" ");
            String path = row.substring(tab + 1);
            if (metadata.length != 3 || !"blob".equals(metadata[1]) ||
                    (!"100644".equals(metadata[0]) && !"100755".equals(metadata[0]))) {
                throw new IllegalArgumentException("Review of a base containing symbolic links or submodules is not supported.");
            }
            validatePath(path);
            result.put(path, new Blob(metadata[2], "100755".equals(metadata[0])));
        }
        return result;
    }
    private List<Hunk> privateHunks(byte[] before, byte[] after) {
        Path directory = null;
        try {
            directory = Files.createTempDirectory("code-atlas-raw-diff-");
            Path oldFile = directory.resolve("before");
            Path newFile = directory.resolve("after");
            // Empty stand-ins let --no-index generate an ordinary add/delete hunk for an absent side.
            Files.write(oldFile, before == null ? new byte[0] : before, StandardOpenOption.CREATE_NEW);
            Files.write(newFile, after == null ? new byte[0] : after, StandardOpenOption.CREATE_NEW);
            byte[] output = runGit(directory, List.of("diff", "--no-index", "--no-ext-diff", "--no-textconv",
                    "--unified=0", "--no-color", "--", oldFile.toString(), newFile.toString()), MAX_OUTPUT, true);
            List<Hunk> result = new ArrayList<>();
            for (String line : new String(output, StandardCharsets.UTF_8).split("\\n")) if (line.startsWith("@@")) {
                var match = java.util.regex.Pattern.compile("@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@").matcher(line);
                if (match.find()) result.add(new Hunk(Integer.parseInt(match.group(1)), count(match.group(2)), Integer.parseInt(match.group(3)), count(match.group(4))));
            }
            return List.copyOf(result);
        } catch (IOException e) {
            throw new IllegalArgumentException("Raw review comparison could not be run.");
        } finally {
            if (directory != null) try (var paths = Files.walk(directory)) {
                paths.sorted(Comparator.reverseOrder()).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) {} });
            } catch (IOException ignored) { }
        }
    }
    private static void digestPart(MessageDigest digest, String label, byte[] bytes) {
        byte[] name = label.getBytes(StandardCharsets.UTF_8);
        digest.update(java.nio.ByteBuffer.allocate(8).putInt(name.length).putInt(bytes.length).array());
        digest.update(name); digest.update(bytes);
    }
    private static void validatePath(String path) { if (path.isBlank() || path.startsWith("/") || Arrays.asList(path.split("/", -1)).contains("..")) throw new IllegalArgumentException("Unsupported Git path in review capture."); }
    /** {@code path} relative to {@code modulePath}, or null when it lies outside that directory. */
    static String scoped(String path, String modulePath) {
        if (modulePath == null || modulePath.isEmpty()) return path;
        String prefix = modulePath.endsWith("/") ? modulePath : modulePath + "/";
        return path.startsWith(prefix) && path.length() > prefix.length() ? path.substring(prefix.length()) : null;
    }
    /** A captured source path relative to the module, or null; build output is excluded at both levels. */
    private String capturedPath(String path, String modulePath) {
        String scoped = scoped(path, modulePath);
        return scoped != null && javaPath(path) && javaPath(scoped) ? scoped : null;
    }
    private boolean javaPath(String path) { return path.endsWith(".java") && !path.startsWith(".git/") && !path.startsWith("build/") && !path.startsWith("target/") && !path.contains("/build/") && !path.contains("/target/"); }
    private long addBounded(long existing, long add) { if (existing + add > MAX_CAPTURE) throw new IllegalArgumentException("Review capture exceeds the source limit."); return existing + add; }
    private static int count(String value) { return value == null ? 1 : Integer.parseInt(value); }
    private static boolean isText(byte[] content) { for (byte value : content) if (value == 0) return false; return true; }
    private static int lineCount(byte[] content) {
        if (content.length == 0) return 0;
        int lines = 0;
        for (byte value : content) if (value == '\n') lines++;
        return content[content.length - 1] == '\n' ? lines : lines + 1;
    }
    private static String fingerprint(String oid, List<String> paths, Path root) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digestPart(digest, "capture-head", oid.getBytes(StandardCharsets.UTF_8));
            for (String path : paths.stream().sorted().toList()) {
                digestPart(digest, "capture-path", path.getBytes(StandardCharsets.UTF_8));
                digestPart(digest, "capture-content", Files.readAllBytes(root.resolve(path)));
            }
            return HexFormat.of().formatHex(digest.digest());
        }
        catch (Exception e) { throw new IllegalArgumentException("Could not fingerprint review capture."); }
    }
    private static class GitFailure extends IllegalArgumentException {
        GitFailure() { super("Git could not read this local revision, or the comparison exceeded its resource limit."); }
    }
}
