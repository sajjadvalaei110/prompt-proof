package dev.codeatlas.api;

import dev.codeatlas.workspace.ProjectDocumentService;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/documents")
public class ProjectDocumentController {
    private final ProjectDocumentService service;
    public ProjectDocumentController(ProjectDocumentService service) { this.service = service; }
    public record DocumentRequest(String title, String content) {}
    @GetMapping public List<ProjectDocumentService.Document> list(@PathVariable String workspaceId) { return service.list(workspaceId); }
    @PostMapping public ProjectDocumentService.Document add(@PathVariable String workspaceId, @RequestBody DocumentRequest body) { return service.save(workspaceId, null, body.title(), body.content()); }
    @PutMapping("/{id}") public ProjectDocumentService.Document update(@PathVariable String workspaceId, @PathVariable String id, @RequestBody DocumentRequest body) { return service.save(workspaceId, id, body.title(), body.content()); }
    @DeleteMapping("/{id}") public Map<String, String> delete(@PathVariable String workspaceId, @PathVariable String id) { service.delete(workspaceId, id); return Map.of("status", "DELETED"); }
}
