package dev.codeatlas.api;

import dev.codeatlas.workspace.WorkspaceService;
import dev.codeatlas.api.dto.WorkspaceRequest;
import dev.codeatlas.api.dto.WorkspaceResponse;
import dev.codeatlas.api.dto.AnalysisJobRequest;
import dev.codeatlas.api.dto.JobResponse;
import dev.codeatlas.jobs.JobService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceService workspaceService;
    private final JobService jobService;

    public WorkspaceController(WorkspaceService workspaceService, JobService jobService) {
        this.workspaceService = workspaceService;
        this.jobService = jobService;
    }

    @PostMapping
    public WorkspaceResponse createWorkspace(@RequestBody WorkspaceRequest request) {
        return workspaceService.createWorkspace(request);
    }

    @GetMapping
    public List<WorkspaceResponse> listWorkspaces() {
        return workspaceService.listWorkspaces();
    }

    @GetMapping("/{id}")
    public WorkspaceResponse getWorkspace(@PathVariable String id) {
        return workspaceService.getWorkspace(id);
    }

    @PostMapping("/{id}/analysis-jobs")
    public JobResponse triggerAnalysis(@PathVariable String id, @RequestBody AnalysisJobRequest request) {
        return jobService.createAnalysisJob(id);
    }

    @GetMapping("/{id}/snapshots")
    public List<Object> listSnapshots(@PathVariable String id) {
        return List.of(); // TODO implement snapshot listing
    }
}
