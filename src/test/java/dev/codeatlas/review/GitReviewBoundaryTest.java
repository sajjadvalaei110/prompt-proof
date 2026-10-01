package dev.codeatlas.review;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Independent boundary checks against real Git objects, index and working-tree files. */
class GitReviewBoundaryTest {
    @TempDir Path temporary;
    final GitReviewSourceAdapter adapter = new GitReviewSourceAdapter();

    @Test void readsRawObjectsAndNeverRunsConfiguredFiltersDiffDriversOrFsmonitor() throws Exception {
        Path repo = repository();
        String original = "class Example { int value() { return 1; } }\n";
        Files.writeString(repo.resolve("Example.java"), original);
        Files.writeString(repo.resolve(".gitattributes"), "*.java diff=trap filter=trap\n");
        commit(repo);
        byte[] originalIndex = Files.readAllBytes(repo.resolve(".git/index"));
        Path marker = temporary.resolve("executed");
        Path script = temporary.resolve("trap.sh");
        Files.writeString(script, "#!/bin/sh\nprintf executed > '" + marker + "'\nexit 1\n");
        assertTrue(script.toFile().setExecutable(true));
        for (String setting : List.of("diff.external", "diff.trap.command", "diff.trap.textconv",
                "filter.trap.clean", "filter.trap.smudge", "core.fsmonitor")) git(repo, "config", setting, script.toString());
        String changed = original.replace("return 1", "return 2");
        Files.writeString(repo.resolve("Example.java"), changed);
        String oid = adapter.resolveBase(repo, "HEAD").oid();
        Path base = temporary.resolve("base"), head = temporary.resolve("head");
        adapter.materializeBase(repo, oid, base);
        adapter.materializeWorkingTree(repo, head);
        assertEquals(original, Files.readString(base.resolve("Example.java")));
        assertEquals(changed, Files.readString(head.resolve("Example.java")));
        assertEquals("MODIFIED", adapter.fileDeltas(repo, oid).getFirst().status());
        assertEquals(1, adapter.hunks(repo, oid).get("Example.java").getFirst().newCount());
        assertFalse(Files.exists(marker), "No target-configured executable may run");
        assertArrayEquals(originalIndex, Files.readAllBytes(repo.resolve(".git/index")));
    }

    @Test void committedJavaSymlinkIsNeverMaterializedAsSource() throws Exception {
        Path repo = repository();
        Files.writeString(repo.resolve("Real.java"), "class Real {}\n");
        Files.createSymbolicLink(repo.resolve("Link.java"), Path.of("Real.java"));
        commit(repo);
        Path base = temporary.resolve("base");
        var capture = adapter.materializeBase(repo, adapter.headOid(repo), base);
        assertFalse(Files.exists(base.resolve("Link.java")));
        assertFalse(capture.javaPaths().contains("Link.java"));
        assertEquals("class Real {}\n", Files.readString(base.resolve("Real.java")));
    }

    @Test void replacedAncestorSymlinkCannotReadOutsideRepository() throws Exception {
        Path repo = repository();
        Files.createDirectories(repo.resolve("src"));
        Files.writeString(repo.resolve("src/Example.java"), "class Example {}\n");
        commit(repo);
        Files.delete(repo.resolve("src/Example.java")); Files.delete(repo.resolve("src"));
        Path outside = Files.createDirectory(temporary.resolve("outside"));
        Files.writeString(outside.resolve("Example.java"), "class PrivateOutside {}\n");
        Files.createSymbolicLink(repo.resolve("src"), outside);
        Path capture = temporary.resolve("head");
        try { adapter.materializeWorkingTree(repo, capture); }
        catch (IllegalArgumentException acceptableRejection) { /* explicit rejection is safe too */ }
        assertFalse(Files.exists(capture.resolve("src/Example.java")), "Ancestor symlinks must not import external source");
    }

