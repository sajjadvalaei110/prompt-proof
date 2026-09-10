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
    private final ArchitectureBatchProcessor architecture;
    private final PromptTemplate promptTemplate;
    private final JdbcTemplate jdbcTemplate;
    private final CodeAtlasProperties properties;
    private final BoundedWorkMetrics metrics;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ExplanationService(ModelClientService modelClient,
                              ContextBuilder contextBuilder,
                              PromptTemplate promptTemplate,
                              JdbcTemplate jdbcTemplate,
                              CodeAtlasProperties properties, org.springframework.transaction.PlatformTransactionManager transactionManager,
                              ArchitectureBatchProcessor architecture, BoundedWorkMetrics metrics) {
        this.transactions = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        this.architecture = architecture;
        this.modelClient = modelClient;
        this.contextBuilder = contextBuilder;
        this.promptTemplate = promptTemplate;
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
        this.metrics = metrics;
    }

    public void explainSubject(String snapshotId, String subjectId, String subjectType) {
        log.info("Generating explanation for {} {} in snapshot {}", subjectType, subjectId, snapshotId);

        final String documentsFingerprint = contextBuilder.documentsFingerprint(snapshotId);
        final String provider = properties.getModel().getBaseUrl();
        final String modelId = properties.getModel().getModelId() == null ? "default-model" : properties.getModel().getModelId();
        final String profileFingerprint = profileIdentity();

        // A configured context window is a claim, not a measurement. If the provider rejects the
        // input size, rebuild the same subject within a smaller bounded budget rather than failing:
        // a shorter prompt is strictly more bounded, so no memory guarantee is weakened.
        ContextBuilder.SymbolContext ctx = null;
        ParsedExplanation parsed = null;
        RuntimeException sizeFailure = null;
        for (int shrink : CONTEXT_SHRINK_STEPS) {
            ContextBuilder.SymbolContext attempt = contextBuilder.buildContext(snapshotId, subjectId, subjectType, shrink);
            ctx = attempt;
            String system = promptTemplate.getSystemPrompt();
            String user = promptTemplate.getUserPrompt(attempt);
            Set<String> allowed = new HashSet<>();
            attempt.evidenceItems().forEach(e -> allowed.add(e.id()));
            try {
                parsed = requestAndValidate(system, user, allowed, attempt, snapshotId);
                sizeFailure = null;
                break;
            } catch (ModelClientService.ContextLimitException | ModelClientService.RequestLimitException tooLarge) {
                sizeFailure = tooLarge;
                log.info("Rebuilding {} {} within a smaller bounded context after a provider size rejection", subjectType, subjectId);
            }
        }
        if (sizeFailure != null) throw new GenerationException(boundedLimitDetail(sizeFailure));

        String targetSymbolId = ctx.symbolId();
        String systemPrompt = promptTemplate.getSystemPrompt();
        String userPrompt = promptTemplate.getUserPrompt(ctx);
        String fingerprint = fingerprint(systemPrompt, userPrompt, profileFingerprint);
        final ContextBuilder.SymbolContext context = ctx;
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
            && contextBuilder.dependenciesFresh(snapshotId, context.dependencies());
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
            fingerprint, toJson(context.evidenceItems()), toJson(context.dependencies()), provider, PromptTemplate.VERSION, fresh ? "READY" : "STALE", snapshotId, targetSymbolId, subjectType);
        invalidateChangedDependencies(snapshotId);
        });
        log.info("Persisted explanation for {} {}", subjectType, targetSymbolId);
    }

    public static class SynthesisException extends IllegalArgumentException {
        public SynthesisException(String message) { super(message); }
    }

    /** A per-subject failure whose message is safe to show: numbers and settings only, never content. */
    public static class GenerationException extends IllegalArgumentException {
        public GenerationException(String message) { super(message); }
    }

    /** Bounded attempts for one subject. Transient provider faults must not need a human retry. */
    static final int MODEL_ATTEMPTS = 4;
    /**
     * Geometric rebuilds for one subject. A model whose real window is a fraction of the configured
     * one is only discoverable by being told no, and each step costs one rejected request, never a
     * generation. Correcting the profile stops the search after the first attempt.
     */
    static final int[] CONTEXT_SHRINK_STEPS = {1, 4, 16, 64};

    /** One bounded request plus at most one schema repair, for a context already built. */
    private ParsedExplanation requestAndValidate(String system, String user, Set<String> allowed,
                                                 ContextBuilder.SymbolContext ctx, String snapshotId) {
        String response = requestExplanation(system, user);
        try { return validate(response, allowed, snapshotId); }
        catch (IllegalArgumentException invalid) {
            // One bounded repair request with the same evidence. Never promote invalid prose to facts.
            // Naming the acceptable IDs is what makes the repair land; "use only the supplied IDs"
            // alone leaves the model guessing at the opaque identifier format.
            String repairPrompt = user + "\nYour previous answer failed bounded validation: " + boundedError(invalid.getMessage()) +
                ". Return the exact requested schema. Every evidenceIds entry must be copied verbatim from this list: " +
                citableIds(ctx) + ". suggestedNextSymbolIds may be empty. Do not invent citations.";
            // The repair request is issued outside the catch below so that a limit failure during
            // the repair keeps its own diagnosis instead of being relabelled a schema error.
            String repaired = requestExplanation(system, repairPrompt);
            try { return validate(repaired, allowed, snapshotId); }
            catch (IllegalArgumentException stillInvalid) {
                throw new GenerationException("The model did not return the required explanation schema, even after one repair attempt: "
                    + boundedError(stillInvalid.getMessage()) + ". Try again, or use a model that follows strict JSON schemas.");
            }
        }
    }

    private String requestExplanation(String systemPrompt, String userPrompt) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= MODEL_ATTEMPTS; attempt++) {
            try { return modelClient.getExplanation(systemPrompt, userPrompt); }
            catch (ModelClientService.ContextLimitException | ModelClientService.RequestLimitException tooLarge) {
                // The caller can still rebuild this subject smaller, so the size rejection stays typed.
                throw tooLarge;
            }
            catch (ModelClientService.OutputLimitException | ModelClientService.OversizedResponseException bounded) {
                // Shrinking the prompt does not reliably shorten an answer. Report the limit instead.
                throw new GenerationException(boundedLimitDetail(bounded));
            }
            catch (IllegalStateException misconfigured) {
                // A missing endpoint never becomes reachable by retrying it.
                throw new GenerationException("No model endpoint is configured. Set the model profile in Settings, then retry.");
            }
            catch (RuntimeException transientFailure) {
                last = transientFailure;
                if (attempt == MODEL_ATTEMPTS) break;
                try { Thread.sleep(Math.min(8_000L, 500L << (attempt - 1))); }
                catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new java.util.concurrent.CancellationException("Explanation interrupted during bounded retry backoff.");
                }
            }
        }
        // Only the exception type is safe to repeat: a provider error message can carry response data.
        throw new GenerationException("The model provider did not answer after " + MODEL_ATTEMPTS
            + " attempts (" + (last == null ? "unknown error" : last.getClass().getSimpleName())
            + "). Check that the endpoint is reachable and the model is available, then retry.");
    }

    private String boundedLimitDetail(RuntimeException bounded) {
        var model = properties.getModel();
        String settings = " context-budget=" + model.getContextBudget() + " output-budget=" + model.getOutputBudget()
            + " max-request-bytes=" + model.getMaxRequestBytes() + " max-response-bytes=" + model.getMaxResponseBytes() + ".";
        if (bounded instanceof ModelClientService.ContextLimitException)
            return "The model rejected the input context size. Lower the explanation context limits or raise the model context window, then retry." + settings;
        if (bounded instanceof ModelClientService.OutputLimitException)
            return "The model stopped at its output limit before finishing the JSON answer. Raise the output budget for this profile, or choose a model that reserves less of that budget for internal reasoning, then retry." + settings;
        if (bounded instanceof ModelClientService.RequestLimitException)
            return "The bounded request exceeded the configured request byte cap. Lower the explanation context limits or raise max-request-bytes, then retry." + settings;
        return "The provider response exceeded the configured response byte cap. Raise max-response-bytes or lower the output budget, then retry." + settings;
    }

    /** The evidence IDs a repair attempt may cite, bounded so the repair prompt stays small. */
    private String citableIds(ContextBuilder.SymbolContext ctx) {
        return ctx.evidenceItems().stream().map(ContextBuilder.EvidenceItem::id)
            .limit(properties.getExplanations().getInventoryRows()).toList().toString();
    }
    public record ArchitectureInputs(String documents, String profile, String fingerprint) {}

    public boolean architectureInputsFresh(String snapshot, ArchitectureInputs inputs) {
        return inputs.documents().equals(contextBuilder.documentsFingerprint(snapshot)) && inputs.profile().equals(profileIdentity())
            && jdbcTemplate.queryForObject("SELECT COUNT(*) FROM explanation_syntheses WHERE snapshot_id = ? AND input_fingerprint = ? AND status = 'READY'", Integer.class, snapshot, inputs.fingerprint()) > 0;
    }

    /** Bounded resumable preparation; publishing complete class coverage is atomic. */
    public ArchitectureInputs synthesizeArchitecture(String snapshotId) {
        return synthesizeArchitecture(snapshotId, () -> true, progress -> {});
    }

    public ArchitectureInputs synthesizeArchitecture(String snapshotId, java.util.function.BooleanSupplier active,
            java.util.function.Consumer<ArchitectureBatchProcessor.Progress> progress) {
        String documents = contextBuilder.documentsFingerprint(snapshotId);
        String profile = profileIdentity();
        String input = contextBuilder.architectureFingerprint(snapshotId, profile);
        var inputs = new ArchitectureInputs(documents, profile, input);
        if (architectureInputsFresh(snapshotId, inputs)) return inputs;
        String provider = properties.getModel().getBaseUrl();
        String model = properties.getModel().getModelId();
        ArchitectureBatchProcessor.Result result;
        try {
            result = architecture.generate(snapshotId, input, () -> {
                if (!documents.equals(contextBuilder.documentsFingerprint(snapshotId)) || !profile.equals(profileIdentity()))
                    throw new SynthesisException("Project documents or model settings changed during synthesis. Retry Explain all.");
                return active.getAsBoolean();
            }, progress);
        } catch (IllegalArgumentException error) { throw new SynthesisException(error.getMessage()); }
        if (!active.getAsBoolean()) throw new java.util.concurrent.CancellationException();
        transactions.executeWithoutResult(transaction -> {
            if (!active.getAsBoolean()) throw new java.util.concurrent.CancellationException();
            if (!documents.equals(contextBuilder.documentsFingerprint(snapshotId)) || !profile.equals(profileIdentity()))
                throw new SynthesisException("Project documents or model settings changed during synthesis. Retry Explain all.");
            int staged = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM architecture_class_purposes WHERE snapshot_id=? AND run_fingerprint=?", Integer.class, snapshotId, input);
            int expected = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM symbol_versions WHERE snapshot_id=? AND kind='CLASS' AND COALESCE(source_status,'ACTIVE')='ACTIVE'", Integer.class, snapshotId);
            if (staged != expected || result.classCount() != expected) throw new SynthesisException("Validated architecture batches do not cover every active CLASS; nothing was published.");
            String synthesisId = UUID.randomUUID().toString();
            jdbcTemplate.update("UPDATE explanation_syntheses SET status = 'STALE' WHERE snapshot_id = ? AND status = 'READY'", snapshotId);
            jdbcTemplate.update("INSERT INTO explanation_syntheses (id, snapshot_id, status, schema_version, prompt_version, model_id, provider_base_url, input_fingerprint, context_evidence) VALUES (?, ?, 'READY', '1', ?, ?, ?, ?, ?)",
                synthesisId, snapshotId, PromptTemplate.SYNTHESIS_VERSION, model, provider, input,
                toJson(Map.of("schemaVersion", "2", "runFingerprint", input, "finalBriefStageKey", String.valueOf(result.finalBriefStageKey()),
                    "validatedClassCount", expected, "checkpointCount", result.checkpointCount())));
            jdbcTemplate.update("""
                INSERT INTO class_pre_explanations(symbol_id,synthesis_id,business_logic)
                SELECT symbol_id,?,business_logic FROM architecture_class_purposes
                WHERE snapshot_id=? AND run_fingerprint=?
                ON CONFLICT(symbol_id) DO UPDATE SET synthesis_id=excluded.synthesis_id,business_logic=excluded.business_logic
                """, synthesisId, snapshotId, input);
            invalidateChangedDependencies(snapshotId);
        });
        return inputs;
    }

    private void invalidateChangedDependencies(String snapshot) {
        // A refreshed consumed output can stale downstream explanations; bounded fixed point also
        // handles cycles. Merely adding a new explanation has no effect on earlier independent work.
        boolean changed;
        int page = Math.max(1, properties.getExplanations().getArchitecturePageRows());
        do {
            changed = false;
            String lastId = "";
            while (true) {
                var rows = jdbcTemplate.queryForList("SELECT id,context_dependencies FROM explanations WHERE snapshot_id=? AND status='READY' AND context_dependencies!='[]' AND id>? ORDER BY id LIMIT ?", snapshot, lastId, page);
                metrics.rowsLoaded(rows.size());
                if (rows.isEmpty()) break;
                for (var row : rows) {
                    try {
                        List<ContextBuilder.ContextDependency> dependencies = objectMapper.readValue((String)row.get("context_dependencies"), new TypeReference<>() {});
                        if (!contextBuilder.dependenciesFresh(snapshot, dependencies)) {
                            jdbcTemplate.update("UPDATE explanations SET status='STALE',updated_at=CURRENT_TIMESTAMP WHERE id=?", row.get("id"));
                            jdbcTemplate.update("UPDATE explanation_queue SET status='SKIPPED',updated_at=CURRENT_TIMESTAMP WHERE snapshot_id=? AND status='COMPLETED' AND subject_id=(SELECT subject_version_id FROM explanations WHERE id=?) AND subject_type=(SELECT subject_type FROM explanations WHERE id=?)", snapshot, row.get("id"), row.get("id"));
                            changed = true;
                        }
                    } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("Invalid stored context dependencies", e); }
                    lastId = String.valueOf(row.get("id"));
                }
                if (rows.size() < page) break;
            }
        } while (changed);
    }

    private record ParsedExplanation(String label, String summary, List<Map<String,Object>> claims, List<String> unknowns, List<String> next) {}
    private ParsedExplanation validate(String response, Set<String> allowed, String snapshot) {
        try {
            int responseBytes = BoundedWorkMetrics.utf8Bytes(response);
            if(response == null || responseBytes > properties.getModel().getMaxResponseBytes()) throw new IllegalArgumentException("Response absent or exceeds the configured byte limit");
            metrics.responseBytes(responseBytes);
            JsonNode root=objectMapper.readTree(response);
            if(!root.isObject() || !root.path("shortLabel").isTextual() || !root.path("hoverSummary").isTextual() || !root.path("claims").isArray()) throw new IllegalArgumentException("Expected shortLabel, hoverSummary and claims array");
            int textLimit=properties.getExplanations().getExplanationChars();
            if(root.path("shortLabel").asText().length()>160 || root.path("hoverSummary").asText().length()>textLimit) throw new IllegalArgumentException("Explanation text exceeds configured limits");
            if(root.get("claims").size()>properties.getExplanations().getEvidenceOccurrences()) throw new IllegalArgumentException("Too many claims");
            List<Map<String,Object>> claims=new ArrayList<>();
            for(JsonNode claim:root.get("claims")) {
                String description=claim.path("description").asText(claim.path("text").asText(""));
                String basis=claim.path("basis").asText("").toUpperCase();
                try { ClaimBasis.valueOf(basis); } catch(Exception e) {throw new IllegalArgumentException("Use SOURCE_FACT, INFERRED_PURPOSE or UNKNOWN for claim basis");}
                List<String> ids=boundedArray(claim.path("evidenceIds"), properties.getExplanations().getEvidenceOccurrences(), 1000);
                if(description.isBlank() || description.length()>textLimit || ids.isEmpty() || ids.size()>properties.getExplanations().getEvidenceOccurrences() || !allowed.containsAll(ids)) throw new IllegalArgumentException("Each bounded claim must cite only supplied evidence IDs");
                if("SOURCE_FACT".equals(basis) && ids.stream().allMatch(e->e.startsWith("doc-") || e.startsWith("ai-"))) throw new IllegalArgumentException("Document/generated-only claims must be INFERRED_PURPOSE, not SOURCE_FACT");
                claims.add(Map.of("description",description,"basis",basis,"evidenceIds",ids));
            }
            // Navigation hints are an optional convenience, not a grounded claim. Models routinely
            // answer with qualified names here because no supplied block states the opaque ID format.
            // Drop whatever is not a real symbol in this snapshot instead of discarding a valid,
            // fully grounded explanation: nothing fabricated reaches the UI either way.
            List<String> next=knownSymbolIds(snapshot,
                boundedArray(root.path("suggestedNextSymbolIds"), properties.getExplanations().getRelatedSymbols(), 1000));
            List<String> unknowns=boundedArray(root.path("unknowns"), properties.getExplanations().getEvidenceOccurrences(), textLimit);
            return new ParsedExplanation(root.get("shortLabel").asText(),root.get("hoverSummary").asText(),claims,unknowns,next);
        } catch(IllegalArgumentException e) {throw e;}
        catch(Exception e) {throw new IllegalArgumentException("Return one valid JSON object matching the schema");}
    }
    /** Keeps only navigation IDs that name a real symbol in this snapshot, preserving model order. */
    private List<String> knownSymbolIds(String snapshot, List<String> candidates) {
        if (candidates.isEmpty()) return List.of();
        List<String> distinct = new ArrayList<>(new LinkedHashSet<>(candidates));
        String placeholders = String.join(",", java.util.Collections.nCopies(distinct.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(snapshot);
        args.addAll(distinct);
        var known = new HashSet<>(jdbcTemplate.queryForList(
            "SELECT id FROM symbol_versions WHERE snapshot_id=? AND id IN (" + placeholders + ")", String.class, args.toArray()));
        metrics.rowsLoaded(known.size());
        return distinct.stream().filter(known::contains).toList();
    }

    private List<String> boundedArray(JsonNode node, int maximumItems, int maximumCharacters) {
        if(node.isMissingNode() || node.isNull()) return List.of();
        if(!node.isArray()) throw new IllegalArgumentException("Expected a JSON array");
        if(node.size()>maximumItems) throw new IllegalArgumentException("Array exceeds configured item limit");
        List<String> result=new ArrayList<>(node.size());
        for(JsonNode item:node){
            if(!item.isTextual() || item.asText().length()>maximumCharacters) throw new IllegalArgumentException("Array value exceeds configured text limit");
            result.add(item.asText());
        }
        return result;
    }

    public ExplanationResponse getExplanationForSymbol(String snapshotId, String symbolId) {
        return getExplanation(snapshotId, symbolId, "symbol");
    }
    public ExplanationResponse getExplanation(String snapshotId, String symbolId, String subjectType) {
        var full = getFullExplanation(snapshotId, symbolId, subjectType);
        ExplanationResponse.PreExplanation pre = null;
        if ("symbol".equals(subjectType)) {
            var rows = jdbcTemplate.queryForList("""
                SELECT substr(p.business_logic,1,?) AS business_logic,a.status,a.model_id,a.generated_at,a.input_fingerprint
                FROM class_pre_explanations p JOIN explanation_syntheses a ON a.id=p.synthesis_id
                JOIN symbol_versions s ON s.id=p.symbol_id
                WHERE a.snapshot_id=? AND (s.id=? OR s.qualified_name=?)
                ORDER BY CASE WHEN s.id=? THEN 0 ELSE 1 END,s.id LIMIT 1
                """, properties.getExplanations().getExplanationChars(), snapshotId, symbolId, symbolId, symbolId);
            metrics.rowsLoaded(rows.size());
            if (!rows.isEmpty()) {
                var row = rows.get(0);
                pre = new ExplanationResponse.PreExplanation((String)row.get("business_logic"), "READY".equals(row.get("status")) ? "DRAFT" : "STALE",
                    row.get("model_id") + " · " + row.get("generated_at") + " · Architecture " + row.get("input_fingerprint"));
            }
        }
        return new ExplanationResponse(full.shortLabel(), full.hoverSummary(), full.claims(), full.unknowns(), full.suggestedNextSymbolIds(), full.status(), full.provenance(), pre, full.errorDetail());
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
        String queuedError = null;
        var queueRows = jdbcTemplate.queryForList("SELECT status,substr(COALESCE(last_error,''),1,1000) AS last_error FROM explanation_queue WHERE snapshot_id = ? AND subject_id = ? AND subject_type = ? ORDER BY updated_at DESC LIMIT 1", snapshotId, targetId, subjectType);
        if (!queueRows.isEmpty()) {
            queuedStatus = switch (String.valueOf(queueRows.get(0).get("status"))) {
                case "PENDING" -> ExplanationStatus.QUEUED;
                case "IN_PROGRESS" -> ExplanationStatus.RUNNING;
                case "FAILED" -> ExplanationStatus.FAILED;
                default -> null;
            };
            String stored = (String) queueRows.get(0).get("last_error");
            if (queuedStatus == ExplanationStatus.FAILED && stored != null && !stored.isBlank()) queuedError = stored;
        }
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

            return new ExplanationResponse(shortLabel, hoverSummary, claims, unknowns, suggested, status, provenance, null, queuedError);
        }

        // If no explanations record exists, check explanation_queue for status
        try {
            var qRows = jdbcTemplate.queryForList(
                    "SELECT status,substr(COALESCE(last_error,''),1,1000) AS last_error FROM explanation_queue WHERE snapshot_id = ? AND (subject_id = ? OR subject_id = ?) AND subject_type = ? " +
                            "ORDER BY updated_at DESC LIMIT 1",
                    snapshotId, targetId, symbolId, subjectType
            );
            if (!qRows.isEmpty()) {
                ExplanationStatus status = switch (String.valueOf(qRows.get(0).get("status"))) {
                    case "PENDING" -> ExplanationStatus.QUEUED;
                    case "IN_PROGRESS" -> ExplanationStatus.RUNNING;
                    case "FAILED" -> ExplanationStatus.FAILED;
                    default -> ExplanationStatus.NOT_REQUESTED;
                };
                String stored = (String) qRows.get(0).get("last_error");
                return new ExplanationResponse(null, null, List.of(), List.of(), List.of(), status, null, null,
                    status == ExplanationStatus.FAILED && stored != null && !stored.isBlank() ? stored : null);
            }
        } catch (Exception ignored) {}

        return new ExplanationResponse(null, null, List.of(), List.of(), List.of(), ExplanationStatus.NOT_REQUESTED, null);
    }

    public Object getEvidence(String snapshot, String subject, String type) {
        int limit = properties.getModel().getMaxRequestBytes();
        var rows = jdbcTemplate.queryForList("""
            SELECT length(context_evidence) AS chars,substr(context_evidence,1,?) AS context_evidence
            FROM explanations WHERE snapshot_id=? AND subject_version_id=? AND subject_type=?
            ORDER BY updated_at DESC,id LIMIT 1
            """, limit, snapshot, subject, type);
        metrics.rowsLoaded(rows.size());
        Object storedChars = rows.isEmpty() ? null : rows.get(0).get("chars");
        if (storedChars instanceof Number count && count.longValue() > limit)
            return List.of(Map.of("id", "context-limits", "label", "Legacy evidence omitted",
                "content", "Stored evidence predates bounded context schema 4.0 and exceeds the configured read limit. Regenerate this explanation to inspect bounded evidence."));
        try { return rows.isEmpty() || rows.get(0).get("context_evidence") == null ? List.of() : objectMapper.readTree(String.valueOf(rows.get(0).get("context_evidence"))); }
        catch (Exception e) { return List.of(); }
    }
    private String profileIdentity() {
        var model=properties.getModel();
        return String.valueOf(model.getBaseUrl()) + "|" + model.getModelId() + "|" + model.getContextBudget() + "|"
            + model.getOutputBudget() + "|" + model.getTemperature() + "|" + model.getMaxRequestBytes() + "|" + model.getMaxResponseBytes();
    }
    private String fingerprint(String... values) {
        try {
            var digest=java.security.MessageDigest.getInstance("SHA-256");
            for(String value:values) { if(value!=null) digest.update(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)); digest.update((byte)0); }
            return java.util.HexFormat.of().formatHex(digest.digest());
        }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private String boundedError(String value) {
        if (value == null) return "invalid output";
        return value.substring(0, Math.min(300, value.length()));
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
