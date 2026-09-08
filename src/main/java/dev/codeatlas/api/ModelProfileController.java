package dev.codeatlas.api;

import dev.codeatlas.api.dto.ModelProfileRequest;
import dev.codeatlas.api.dto.ModelProfileResponse;
import dev.codeatlas.api.dto.ModelTestResponse;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.modelclient.ModelClientService;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/model-profiles")
public class ModelProfileController {

    private final CodeAtlasProperties properties;
    private final ModelClientService modelClientService;

    public ModelProfileController(CodeAtlasProperties properties, ModelClientService modelClientService) {
        this.properties = properties;
        this.modelClientService = modelClientService;
    }

    @GetMapping
    public List<ModelProfileResponse> listProfiles() {
        var m = properties.getModel();
        return List.of(new ModelProfileResponse(
            m.getBaseUrl() != null ? m.getBaseUrl() : "",
            m.getModelId() != null ? m.getModelId() : "",
            m.getApiKey() != null && !m.getApiKey().isBlank(),
            m.getContextBudget(),
            m.getOutputBudget(),
            m.getTimeoutSeconds(),
            m.getConcurrency(),
            m.getTemperature()
        ));
    }

    @PostMapping
    public ModelProfileResponse createOrUpdateProfile(@RequestBody ModelProfileRequest request) {
        applyProfile(request);
        var m = properties.getModel();
        return new ModelProfileResponse(
            m.getBaseUrl() != null ? m.getBaseUrl() : "",
            m.getModelId() != null ? m.getModelId() : "",
            m.getApiKey() != null && !m.getApiKey().isBlank(),
            m.getContextBudget(),
            m.getOutputBudget(),
            m.getTimeoutSeconds(),
            m.getConcurrency(),
            m.getTemperature()
        );
    }

    @PostMapping({"/test", "/{id}/test"})
    public ModelTestResponse testProfile(@PathVariable(required = false) String id,
                                         @RequestBody(required = false) ModelProfileRequest request) {
        if (request != null) {
            applyProfile(request);
        }
        return modelClientService.testConnection();
    }

    private void applyProfile(ModelProfileRequest request) {
        var m = properties.getModel();
        if (request.baseUrl() != null) {
            m.setBaseUrl(request.baseUrl().trim());
        }
        if (request.modelId() != null) {
            m.setModelId(request.modelId().trim());
        }
        if (request.apiKey() != null && !request.apiKey().isBlank() && !request.apiKey().equals("****")) {
            m.setApiKey(request.apiKey().trim());
        }
        if (request.contextBudget() > 0) {
            m.setContextBudget(request.contextBudget());
        }
        if (request.outputBudget() > 0) {
            m.setOutputBudget(request.outputBudget());
        }
        if (request.timeoutSeconds() > 0) {
            m.setTimeoutSeconds(request.timeoutSeconds());
        }
        if (request.concurrency() > 0) {
            m.setConcurrency(request.concurrency());
        }
        if (request.temperature() != null) {
            m.setTemperature(request.temperature());
        }
    }
}
