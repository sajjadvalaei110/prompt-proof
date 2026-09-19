package dev.codeatlas.analysis;

import org.springframework.stereotype.Service;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class SourceDiscoveryService {
    public List<File> discoverJavaFiles(File root) throws IOException {
        Path rootPath = root.toPath().toAbsolutePath().normalize();
        try (Stream<Path> walk = Files.walk(rootPath)) {
            return walk
                .filter(p -> Files.isRegularFile(p, java.nio.file.LinkOption.NOFOLLOW_LINKS))
                .filter(p -> p.getFileName().toString().endsWith(".java"))
                // Only directories inside the analyzed root are excluded. Review captures can themselves
                // be stored beneath an application path containing a component named build or target.
                .filter(p -> rootPath.relativize(p).getNameCount() == 0 ||
                        Stream.of(rootPath.relativize(p).toString().split(java.util.regex.Pattern.quote(File.separator)))
                                .noneMatch(part -> part.equals("build") || part.equals("target") || part.equals(".git")))
                .map(Path::toFile)
                .collect(Collectors.toList());
        }
    }
}
