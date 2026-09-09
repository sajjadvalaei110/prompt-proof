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
        try (Stream<Path> walk = Files.walk(root.toPath())) {
            return walk
                .filter(p -> Files.isRegularFile(p, java.nio.file.LinkOption.NOFOLLOW_LINKS))
                .filter(p -> p.toString().endsWith(".java"))
                .filter(p -> !p.toString().contains("/build/"))
                .filter(p -> !p.toString().contains("/target/"))
                .filter(p -> !p.toString().contains("/.git/"))
                .map(Path::toFile)
                .collect(Collectors.toList());
        }
    }
}
