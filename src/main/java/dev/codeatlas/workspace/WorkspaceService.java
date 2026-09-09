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
        if (request == null || request.getPath() == null || request.getPath().trim().isEmpty()) {
            throw new IllegalArgumentException("Workspace path must not be empty");
        }

        String pathStr = request.getPath().trim();
        // Remove surrounding quotes if pasted with quotes
        if ((pathStr.startsWith("\"") && pathStr.endsWith("\"")) || (pathStr.startsWith("'") && pathStr.endsWith("'"))) {
            pathStr = pathStr.substring(1, pathStr.length() - 1).trim();
        }
        // Expand tilde ~ to user home
        if (pathStr.equals("~") || pathStr.startsWith("~" + File.separator) || pathStr.startsWith("~/")) {
            String userHome = System.getProperty("user.home");
            pathStr = userHome + pathStr.substring(1);
        }

        File file = new File(pathStr);
        if (!file.isAbsolute()) {
            file = file.getAbsoluteFile();
        }
        if (!file.exists()) {
            throw new IllegalArgumentException("Path does not exist: " + pathStr);
        }
        if (!file.isDirectory()) {
            throw new IllegalArgumentException("Path is a file, not a directory: " + pathStr);
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
