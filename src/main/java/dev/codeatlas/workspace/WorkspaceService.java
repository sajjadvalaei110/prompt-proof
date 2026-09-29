package dev.codeatlas.workspace;

import dev.codeatlas.analysis.JavaAnalysisAdapter;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
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
    private final AnalysisPortRegistry portRegistry;

    public WorkspaceService(WorkspaceRepository workspaceRepository, AnalysisPortRegistry portRegistry) {
        this.workspaceRepository = workspaceRepository;
        this.portRegistry = portRegistry;
    }

    public WorkspaceResponse createWorkspace(WorkspaceRequest request) {
        if (request == null || request.getPath() == null || request.getPath().trim().isEmpty()) {
            throw new IllegalArgumentException("Workspace path must not be empty");
        }
        String language = canonicalLanguage(request.getLanguage());

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
                String existingLanguage = existing.get().language();
                if (!existingLanguage.equals(language)) {
                    throw new IllegalArgumentException("A workspace for this path already exists with language '"
                            + existingLanguage + "'. Choose that language or use a different path.");
                }
                return existing.get();
            }
            
            String id = UUID.randomUUID().toString();
            String name = file.getName();
            workspaceRepository.insert(id, canonicalPath, name, language);
            
            return new WorkspaceResponse(id, canonicalPath, null, language);
        } catch (IllegalArgumentException e) {
            // Preserve client-facing validation failures so the API advice can return 400. In
            // particular, a path that is already registered for another language is a conflict
            // the caller can correct, not an internal registration failure.
            throw e;
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

    /**
     * Canonicalizes the public wire value while keeping omission backward compatible.
     * Explicit values are rejected before any filesystem or database mutation occurs.
     */
    private String canonicalLanguage(String requested) {
        String language = requested == null || requested.isBlank() ? JavaAnalysisAdapter.LANGUAGE : requested;
        return portRegistry.require(language).language();
    }
}
