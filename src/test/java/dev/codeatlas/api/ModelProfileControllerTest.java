package dev.codeatlas.api;

import dev.codeatlas.api.dto.ModelProfileRequest;
import dev.codeatlas.api.dto.ModelProfileResponse;
import dev.codeatlas.api.dto.ModelTestResponse;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.modelclient.ModelClientService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ModelProfileControllerTest {

    private CodeAtlasProperties properties;
    private ModelClientService mockService;
    private ModelProfileController controller;

    @BeforeEach
    void setUp() {
        properties = new CodeAtlasProperties();
        properties.getModel().setBaseUrl("https://api.openai.com/v1");
        properties.getModel().setModelId("gpt-4o");
        properties.getModel().setApiKey("sk-initial-key");
        properties.getModel().setTemperature(0.2);
        properties.getModel().setContextBudget(8192);
        properties.getModel().setOutputBudget(2048);
        properties.getModel().setTimeoutSeconds(60);

        mockService = new ModelClientService(properties) {
            @Override
            public ModelTestResponse testConnection() {
                return new ModelTestResponse(true, true, true, properties.getModel().getModelId(), 120, List.of("Connection successful"));
            }
        };

        controller = new ModelProfileController(properties, mockService);
    }

    @Test
    void testListProfilesReturnsActiveProfileWithMaskedKey() {
        List<ModelProfileResponse> profiles = controller.listProfiles();
        assertEquals(1, profiles.size());
        ModelProfileResponse profile = profiles.get(0);
        assertEquals("https://api.openai.com/v1", profile.baseUrl());
        assertEquals("gpt-4o", profile.modelId());
        assertTrue(profile.hasApiKey());
        assertEquals(0.2, profile.temperature());
        assertEquals(8192, profile.contextBudget());
        assertEquals(2048, profile.outputBudget());
        assertEquals(60, profile.timeoutSeconds());
    }

    @Test
    void testCreateOrUpdateProfileUpdatesPropertiesInMemory() {
        ModelProfileRequest request = new ModelProfileRequest(
            "http://127.0.0.1:11434/v1",
            "qwen2.5-coder",
            "sk-new-key",
            16384,
            4096,
            90,
            4,
            0.7
        );

        ModelProfileResponse response = controller.createOrUpdateProfile(request);

        assertEquals("http://127.0.0.1:11434/v1", response.baseUrl());
        assertEquals("qwen2.5-coder", response.modelId());
        assertTrue(response.hasApiKey());
        assertEquals(16384, response.contextBudget());
        assertEquals(4096, response.outputBudget());
        assertEquals(90, response.timeoutSeconds());
        assertEquals(4, response.concurrency());
        assertEquals(0.7, response.temperature());

        // Verify properties object was updated in memory
        assertEquals("http://127.0.0.1:11434/v1", properties.getModel().getBaseUrl());
        assertEquals("qwen2.5-coder", properties.getModel().getModelId());
        assertEquals("sk-new-key", properties.getModel().getApiKey());
        assertEquals(0.7, properties.getModel().getTemperature());
        assertEquals(16384, properties.getModel().getContextBudget());
        assertEquals(4096, properties.getModel().getOutputBudget());
        assertEquals(90, properties.getModel().getTimeoutSeconds());
    }

    @Test
    void acceptsLargeModelWindowsAndRejectsImpossibleBudgetsAtomically() {
        var large = new ModelProfileRequest(
            "http://large-model.test/v1", "large-model", "", 2_000_000,
            65_536, 120, 1, 0.2
        );
        var saved = controller.createOrUpdateProfile(large);
        assertEquals(2_000_000, saved.contextBudget());
        assertEquals(65_536, saved.outputBudget());

        var impossible = new ModelProfileRequest(
            "http://must-not-be-saved.test/v1", "bad-model", "", 4096,
            4096, 120, 1, 0.2
        );
        assertThrows(IllegalArgumentException.class,
            () -> controller.createOrUpdateProfile(impossible));
        assertEquals("http://large-model.test/v1", properties.getModel().getBaseUrl());
        assertEquals("large-model", properties.getModel().getModelId());
        assertEquals(2_000_000, properties.getModel().getContextBudget());
        assertEquals(65_536, properties.getModel().getOutputBudget());
    }

    @Test
    void testTestProfileDelegatesToService() {
        ModelTestResponse response = controller.testProfile("default", null);
        assertTrue(response.reachable());
        assertTrue(response.chatWorking());
        assertEquals("gpt-4o", response.actualModelId());
        assertEquals(120, response.latencyMs());
    }

    @Test
    void testTestProfileWithRequestBodyAppliesSettingsBeforeTest() {
        ModelProfileRequest req = new ModelProfileRequest(
            "http://127.0.0.1:1234/v1",
            "local-model",
            "",
            4096,
            1024,
            30,
            1,
            0.1
        );

        ModelTestResponse response = controller.testProfile(null, req);
        assertTrue(response.reachable());
        assertEquals("local-model", properties.getModel().getModelId());
        assertEquals("http://127.0.0.1:1234/v1", properties.getModel().getBaseUrl());
    }
}
