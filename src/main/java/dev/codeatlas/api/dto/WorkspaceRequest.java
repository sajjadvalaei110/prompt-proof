package dev.codeatlas.api.dto;

public class WorkspaceRequest {
    private String path;
    private String language;

    public WorkspaceRequest() {}
    public WorkspaceRequest(String path) { this.path = path; }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }
}
