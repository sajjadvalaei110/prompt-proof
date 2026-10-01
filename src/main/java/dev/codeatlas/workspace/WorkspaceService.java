package dev.codeatlas.workspace;

import dev.codeatlas.analysis.JavaAnalysisAdapter;
import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.storage.WorkspaceRepository;
import dev.codeatlas.api.dto.WorkspaceRequest;
import dev.codeatlas.api.dto.WorkspaceResponse;
import org.springframework.stereotype.Service;
import java.io.File;
import java.nio.file.Path;
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

        File file = WorkspacePaths.normalize(request.getPath());
        String pathStr = file.getPath();
        if (!file.exists()) {
            throw new IllegalArgumentException("Path does not exist: " + pathStr);
        }
        if (!file.isDirectory()) {
            throw new IllegalArgumentException("Path is a file, not a directory: " + pathStr);
        }
        
        try {
            String canonicalPath = file.getCanonicalPath();
            Optional<WorkspaceResponse> existing = workspaceRepository.findByPath(canonicalPath);
            if (existing.isPresent() && !existing.get().language().equals(language)) {
                throw new IllegalArgumentException("A workspace for this path already exists with language '"
                        + existing.get().language() + "'. Choose that language or use a different path.");
            }
            // Omitting the root keeps the stored one; a blank root clears it (auto-detect); a path replaces it.
            boolean rootGiven = request.getRepositoryRoot() != null;
            String repositoryRoot = rootGiven
                    ? RepositoryRootValidator.validate(Path.of(canonicalPath), request.getRepositoryRoot()).map(Path::toString).orElse(null)
                    : existing.map(WorkspaceResponse::repositoryRoot).orElse(null);
            AnalysisPort engine = requestedEngine != null ? requestedEngine
                    : existing.flatMap(w -> portRegistry.find(language, w.indexer())).orElseGet(() -> portRegistry.require(language));
            // A build engine must find its build under the root before anything is saved (ADR 0015).
            if (engine.executesTargetBuild()) {
                Path boundary = repositoryRoot == null ? null : Path.of(repositoryRoot);
                if (engine.locateBuildRoot(Path.of(canonicalPath), boundary).isEmpty()) {
                    throw new IllegalArgumentException("The " + AnalysisPortRegistry.indexerOf(engine) + " indexer found no build for "
                            + canonicalPath + (boundary != null ? " under the repository root " + boundary : " inside its repository")
                            + ". " + engine.indexerLabel() + " needs one; set the repository root to the directory that holds the build.");
                }
            }
            if (existing.isPresent()) {
                String id = existing.get().id();
                // Omitting the engine keeps the workspace's current one; naming one switches to it.
                if (requestedEngine != null && !AnalysisPortRegistry.indexerOf(requestedEngine).equals(existing.get().indexer())) {
                    workspaceRepository.updateIndexer(id, AnalysisPortRegistry.indexerOf(requestedEngine), trustFor(requestedEngine));
                }
                // Like the engine, the root only changes what the next analysis or Recompare uses; nothing starts here.
                if (rootGiven && !java.util.Objects.equals(repositoryRoot, existing.get().repositoryRoot())) {
                    workspaceRepository.updateRepositoryRoot(id, repositoryRoot);
                }
                return workspaceRepository.findById(id).orElseThrow();
            }
            
            String id = UUID.randomUUID().toString();
            String name = file.getName();
            String indexer = AnalysisPortRegistry.indexerOf(engine);
            workspaceRepository.insert(id, canonicalPath, name, language, indexer, trustFor(engine), repositoryRoot);
            
            return new WorkspaceResponse(id, canonicalPath, null, language, indexer, repositoryRoot);
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
