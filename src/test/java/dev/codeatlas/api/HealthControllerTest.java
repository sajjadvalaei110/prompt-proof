package dev.codeatlas.api;

import org.junit.jupiter.api.Test;
import org.springframework.boot.info.BuildProperties;

import java.util.Optional;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;

class HealthControllerTest {
    @Test
    void reportsTheBuildVersion() {
        Properties properties = new Properties();
        properties.setProperty("version", "0.1.0");
        HealthController controller = new HealthController(Optional.of(new BuildProperties(properties)));

        assertEquals("0.1.0", controller.health().get("version"));
    }

    @Test
    void identifiesSourceRunsWithoutBuildMetadata() {
        HealthController controller = new HealthController(Optional.empty());

        assertEquals("development", controller.health().get("version"));
    }
}
