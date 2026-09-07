package dev.codeatlas.api;

import dev.codeatlas.api.dto.ModelProfileRequest;
import dev.codeatlas.api.dto.ModelProfileResponse;
import dev.codeatlas.api.dto.ModelTestResponse;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/model-profiles")
public class ModelProfileController {

    @GetMapping
    public List<ModelProfileResponse> listProfiles() {
        return List.of();
    }

    @PostMapping
    public ModelProfileResponse createOrUpdateProfile(@RequestBody ModelProfileRequest request) {
        return new ModelProfileResponse(request.baseUrl(), request.modelId(), request.apiKey() != null, request.contextBudget(), request.outputBudget(), request.timeoutSeconds(), request.concurrency());
    }

    @PostMapping("/{id}/test")
    public ModelTestResponse testProfile(@PathVariable String id) {
        return new ModelTestResponse(true, true, true, "gpt-4o", 100, List.of());
    }
}
