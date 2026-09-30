package dev.codeatlas.workspace;

import dev.codeatlas.analysis.JavaAnalysisAdapter;
import dev.codeatlas.analysis.port.AnalysisPort;
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
        // Validate an explicitly requested engine (and its build consent) before touching the filesystem or database.
        AnalysisPort requestedEngine = request.getIndexer() == null || request.getIndexer().isBlank()
                ? null : portRegistry.require(language, request.getIndexer());
        if (requestedEngine != null && requestedEngine.executesTargetBuild() && !request.isAllowBuildExecution()) {
            throw new IllegalArgumentException("The " + AnalysisPortRegistry.indexerOf(requestedEngine) + " indexer runs this project's own build "
                    + "(its build scripts execute on this machine). Allow build execution to use it, or choose a source-only indexer.");
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
                String existingLanguage = existing.get().language();
                if (!existingLanguage.equals(language)) {
                    throw new IllegalArgumentException("A workspace for this path already exists with language '"
                            + existingLanguage + "'. Choose that language or use a different path.");
                }
                // Omitting the engine keeps the workspace's current one; naming one switches to it.
                if (requestedEngine != null && !AnalysisPortRegistry.indexerOf(requestedEngine).equals(existing.get().indexer())) {
                    String indexer = AnalysisPortRegistry.indexerOf(requestedEngine);
                    workspaceRepository.updateIndexer(existing.get().id(), indexer, trustFor(requestedEngine));
                    return workspaceRepository.findById(existing.get().id()).orElseThrow();
                }
                return existing.get();
            }
            
            String id = UUID.randomUUID().toString();
            String name = file.getName();
            AnalysisPort engine = requestedEngine != null ? requestedEngine : portRegistry.require(language);
            String indexer = AnalysisPortRegistry.indexerOf(engine);
            workspaceRepository.insert(id, canonicalPath, name, language, indexer, trustFor(engine));
            
            return new WorkspaceResponse(id, canonicalPath, null, language, indexer);
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

    /** Build permission is granted only together with an engine that needs it, and dropped otherwise. */
    private static String trustFor(AnalysisPort engine) {
        return engine.executesTargetBuild() ? WorkspaceTrust.BUILD_ALLOWED : WorkspaceTrust.SOURCE_ONLY;
    }

    /** Every shipped engine with its availability on this machine (ADR 0012). */
    public List<AnalysisPortRegistry.IndexerDescriptor> indexers() {
        return portRegistry.indexers();
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
