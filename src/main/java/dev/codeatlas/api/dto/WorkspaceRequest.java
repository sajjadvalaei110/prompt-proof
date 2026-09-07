package dev.codeatlas.api.dto;

public class WorkspaceRequest {
    private String path;
    public WorkspaceRequest() {}
    public WorkspaceRequest(String path) { this.path = path; }
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
}
