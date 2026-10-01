package dev.codeatlas.api.dto;

public class WorkspaceRequest {
    private String path;
    private String language;
    /** Indexing engine id within the language; omitted keeps an existing workspace's engine, or picks the default. */
    private String indexer;
    /** Explicit consent that the chosen engine may run the repository's own build (ADR 0012). */
    private boolean allowBuildExecution;

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
}
