package dev.codeatlas.explanations;

import dev.codeatlas.modelclient.ModelClientService;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;

@Service
public class ExplanationService {
    private final ModelClientService modelClient;
    private final JdbcTemplate jdbcTemplate;

    public ExplanationService(ModelClientService modelClient, JdbcTemplate jdbcTemplate) {
        this.modelClient = modelClient;
        this.jdbcTemplate = jdbcTemplate;
    }

    public void explainSubject(String snapshotId, String subjectId, String subjectType) {
        // Build prompt
        String systemPrompt = "You explain Java/Spring code using only supplied source and analysis facts. Return JSON matching the schema.";
        String userPrompt = "Explain this " + subjectType;
        
        String explanationJson = modelClient.getExplanation(systemPrompt, userPrompt);
        System.out.println("Generated explanation for " + subjectId + ": " + explanationJson);
        
        // Persist back to the explanations table
        jdbcTemplate.update(
            "INSERT INTO explanations (id, subject_version_id, subject_type, snapshot_id, status, claims, created_at, updated_at) VALUES (?, ?, ?, ?, 'READY', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            UUID.randomUUID().toString(), subjectId, subjectType, snapshotId, explanationJson
        );
    }
}
