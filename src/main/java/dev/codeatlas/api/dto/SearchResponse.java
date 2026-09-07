package dev.codeatlas.api.dto;
import java.util.List;

public record SearchResponse(List<SearchResult> results) {
    public record SearchResult(String type, String qualifiedName, String module, String snippet) {}
}
