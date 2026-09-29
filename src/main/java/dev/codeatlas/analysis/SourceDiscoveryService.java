package dev.codeatlas.analysis;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public final class SourceDiscoveryService {

    private SourceDiscoveryService() {}

    /**
     * Shared source-only discovery primitive for adapters. It never follows symlinks and excludes
     * only directories within the analyzed root named {@code build}, {@code target}, or
     * {@code .git}; a review capture may itself be stored below an application path containing
     * one of those names.
     */
    public static List<File> discover(File root, String extension) throws IOException {
        if (root == null || extension == null || extension.isBlank()) {
            throw new IllegalArgumentException("A source root and file extension are required");
        }
        Path rootPath = root.toPath().toAbsolutePath().normalize();
        try (Stream<Path> walk = Files.walk(rootPath)) {
            return walk
                .filter(p -> Files.isRegularFile(p, java.nio.file.LinkOption.NOFOLLOW_LINKS))
                .filter(p -> p.getFileName().toString().endsWith(extension))
                .filter(p -> rootPath.relativize(p).getNameCount() == 0 ||
                        Stream.of(rootPath.relativize(p).toString().split(java.util.regex.Pattern.quote(File.separator)))
                                .noneMatch(part -> part.equals("build") || part.equals("target") || part.equals(".git")))
                .map(Path::toFile)
                .collect(Collectors.toList());
        }
    }
}
