package dev.codeatlas.api.dto;

public class WorkspaceRequest {
    private String path;
    private String language;
    /** Indexing engine id within the language; omitted keeps an existing workspace's engine, or picks the default. */
    private String indexer;
    /** Explicit consent that the chosen engine may run the repository's own build (ADR 0012). */
    private boolean allowBuildExecution;
    /**
     * Optional directory holding the Git repository and bounding the build-root search (ADR 0015).
     * Omitted ({@code null}) keeps an existing workspace's root; blank clears it (auto-detect); a path sets it.
     */
    private String repositoryRoot;

    public WorkspaceRequest() {}
    public WorkspaceRequest(String path) { this.path = path; }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }

    public String getIndexer() { return indexer; }
    public void setIndexer(String indexer) { this.indexer = indexer; }

    public boolean isAllowBuildExecution() { return allowBuildExecution; }
    public void setAllowBuildExecution(boolean allowBuildExecution) { this.allowBuildExecution = allowBuildExecution; }

    public String getRepositoryRoot() { return repositoryRoot; }
    public void setRepositoryRoot(String repositoryRoot) { this.repositoryRoot = repositoryRoot; }
}
