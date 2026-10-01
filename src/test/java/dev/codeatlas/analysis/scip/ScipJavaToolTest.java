package dev.codeatlas.analysis.scip;

import dev.codeatlas.config.CodeAtlasProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class ScipJavaToolTest {

    @TempDir Path directory;

    @Test void moduleWorkspaceBuildsFromTheSettingsRootInsideItsGitRepository() throws Exception {
        Path repository = Files.createDirectories(directory.resolve("repo"));
        Files.createDirectories(repository.resolve(".git"));
        Files.writeString(repository.resolve("settings.gradle"), "include 'app'");
        Path module = Files.createDirectories(repository.resolve("services/app"));
        Files.writeString(module.resolve("build.gradle"), "apply plugin: 'java'");

        ScipJavaTool.BuildLayout layout = ScipJavaTool.locate(module);

        assertEquals(repository, layout.buildRoot());
        assertEquals(repository, layout.gitRoot());
        assertEquals("services/app", layout.modulePath());
    }

    @Test void searchStopsAtTheGitRootAndFallsBackToTheNearestBuildFile() throws Exception {
        Files.writeString(directory.resolve("settings.gradle"), "// an unrelated build above the repository");
        Path repository = Files.createDirectories(directory.resolve("repo"));
        Files.createDirectories(repository.resolve(".git"));
        Files.writeString(repository.resolve("build.gradle"), "apply plugin: 'java'");
        Path sources = Files.createDirectories(repository.resolve("src/main/java"));

        ScipJavaTool.BuildLayout layout = ScipJavaTool.locate(sources);

        assertEquals(repository, layout.buildRoot());
        assertEquals("src/main/java", layout.modulePath());
    }

    @Test void workspaceWithoutAGradleBuildIsRejected() throws Exception {
        Path repository = Files.createDirectories(directory.resolve("plain"));
        Files.createDirectories(repository.resolve(".git"));
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> ScipJavaTool.locate(repository));
        assertTrue(error.getMessage().contains("needs a Gradle build"));
    }

    @Test void privateCopySkipsBuildOutputsVcsDataAndSymlinks() throws Exception {
        Path build = Files.createDirectories(directory.resolve("build-root"));
        Files.writeString(build.resolve("settings.gradle"), "");
        Files.createDirectories(build.resolve("src/main/java")).resolve("A.java").toFile().createNewFile();
        Files.createDirectories(build.resolve("build/classes")).resolve("A.class").toFile().createNewFile();
        Files.createDirectories(build.resolve(".git")).resolve("HEAD").toFile().createNewFile();
        Files.createDirectories(build.resolve(".gradle")).resolve("cache").toFile().createNewFile();
        Files.createSymbolicLink(build.resolve("linked"), directory);
        Path target = directory.resolve("work/source");

        ScipJavaTool.copyBuild(build, target, directory.resolve("work"));

        assertTrue(Files.isRegularFile(target.resolve("settings.gradle")));
        assertTrue(Files.isRegularFile(target.resolve("src/main/java/A.java")));
        assertFalse(Files.exists(target.resolve("build")));
        assertFalse(Files.exists(target.resolve(".git")));
        assertFalse(Files.exists(target.resolve(".gradle")));
        assertFalse(Files.exists(target.resolve("linked")));
    }

    @Test void missingToolIsReportedWithSetupInstructions() {
        CodeAtlasProperties properties = new CodeAtlasProperties();
        properties.setDataDir(directory.toString());
        properties.getIndexers().getScipJava().setCommand("definitely-not-a-scip-java-command");
        ScipJavaTool tool = new ScipJavaTool(properties);

        assertTrue(tool.launcher().isEmpty());
        assertTrue(tool.unavailableReason().orElseThrow().contains("installScipJava"));
    }

    @Test void installedJarDirectoryIsLaunchedWithThisJvm() throws Exception {
        CodeAtlasProperties properties = new CodeAtlasProperties();
        Path lib = Files.createDirectories(directory.resolve("tool/lib"));
        Files.createFile(lib.resolve("scip-java_2.13-0.12.3.jar"));
        properties.getIndexers().getScipJava().setHome(directory.resolve("tool").toString());
        ScipJavaTool tool = new ScipJavaTool(properties);

        var launcher = tool.launcher().orElseThrow();
        assertTrue(launcher.get(0).endsWith("java"));
        assertEquals(lib + java.io.File.separator + "*", launcher.get(2));
        assertEquals("com.sourcegraph.scip_java.ScipJava", launcher.get(3));
        assertTrue(tool.unavailableReason().isEmpty());
    }

    /**
     * A stand-in scip-java: records its arguments, fails like Gradle does when an offline build misses the cache,
     * and otherwise writes an empty index to {@code --output}.
     */
    private Path fakeScipJava(String offlineOutput) throws Exception {
        Path script = directory.resolve("fake-scip-java.sh");
        Files.writeString(script, """
                #!/bin/sh
                echo "$@" >> "%s"
                out=""
                prev=""
                for arg in "$@"; do
                  if [ "$prev" = "--output" ]; then out="$arg"; fi
                  prev="$arg"
                done
                case " $* " in
                  *" --offline "*) echo "%s"; exit 1 ;;
                esac
                : > "$out"
                """.formatted(directory.resolve("calls.log"), offlineOutput));
        script.toFile().setExecutable(true);
        return script;
    }

    private ScipJavaTool toolWith(Path command, String mode) {
        CodeAtlasProperties properties = new CodeAtlasProperties();
        properties.setDataDir(directory.resolve("data").toString());
        properties.getIndexers().getScipJava().setHome(directory.resolve("no-home").toString());
        properties.getIndexers().getScipJava().setCommand(command.toString());
        properties.getIndexers().getScipJava().setDependencyMode(mode);
        return new ScipJavaTool(properties);
    }

    private ScipJavaTool.BuildLayout build() throws Exception {
        Path build = Files.createDirectories(directory.resolve("project"));
        Files.writeString(build.resolve("settings.gradle"), "");
        return ScipJavaTool.locate(build);
    }

    @Test void offlineFirstRetriesOnlineOnlyForAMissingCachedDependencyAndSaysSo() throws Exception {
        ScipJavaTool tool = toolWith(fakeScipJava("Could not resolve x:y:1. No cached version of x:y:1 available for offline mode."), "offline-first");
        java.util.List<String> diagnostics = new java.util.ArrayList<>();

        ScipJavaTool.IndexedBuild indexed = tool.index(build(), diagnostics::add);

        assertEquals(0, indexed.index().documents().size());
        assertEquals(java.util.Map.of(), indexed.sources());
        java.util.List<String> calls = Files.readAllLines(directory.resolve("calls.log"));
        assertEquals(2, calls.size());
        assertTrue(calls.get(0).contains("--offline") && calls.get(0).endsWith("clean scipPrintDependencies scipCompileAll"), calls.get(0));
        assertFalse(calls.get(1).contains("--offline"), calls.get(1));
        assertTrue(calls.get(0).contains("index --build-tool gradle --output "));
        assertEquals(1, diagnostics.size());
        assertTrue(diagnostics.get(0).contains("resolved online"));
        try (var work = Files.list(directory.resolve("data/indexer-work"))) {
            assertEquals(0, work.count(), "the private copy is removed after the run");
        }
    }

    @Test void offlineModeNeverGoesOnlineAndACompileFailureIsNotRetried() throws Exception {
        ScipJavaTool offlineOnly = toolWith(fakeScipJava("No cached version of x:y:1 available for offline mode."), "offline");
        ScipBuildFailedException error = assertThrows(ScipBuildFailedException.class, () -> offlineOnly.index(build(), m -> { }));
        assertTrue(error.buildOutputTail().contains("No cached version"), error.buildOutputTail());
        assertFalse(error.getMessage().contains("No cached version"), "build output is not part of the message: " + error.getMessage());
        assertEquals(1, Files.readAllLines(directory.resolve("calls.log")).size());

        Files.delete(directory.resolve("calls.log"));
        ScipJavaTool compileError = toolWith(fakeScipJava("error: cannot find symbol"), "offline-first");
        assertThrows(IllegalStateException.class, () -> compileError.index(build(), m -> { }));
        assertEquals(1, Files.readAllLines(directory.resolve("calls.log")).size(), "a build error is not a cache miss");
    }

    /**
     * Build output can hold credentials or source text (AGENTS.md: keep them out of logs). The thrown exception's
     * message — what AnalysisService logs with its stack trace — names the failure only; the tail is a separate field,
     * and nothing ScipJavaTool logs itself contains it.
     */
    @Test void failedBuildKeepsItsOutputOutOfTheExceptionMessageAndTheLog() throws Exception {
        String secret = "deployToken=s3cr3t-value-from-build-output";
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(ScipJavaTool.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            ScipJavaTool tool = toolWith(fakeScipJava("FAILURE: Build failed with an exception. " + secret), "offline");
            ScipBuildFailedException error = assertThrows(ScipBuildFailedException.class, () -> tool.index(build(), m -> { }));

            assertTrue(error.getMessage().startsWith("scip-java could not index the Gradle build at "), error.getMessage());
            assertTrue(error.getMessage().contains("exit code 1"), error.getMessage());
            assertFalse(error.getMessage().contains(secret), error.getMessage());
            assertFalse(error.toString().contains(secret), "a logged stack trace starts with toString()");
            assertTrue(error.buildOutputTail().contains(secret), "the tail stays available for the user-facing job error");
            assertFalse(appender.list.isEmpty(), "the run itself is logged");
            for (var event : appender.list) {
                assertFalse(event.getFormattedMessage().contains(secret), event.getFormattedMessage());
                assertNull(event.getThrowableProxy(), "ScipJavaTool logs no exception carrying build output");
            }
        } finally {
            logger.detachAppender(appender);
        }
    }

    /**
     * The workspace's indexed sources are captured from the private copy the build compiled — only {@code .java}
     * documents under the workspace module — so the adapter applies the index's ranges to exactly that text.
     */
    @Test void capturedSourcesAreTheIndexedWorkspaceDocumentsFromThePrivateCopy() throws Exception {
        Path copy = Files.createDirectories(directory.resolve("copy"));
        Files.createDirectories(copy.resolve("app/src/main/java/a"));
        Files.createDirectories(copy.resolve("core/src/main/java/b"));
        Files.writeString(copy.resolve("app/src/main/java/a/A.java"), "class A { /* as compiled */ }");
        Files.writeString(copy.resolve("app/src/main/java/a/Gen.kt"), "class Gen");
        Files.writeString(copy.resolve("core/src/main/java/b/B.java"), "class B {}");
        Files.writeString(copy.resolve("app/src/main/java/a/NotIndexed.java"), "class NotIndexed {}");
        Files.createDirectories(copy.resolve("outside"));
        Files.writeString(copy.resolve("outside/X.java"), "class X {}");
        ScipIndex index = new ScipIndex("file://" + copy, java.util.List.of(
                new ScipIndex.Document("app/src/main/java/a/A.java", java.util.List.of(), java.util.List.of()),
                new ScipIndex.Document("app/src/main/java/a/Gen.kt", java.util.List.of(), java.util.List.of()),
                new ScipIndex.Document("app/src/main/java/a/Missing.java", java.util.List.of(), java.util.List.of()),
                new ScipIndex.Document("app/../outside/X.java", java.util.List.of(), java.util.List.of()),
                new ScipIndex.Document("core/src/main/java/b/B.java", java.util.List.of(), java.util.List.of())));

        assertEquals(java.util.Map.of("app/src/main/java/a/A.java", "class A { /* as compiled */ }"), ScipJavaTool.captureSources(index, copy, "app"));
        assertEquals(java.util.Set.of("app/src/main/java/a/A.java", "core/src/main/java/b/B.java"), ScipJavaTool.captureSources(index, copy, "").keySet());
    }
}