    @Test void quotedGitPathsAndDiffConfigurationCannotLoseHunks() throws Exception {
        Path repo = repository();
        String path = "Odd\tName.java";
        Files.writeString(repo.resolve(path), "class Example {\n  int n = 1;\n}\n"); commit(repo);
        git(repo, "config", "diff.noprefix", "true");
        Files.writeString(repo.resolve(path), "class Example {\n  int n = 2;\n}\n");
        var hunks = adapter.hunks(repo, adapter.headOid(repo));
        assertTrue(hunks.containsKey(path), "Quoted Git paths must retain their exact file identity");
        assertEquals(2, hunks.get(path).getFirst().oldStart());
        assertEquals(1, hunks.get(path).getFirst().oldCount());
        assertEquals(1, hunks.get(path).getFirst().newCount());
    }

    @Test void addingLinesToExistingFileIsModificationAndUsesFinalUnstagedContent() throws Exception {
        Path repo = repository();
        Files.writeString(repo.resolve("Example.java"), "class Example {\n}\n"); commit(repo);
        Files.writeString(repo.resolve("Example.java"), "class Example {\n  int staged;\n}\n");
        git(repo, "add", "Example.java");
        String unstaged = "class Example {\n  int finalValue;\n  int more;\n}\n";
        Files.writeString(repo.resolve("Example.java"), unstaged);
        var files = adapter.fileDeltas(repo, adapter.headOid(repo));
        assertEquals("MODIFIED", files.getFirst().status());
        assertEquals(2, files.getFirst().added());
        assertEquals(0, files.getFirst().removed());
        Path capture = temporary.resolve("head");
        adapter.materializeWorkingTree(repo, capture);
        assertEquals(unstaged, Files.readString(capture.resolve("Example.java")));
    }

    @Test void defaultUsesCommonAncestorAndFallbackIsVisible() throws Exception {
        Path repo = repository();
        Files.writeString(repo.resolve("Example.java"), "class Example {}\n"); commit(repo);
        String ancestor = adapter.headOid(repo);
        assertEquals(ancestor, adapter.resolveBase(repo, null).oid());
        assertNotNull(adapter.resolveBase(repo, null).warning());
        git(repo, "checkout", "-b", "feature");
        Files.writeString(repo.resolve("feature.txt"), "feature\n"); commit(repo);
        git(repo, "checkout", "main");
        Files.writeString(repo.resolve("upstream.txt"), "upstream\n"); commit(repo);
        git(repo, "checkout", "feature");
        git(repo, "branch", "--set-upstream-to=main");
        var base = adapter.resolveBase(repo, null);
        assertEquals(ancestor, base.oid());
        assertNull(base.warning());
    }

    @Test void deletionOfLastJavaFileStillProducesValidEmptyCapture() throws Exception {
        Path repo = repository();
        Files.writeString(repo.resolve("Example.java"), "class Example {\n}\n"); commit(repo);
        Files.delete(repo.resolve("Example.java"));
        Path head = temporary.resolve("head");
        var capture = adapter.materializeWorkingTree(repo, head);
        assertTrue(Files.isDirectory(head));
        assertTrue(capture.javaPaths().isEmpty());
        assertEquals(2, adapter.fileDeltas(repo, adapter.headOid(repo)).getFirst().removed());
    }

