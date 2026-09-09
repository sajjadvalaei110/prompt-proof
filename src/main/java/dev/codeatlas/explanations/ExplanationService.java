package dev.codeatlas.explanations;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.api.dto.ExplanationResponse;
import dev.codeatlas.api.dto.enums.ClaimBasis;
import dev.codeatlas.api.dto.enums.ExplanationStatus;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.modelclient.ModelClientService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class ExplanationService {

    private static final Logger log = LoggerFactory.getLogger(ExplanationService.class);

    private final ModelClientService modelClient;
    private final ContextBuilder contextBuilder;
    private final PromptTemplate promptTemplate;
    private final JdbcTemplate jdbcTemplate;
    private final CodeAtlasProperties properties;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ExplanationService(ModelClientService modelClient,
                              ContextBuilder contextBuilder,
                              PromptTemplate promptTemplate,
                              JdbcTemplate jdbcTemplate,
                              CodeAtlasProperties properties, org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.transactions = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        this.modelClient = modelClient;
        this.contextBuilder = contextBuilder;
        this.promptTemplate = promptTemplate;
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
    }

    public void explainSubject(String snapshotId, String subjectId, String subjectType) {
        log.info("Generating explanation for {} {} in snapshot {}", subjectType, subjectId, snapshotId);

        final String documentsFingerprint = contextBuilder.documentsFingerprint(snapshotId);
        ContextBuilder.SymbolContext ctx = contextBuilder.buildContext(snapshotId, subjectId, subjectType);
        String targetSymbolId = ctx.symbolId();
        String systemPrompt = promptTemplate.getSystemPrompt();
        String userPrompt = promptTemplate.getUserPrompt(ctx);
        final String provider = properties.getModel().getBaseUrl();
        final String modelId = properties.getModel().getModelId() == null ? "default-model" : properties.getModel().getModelId();
        final String profileFingerprint = profileIdentity();
        String fingerprint = fingerprint(systemPrompt + userPrompt + profileFingerprint);
        Set<String> allowedEvidence = new HashSet<>();
        ctx.evidenceItems().forEach(e -> allowedEvidence.add(e.id()));
        String explanationJson = modelClient.getExplanation(systemPrompt, userPrompt);

        ParsedExplanation parsed;
        try { parsed = validate(explanationJson, allowedEvidence, snapshotId); }
        catch (IllegalArgumentException invalid) {
            // One bounded repair request with the same evidence. Never promote invalid prose to facts.
            String repairPrompt = userPrompt + "\nYour previous answer failed validation: " + invalid.getMessage() +
                ". Return the exact requested schema. Use only the supplied evidence IDs. suggestedNextSymbolIds may be empty. Do not invent citations.";
            parsed = validate(modelClient.getExplanation(systemPrompt, repairPrompt), allowedEvidence, snapshotId);
        }
        String shortLabel = parsed.label();
        String hoverSummary = parsed.summary();
        List<Map<String, Object>> claimsList = parsed.claims();
        List<String> unknownsList = parsed.unknowns();
        List<String> suggestedNextIds = parsed.next();
        String claimsJson = toJson(claimsList);
        String unknownsJson = toJson(unknownsList);
        String suggestedJson = toJson(suggestedNextIds);
        transactions.executeWithoutResult(transaction -> {
        // Compare only the generated inputs actually consumed, not all newly available outputs.
        boolean fresh = documentsFingerprint.equals(contextBuilder.documentsFingerprint(snapshotId))
            && profileFingerprint.equals(profileIdentity())
            && contextBuilder.dependenciesFresh(snapshotId, ctx.dependencies());
        // Check if an explanation record already exists
        Integer existingCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ?",
                Integer.class, snapshotId, targetSymbolId, subjectType
        );

        if (existingCount != null && existingCount > 0) {
            jdbcTemplate.update(
                    "UPDATE explanations SET status = 'READY', schema_version = '1', short_label = ?, hover_summary = ?, " +
                            "claims = ?, unknowns = ?, suggested_next_ids = ?, model_id = ?, prompt_version = '1.0', " +
                            "updated_at = CURRENT_TIMESTAMP, generated_at = CURRENT_TIMESTAMP " +
                            "WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ?",
                    shortLabel, hoverSummary, claimsJson, unknownsJson, suggestedJson, modelId,
                    snapshotId, targetSymbolId, subjectType
            );
        } else {
            jdbcTemplate.update(
                    "INSERT INTO explanations (id, subject_version_id, subject_type, snapshot_id, status, schema_version, " +
                            "short_label, hover_summary, claims, unknowns, suggested_next_ids, model_id, prompt_version, " +
                            "created_at, updated_at, generated_at) " +
                            "VALUES (?, ?, ?, ?, 'READY', '1', ?, ?, ?, ?, ?, ?, '1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    UUID.randomUUID().toString(), targetSymbolId, subjectType, snapshotId,
                    shortLabel, hoverSummary, claimsJson, unknownsJson, suggestedJson, modelId
            );
        }

        jdbcTemplate.update("UPDATE explanations SET input_fingerprint = ?, context_evidence = ?, context_dependencies = ?, provider_base_url = ?, prompt_version = ?, status = ? WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ?",
            fingerprint, toJson(ctx.evidenceItems()), toJson(ctx.dependencies()), provider, PromptTemplate.VERSION, fresh ? "READY" : "STALE", snapshotId, targetSymbolId, subjectType);
        invalidateChangedDependencies(snapshotId);
        });
        log.info("Persisted explanation for {} {}", subjectType, targetSymbolId);
    }

    public static class SynthesisException extends IllegalArgumentException {
        public SynthesisException(String message) { super(message); }
    }
    public record ArchitectureInputs(String documents, String profile, String fingerprint) {}

    public boolean architectureInputsFresh(String snapshot, ArchitectureInputs inputs) {
        return inputs.documents().equals(contextBuilder.documentsFingerprint(snapshot)) && inputs.profile().equals(profileIdentity())
            && jdbcTemplate.queryForObject("SELECT COUNT(*) FROM explanation_syntheses WHERE snapshot_id = ? AND input_fingerprint = ? AND status = 'READY'", Integer.class, snapshot, inputs.fingerprint()) > 0;
    }

    /** One structured synthesis turn; validation is all-or-nothing and never writes graph facts. */
    public ArchitectureInputs synthesizeArchitecture(String snapshotId) {
        String documents = contextBuilder.documentsFingerprint(snapshotId);
        String profile = profileIdentity();
        var context = contextBuilder.buildArchitectureContext(snapshotId);
        String system = promptTemplate.getSynthesisSystemPrompt();
        String user = context.formattedContext();
        String input = fingerprint(system + user + profile);
        var inputs = new ArchitectureInputs(documents, profile, input);
        if (architectureInputsFresh(snapshotId, inputs)) return inputs;
        // UTF-8 bytes are a conservative token upper bound. Never silently truncate global input.
        long size = (system + user).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        if (size + properties.getModel().getOutputBudget() + 256 > properties.getModel().getContextBudget())
            throw new SynthesisException("Complete architecture inventory and documents exceed the context budget. Increase Context Budget in model settings and retry Explain all.");
        String provider = properties.getModel().getBaseUrl();
        String model = properties.getModel().getModelId();
        Map<String, String> purposes = context.classIds().isEmpty() ? Map.of()
            : validateSynthesis(modelClient.getExplanation(system, user), context.classIds());
        transactions.executeWithoutResult(transaction -> {
            if (!documents.equals(contextBuilder.documentsFingerprint(snapshotId)) || !profile.equals(profileIdentity()))
                throw new SynthesisException("Project documents or model settings changed during synthesis. Retry Explain all.");
            String synthesisId = UUID.randomUUID().toString();
            jdbcTemplate.update("UPDATE explanation_syntheses SET status = 'STALE' WHERE snapshot_id = ? AND status = 'READY'", snapshotId);
            jdbcTemplate.update("INSERT INTO explanation_syntheses (id, snapshot_id, status, schema_version, prompt_version, model_id, provider_base_url, input_fingerprint, context_evidence) VALUES (?, ?, 'READY', '1', ?, ?, ?, ?, ?)",
                synthesisId, snapshotId, PromptTemplate.SYNTHESIS_VERSION, model, provider, input, toJson(context.evidenceItems()));
            purposes.forEach((id, purpose) -> jdbcTemplate.update("INSERT INTO class_pre_explanations (symbol_id, synthesis_id, business_logic) VALUES (?, ?, ?) ON CONFLICT(symbol_id) DO UPDATE SET synthesis_id = excluded.synthesis_id, business_logic = excluded.business_logic", id, synthesisId, purpose));
            invalidateChangedDependencies(snapshotId);
        });
        return inputs;
    }

    private Map<String, String> validateSynthesis(String response, Set<String> expected) {
        try {
            if (response == null || response.length() > 1_000_000) throw new IllegalArgumentException();
            JsonNode root = objectMapper.readTree(response);
            if (!root.isObject() || root.size() != 1 || !root.path("classes").isArray()) throw new IllegalArgumentException();
            Map<String, String> purposes = new LinkedHashMap<>();
            for (JsonNode item : root.get("classes")) {
                if (!item.isObject() || item.size() != 2 || !item.path("symbolId").isTextual() || !item.path("businessLogic").isTextual()) throw new IllegalArgumentException();
                String id = item.get("symbolId").asText(), purpose = item.get("businessLogic").asText().strip();
                if (!expected.contains(id) || purpose.isEmpty() || purpose.length() > 2000 || purposes.putIfAbsent(id, purpose) != null) throw new IllegalArgumentException();
            }
            if (!purposes.keySet().equals(expected)) throw new IllegalArgumentException();
            return purposes;
        } catch (Exception e) {
            throw new SynthesisException("Architecture response must contain every CLASS exactly once with a nonempty businessLogic (up to 2000 characters). No drafts were saved; retry Explain all or increase Output Budget.");
        }
    }

    private void invalidateChangedDependencies(String snapshot) {
        // A refreshed consumed output can stale downstream explanations; bounded fixed point also
        // handles cycles. Merely adding a new explanation has no effect on earlier independent work.
        boolean changed;
        do {
            changed = false;
            for (var row : jdbcTemplate.queryForList("SELECT id, context_dependencies FROM explanations WHERE snapshot_id = ? AND status = 'READY' AND context_dependencies != '[]'", snapshot)) {
                try {
                    List<ContextBuilder.ContextDependency> dependencies = objectMapper.readValue((String)row.get("context_dependencies"), new TypeReference<>() {});
                    if (!contextBuilder.dependenciesFresh(snapshot, dependencies)) {
                        jdbcTemplate.update("UPDATE explanations SET status = 'STALE', updated_at = CURRENT_TIMESTAMP WHERE id = ?", row.get("id"));
                        jdbcTemplate.update("UPDATE explanation_queue SET status = 'SKIPPED', updated_at = CURRENT_TIMESTAMP WHERE snapshot_id = ? AND status = 'COMPLETED' AND EXISTS (SELECT 1 FROM explanations e WHERE e.id = ? AND e.subject_version_id = explanation_queue.subject_id AND e.subject_type = explanation_queue.subject_type)", snapshot, row.get("id"));
                        changed = true;
                    }
                } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("Invalid stored context dependencies", e); }
            }
        } while (changed);
    }

    private record ParsedExplanation(String label, String summary, List<Map<String,Object>> claims, List<String> unknowns, List<String> next) {}
    private ParsedExplanation validate(String response, Set<String> allowed, String snapshot) {
        try {
            if(response == null || response.length() > 100_000) throw new IllegalArgumentException("Response absent or too large");
            JsonNode root=objectMapper.readTree(response);
            if(!root.isObject() || !root.path("shortLabel").isTextual() || !root.path("hoverSummary").isTextual() || !root.path("claims").isArray()) throw new IllegalArgumentException("Expected shortLabel, hoverSummary and claims array");
            List<Map<String,Object>> claims=new ArrayList<>();
            for(JsonNode claim:root.get("claims")) {
                String description=claim.path("description").asText(claim.path("text").asText(""));
                String basis=claim.path("basis").asText("").toUpperCase();
                try { ClaimBasis.valueOf(basis); } catch(Exception e) {throw new IllegalArgumentException("Use SOURCE_FACT, INFERRED_PURPOSE or UNKNOWN for claim basis");}
                List<String> ids=array(claim.path("evidenceIds"));
                if(description.isBlank() || ids.isEmpty() || !allowed.containsAll(ids)) throw new IllegalArgumentException("Each claim must cite only supplied evidence IDs");
                if("SOURCE_FACT".equals(basis) && ids.stream().allMatch(e->e.startsWith("doc-") || e.startsWith("ai-"))) throw new IllegalArgumentException("Document/generated-only claims must be INFERRED_PURPOSE, not SOURCE_FACT");
                claims.add(Map.of("description",description,"basis",basis,"evidenceIds",ids));
            }
            List<String> next=array(root.path("suggestedNextSymbolIds"));
            Set<String> known=new HashSet<>(jdbcTemplate.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ?",String.class,snapshot));
            if(!known.containsAll(next)) throw new IllegalArgumentException("Navigation IDs must be actual supplied symbol IDs, not names; omit suggestions when uncertain");
            return new ParsedExplanation(root.get("shortLabel").asText(),root.get("hoverSummary").asText(),claims,array(root.path("unknowns")),next);
        } catch(IllegalArgumentException e) {throw e;}
        catch(Exception e) {throw new IllegalArgumentException("Return one valid JSON object matching the schema");}
    }
    private List<String> array(JsonNode node) {
        if(node.isMissingNode() || node.isNull()) return List.of();
        if(!node.isArray()) throw new IllegalArgumentException("Expected a JSON array");
        List<String> result=new ArrayList<>();for(JsonNode item:node){if(!item.isTextual())throw new IllegalArgumentException("Array values must be strings");result.add(item.asText());}return result;
    }

    public ExplanationResponse getExplanationForSymbol(String snapshotId, String symbolId) {
        return getExplanation(snapshotId, symbolId, "symbol");
    }
    public ExplanationResponse getExplanation(String snapshotId, String symbolId, String subjectType) {
        var full = getFullExplanation(snapshotId, symbolId, subjectType);
        ExplanationResponse.PreExplanation pre = null;
        if ("symbol".equals(subjectType)) {
            var rows = jdbcTemplate.queryForList("SELECT p.business_logic, a.status, a.model_id, a.generated_at, a.input_fingerprint FROM class_pre_explanations p JOIN explanation_syntheses a ON a.id = p.synthesis_id JOIN symbol_versions s ON s.id = p.symbol_id WHERE a.snapshot_id = ? AND (s.id = ? OR s.qualified_name = ?)", snapshotId, symbolId, symbolId);
            if (!rows.isEmpty()) {
                var row = rows.get(0);
                pre = new ExplanationResponse.PreExplanation((String)row.get("business_logic"), "READY".equals(row.get("status")) ? "DRAFT" : "STALE",
                    row.get("model_id") + " · " + row.get("generated_at") + " · Architecture " + row.get("input_fingerprint"));
            }
        }
        return new ExplanationResponse(full.shortLabel(), full.hoverSummary(), full.claims(), full.unknowns(), full.suggestedNextSymbolIds(), full.status(), full.provenance(), pre);
    }

    private ExplanationResponse getFullExplanation(String snapshotId, String symbolId, String subjectType) {
        // Resolve target symbol canonical ID
        String targetId = symbolId;
        try {
            List<String> ids = jdbcTemplate.queryForList(
                    "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND (id = ? OR qualified_name = ?) LIMIT 1",
                    String.class, snapshotId, symbolId, symbolId
            );
            if (!ids.isEmpty()) {
                targetId = ids.get(0);
            }
        } catch (Exception ignored) {}

        ExplanationStatus queuedStatus = null;
        var queueRows = jdbcTemplate.queryForList("SELECT status FROM explanation_queue WHERE snapshot_id = ? AND subject_id = ? AND subject_type = ? ORDER BY updated_at DESC LIMIT 1", String.class, snapshotId, targetId, subjectType);
        if (!queueRows.isEmpty()) queuedStatus = switch (queueRows.get(0)) {
            case "PENDING" -> ExplanationStatus.QUEUED;
            case "IN_PROGRESS" -> ExplanationStatus.RUNNING;
            case "FAILED" -> ExplanationStatus.FAILED;
            default -> null;
        };
        // Check explanations table
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, status, short_label, hover_summary, claims, unknowns, suggested_next_ids, model_id, generated_at, prompt_version, input_fingerprint, provider_base_url " +
                        "FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ? " +
                        "ORDER BY updated_at DESC LIMIT 1",
                snapshotId, targetId, subjectType
        );

        if (!rows.isEmpty()) {
            Map<String, Object> row = rows.get(0);
            String statusStr = (String) row.get("status");
            ExplanationStatus status;
            try {
                status = ExplanationStatus.valueOf(statusStr != null ? statusStr : "READY");
            } catch (Exception e) {
                status = ExplanationStatus.READY;
            }

            if (queuedStatus != null) status = queuedStatus;
            String shortLabel = (String) row.get("short_label");
            String hoverSummary = (String) row.get("hover_summary");
            String claimsJson = (String) row.get("claims");
            String unknownsJson = (String) row.get("unknowns");
            String suggestedJson = (String) row.get("suggested_next_ids");
            String modelId = (String) row.get("model_id");
            String generatedAt = (String) row.get("generated_at");

            List<ExplanationResponse.Claim> claims = parseClaims(claimsJson);
            List<String> unknowns = parseStringList(unknownsJson);
            List<String> suggested = parseStringList(suggestedJson);
            String provenance = (modelId != null ? modelId : "Local Model") +
                    (generatedAt != null ? " (" + generatedAt + ")" : "") +
                    " · Prompt " + row.get("prompt_version") +
                    (row.get("input_fingerprint") != null ? " · Context " + row.get("input_fingerprint").toString().substring(0, 12) : "");

            return new ExplanationResponse(shortLabel, hoverSummary, claims, unknowns, suggested, status, provenance);
        }

        // If no explanations record exists, check explanation_queue for status
        try {
            List<String> qStatus = jdbcTemplate.queryForList(
                    "SELECT status FROM explanation_queue WHERE snapshot_id = ? AND (subject_id = ? OR subject_id = ?) AND subject_type = ? " +
                            "ORDER BY updated_at DESC LIMIT 1",
                    String.class, snapshotId, targetId, symbolId, subjectType
            );
            if (!qStatus.isEmpty()) {
                String qs = qStatus.get(0);
                ExplanationStatus status = switch (qs) {
                    case "PENDING" -> ExplanationStatus.QUEUED;
                    case "IN_PROGRESS" -> ExplanationStatus.RUNNING;
                    case "FAILED" -> ExplanationStatus.FAILED;
                    default -> ExplanationStatus.NOT_REQUESTED;
                };
                return new ExplanationResponse(null, null, List.of(), List.of(), List.of(), status, null);
            }
        } catch (Exception ignored) {}

        return new ExplanationResponse(null, null, List.of(), List.of(), List.of(), ExplanationStatus.NOT_REQUESTED, null);
    }

    public Object getEvidence(String snapshot, String subject, String type) {
        var rows = jdbcTemplate.queryForList("SELECT context_evidence FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ? ORDER BY updated_at DESC LIMIT 1", String.class, snapshot, subject, type);
        try { return rows.isEmpty() || rows.get(0) == null ? List.of() : objectMapper.readTree(rows.get(0)); }
        catch (Exception e) { return List.of(); }
    }
    private String profileIdentity() {
        var model=properties.getModel();
        return String.valueOf(model.getBaseUrl()) + "|" + model.getModelId() + "|" + model.getContextBudget() + "|" + model.getOutputBudget() + "|" + model.getTemperature();
    }
    private String fingerprint(String value) {
        try { return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private List<ExplanationResponse.Claim> parseClaims(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            JsonNode root = objectMapper.readTree(json);
            if (root.isArray()) {
                List<ExplanationResponse.Claim> list = new ArrayList<>();
                for (JsonNode node : root) {
                    String desc = node.has("description") ? node.get("description").asText()
                            : (node.has("text") ? node.get("text").asText() : "");
                    String basisStr = node.has("basis") ? node.get("basis").asText().toUpperCase() : "SOURCE_FACT";
                    ClaimBasis basis;
                    try {
                        basis = ClaimBasis.valueOf(basisStr);
                    } catch (Exception e) {
                        basis = ClaimBasis.SOURCE_FACT;
                    }
                    List<String> evIds = new ArrayList<>();
                    if (node.has("evidenceIds") && node.get("evidenceIds").isArray()) {
                        for (JsonNode ev : node.get("evidenceIds")) {
                            evIds.add(ev.asText());
                        }
                    }
                    list.add(new ExplanationResponse.Claim(desc, basis, evIds));
                }
                return list;
            }
        } catch (Exception e) {
            log.debug("Error parsing claims JSON: {}", e.getMessage());
        }
        return List.of();
    }

    private List<String> parseStringList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "[]";
        }
    }
}
