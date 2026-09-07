package dev.codeatlas.workspace;

import dev.codeatlas.storage.WorkspaceRepository;
import dev.codeatlas.api.dto.WorkspaceRequest;
import dev.codeatlas.api.dto.WorkspaceResponse;
import org.springframework.stereotype.Service;
import java.io.File;
import java.util.List;
import java.util.UUID;
import java.util.Optional;

@Service
public class WorkspaceService {
    private final WorkspaceRepository workspaceRepository;

    public WorkspaceService(WorkspaceRepository workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }

    public WorkspaceResponse createWorkspace(WorkspaceRequest request) {
        File file = new File(request.getPath());
        if (!file.exists() || !file.isDirectory()) {
            throw new IllegalArgumentException("Path does not exist or is not a directory: " + request.getPath());
        }
        
        try {
            String canonicalPath = file.getCanonicalPath();
            Optional<WorkspaceResponse> existing = workspaceRepository.findByPath(canonicalPath);
            if (existing.isPresent()) {
                return existing.get();
            }
            
            String id = UUID.randomUUID().toString();
            String name = file.getName();
            workspaceRepository.insert(id, canonicalPath, name);
            
            return new WorkspaceResponse(id, canonicalPath, null);
        } catch (Exception e) {
            throw new RuntimeException("Failed to register workspace", e);
        }
    }

    public List<WorkspaceResponse> listWorkspaces() {
        return workspaceRepository.findAll();
    }

    public WorkspaceResponse getWorkspace(String id) {
        return workspaceRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("Workspace not found: " + id));
    }
}
