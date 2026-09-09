package dev.codeatlas.api.dto;
import java.util.List;
import dev.codeatlas.api.dto.enums.ClaimBasis;
import dev.codeatlas.api.dto.enums.ExplanationStatus;

public record ExplanationResponse(String shortLabel, String hoverSummary, List<Claim> claims, List<String> unknowns, List<String> suggestedNextSymbolIds, ExplanationStatus status, String provenance, PreExplanation preExplanation) {
    public ExplanationResponse(String shortLabel, String hoverSummary, List<Claim> claims, List<String> unknowns, List<String> suggestedNextSymbolIds, ExplanationStatus status, String provenance) {
        this(shortLabel, hoverSummary, claims, unknowns, suggestedNextSymbolIds, status, provenance, null);
    }
    public record PreExplanation(String businessLogic, String status, String provenance) {}
    public record Claim(String description, ClaimBasis basis, List<String> evidenceIds) {}
}
