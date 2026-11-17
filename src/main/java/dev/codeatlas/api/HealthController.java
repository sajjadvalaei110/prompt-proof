package dev.codeatlas.api;

import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/health")
public class HealthController {
    private final String version;

    public HealthController(Optional<BuildProperties> buildProperties) {
        version = buildProperties.map(BuildProperties::getVersion).orElse("development");
    }

    @GetMapping
    public Map<String, Object> health() {
        return Map.of(
            "status", "UP",
            "version", version,
            "timestamp", Instant.now().toString(),
            "javaVersion", System.getProperty("java.version"),
            "database", "UP"
        );
    }
}
