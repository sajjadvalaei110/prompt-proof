package dev.codeatlas.api;

import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.workspace.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Shipped indexing engines per language and whether each can run on this machine (ADR 0012). */
@RestController
@RequestMapping("/api/indexers")
public class IndexerController {

    private final WorkspaceService workspaceService;

    public IndexerController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping
    public List<AnalysisPortRegistry.IndexerDescriptor> indexers() {
        return workspaceService.indexers();
    }
}