    @Test void optionLikeBaseRefIsRejected() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> adapter.resolveBase(repository(), "--help"));
    }

    @Test void assumeUnchangedJavaEditStillUsesRawWorkingBytes() throws Exception {
        Path repo = repository();
        Files.writeString(repo.resolve("Example.java"), "class Example {\n  int value() { return 1; }\n}\n");
        commit(repo);
        git(repo, "update-index", "--assume-unchanged", "Example.java");
        Files.writeString(repo.resolve("Example.java"), "class Example {\n  int value() { return 2; }\n}\n");
        var diff = adapter.diff(repo, adapter.headOid(repo));
        assertEquals(1, diff.files().size());
        assertEquals("MODIFIED", diff.files().getFirst().status());
        assertEquals(1, diff.files().getFirst().added());
        assertEquals(1, diff.files().getFirst().removed());
        assertEquals(1, diff.hunks().get("Example.java").getFirst().newCount());
    }

    @Test void binaryUntrackedFileHasExplicitlyUnavailableLineCounts() throws Exception {
        Path repo = repository();
        git(repo, "commit", "--allow-empty", "-m", "Initial baseline");
        Files.write(repo.resolve("new.bin"), new byte[] {1, 0, 2});
        var delta = adapter.fileDeltas(repo, adapter.headOid(repo)).getFirst();
        assertEquals("ADDED", delta.status());
        assertFalse(delta.lineCountsAvailable());
        assertEquals(0, delta.added());
        assertFalse(adapter.hunks(repo, adapter.headOid(repo)).containsKey("new.bin"));
    }

    @Test void aModulePathScopesTheCaptureAndTheDiffAndKeysThemRelativeToTheModule() throws Exception {
        Path repo = repository();
        Files.createDirectories(repo.resolve("mod/src/demo"));
        Files.createDirectories(repo.resolve("other"));
        Files.writeString(repo.resolve("mod/src/demo/A.java"), "class A {}\n");
        Files.writeString(repo.resolve("other/B.java"), "class B {}\n");
        commit(repo);
        Files.writeString(repo.resolve("mod/src/demo/A.java"), "class A { int a; }\n");
        Files.writeString(repo.resolve("mod/src/demo/New.java"), "class New {}\n");
        Files.writeString(repo.resolve("other/B.java"), "class B { int b; }\n");
        Files.createDirectories(repo.resolve("mod/build"));
        Files.writeString(repo.resolve("mod/build/Out.java"), "class Out {}\n");
        // A directory that merely starts with the module's name is outside it.
        Files.createDirectories(repo.resolve("mod-two"));
        Files.writeString(repo.resolve("mod-two/C.java"), "class C {}\n");
        String oid = adapter.headOid(repo);

        GitReviewSourceAdapter.Diff diff = adapter.diff(repo, oid, "mod");
        assertEquals(List.of("build/Out.java", "src/demo/A.java", "src/demo/New.java"), diff.files().stream().map(GitReviewSourceAdapter.FileDelta::path).sorted().toList());
        assertFalse(diff.files().stream().filter(f -> f.path().equals("build/Out.java")).findFirst().orElseThrow().javaFile());
        assertEquals(2, diff.outsideWorkspace());
        assertTrue(diff.hunks().containsKey("src/demo/A.java"));

        Path base = temporary.resolve("module-base"), head = temporary.resolve("module-head");
        assertEquals(List.of("src/demo/A.java"), adapter.materializeBase(repo, oid, base, "mod").javaPaths());
        assertEquals(List.of("src/demo/A.java", "src/demo/New.java"), adapter.materializeWorkingTree(repo, head, "mod").javaPaths());
        assertEquals("class A { int a; }\n", Files.readString(head.resolve("src/demo/A.java")));
        assertFalse(Files.exists(head.resolve("build")));
        assertFalse(Files.exists(head.resolve("other")));
        // Git's top level is found from the module, without asking Git to search upwards on its own.
        assertEquals(repo.toRealPath(), adapter.discoverTopLevel(repo.resolve("mod/src")).toRealPath());
        Path outside = Files.createDirectories(temporary.resolve("not-a-repository"));
        assertThrows(IllegalArgumentException.class, () -> adapter.discoverTopLevel(outside));
    }

    Path repository() throws Exception {
        Path repo = Files.createDirectory(temporary.resolve("repo"));
        git(repo, "init", "--initial-branch=main");
        git(repo, "config", "user.name", "Review Boundary Test");
        git(repo, "config", "user.email", "review@example.invalid");
        git(repo, "config", "commit.gpgsign", "false");
        return repo;
    }
    void commit(Path repo) throws Exception { git(repo, "add", "."); git(repo, "commit", "-m", "fixture"); }
    void git(Path repo, String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of("git", "-C", repo.toString()));
        command.addAll(List.of(arguments));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.environment().put("GIT_CONFIG_NOSYSTEM", "1");
        builder.environment().put("GIT_CONFIG_GLOBAL", "/dev/null");
        Process process = builder.start();
        assertTrue(process.waitFor(10, TimeUnit.SECONDS));
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, process.exitValue(), output);
    }
}
