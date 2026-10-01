package dev.codeatlas.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "codeatlas")
public class CodeAtlasProperties {

    private String dataDir = "./data";
    private Model model = new Model();
    private ExplanationLimits explanations = new ExplanationLimits();
    private Indexers indexers = new Indexers();

    public String getDataDir() {
        return dataDir;
    }

    public void setDataDir(String dataDir) {
        this.dataDir = dataDir;
    }

    public Model getModel() {
        return model;
    }

    public void setModel(Model model) {
        this.model = model;
    }

    public Indexers getIndexers() { return indexers; }
    public void setIndexers(Indexers indexers) { this.indexers = indexers; }

    public ExplanationLimits getExplanations() { return explanations; }
    public void setExplanations(ExplanationLimits explanations) { this.explanations = explanations; }

    public static class Model {
        private String baseUrl;
        private String modelId;
        private String apiKey;
        private int contextBudget = 8192;
        private int outputBudget = 2048;
        private int timeoutSeconds = 60;
        private int concurrency = 2;
        private double temperature = 0.2;
        private String userAgent;
        private int maxRequestBytes = 1_048_576;
        private int maxResponseBytes = 262_144;

        // Getters and Setters
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getModelId() { return modelId; }
        public void setModelId(String modelId) { this.modelId = modelId; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public int getContextBudget() { return contextBudget; }
        public void setContextBudget(int contextBudget) { this.contextBudget = contextBudget; }
        public int getOutputBudget() { return outputBudget; }
        public void setOutputBudget(int outputBudget) { this.outputBudget = outputBudget; }
        public int getTimeoutSeconds() { return timeoutSeconds; }
        public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
        public int getConcurrency() { return concurrency; }
        public void setConcurrency(int concurrency) { this.concurrency = concurrency; }
        public double getTemperature() { return temperature; }
        public void setTemperature(double temperature) { this.temperature = temperature; }
        public String getUserAgent() { return userAgent; }
        public void setUserAgent(String userAgent) { this.userAgent = userAgent; }
        public int getMaxRequestBytes() { return maxRequestBytes; }
        public void setMaxRequestBytes(int maxRequestBytes) { this.maxRequestBytes = bounded(maxRequestBytes, 65_536, 8_388_608, 1_048_576); }
        public int getMaxResponseBytes() { return maxResponseBytes; }
        public void setMaxResponseBytes(int maxResponseBytes) { this.maxResponseBytes = bounded(maxResponseBytes, 16_384, 1_048_576, 262_144); }
        private static int bounded(int value, int min, int max, int fallback) { return value <= 0 ? fallback : Math.max(min, Math.min(max, value)); }
    }

    /** Hard working-set limits. Token settings never override these byte/row caps. */
    public static class ExplanationLimits {
        private int architecturePageRows = 128;
        private int architectureDocumentChars = 12_000;
        private int architectureSummaryFanIn = 8;
        private int architectureClassBatch = 16;
        private int classNeighborRows = 64;
        private int relatedSymbols = 24;
        private int relatedMethods = 16;
        private int evidenceOccurrences = 12;
        private int sourceChars = 16_000;
        private int explanationChars = 8_000;
        private int projectDocuments = 12;
        private int inventoryRows = 64;
        private int queueClaimRows = 1;

        public int getArchitecturePageRows() { return architecturePageRows; }
        public void setArchitecturePageRows(int value) { architecturePageRows = bounded(value, 1, 512, 128); }
        public int getArchitectureDocumentChars() { return architectureDocumentChars; }
        public void setArchitectureDocumentChars(int value) { architectureDocumentChars = bounded(value, 256, 50_000, 12_000); }
        public int getArchitectureSummaryFanIn() { return architectureSummaryFanIn; }
        public void setArchitectureSummaryFanIn(int value) { architectureSummaryFanIn = bounded(value, 2, 16, 8); }
        public int getArchitectureClassBatch() { return architectureClassBatch; }
        public void setArchitectureClassBatch(int value) { architectureClassBatch = bounded(value, 1, 16, 16); }
        public int getClassNeighborRows() { return classNeighborRows; }
        public void setClassNeighborRows(int value) { classNeighborRows = bounded(value, 1, 128, 64); }
        public int getRelatedSymbols() { return relatedSymbols; }
        public void setRelatedSymbols(int value) { relatedSymbols = bounded(value, 1, 64, 24); }
        public int getRelatedMethods() { return relatedMethods; }
        public void setRelatedMethods(int value) { relatedMethods = bounded(value, 1, 64, 16); }
        public int getEvidenceOccurrences() { return evidenceOccurrences; }
        public void setEvidenceOccurrences(int value) { evidenceOccurrences = bounded(value, 1, 32, 12); }
        public int getSourceChars() { return sourceChars; }
        public void setSourceChars(int value) { sourceChars = bounded(value, 256, 65_536, 16_000); }
        public int getExplanationChars() { return explanationChars; }
        public void setExplanationChars(int value) { explanationChars = bounded(value, 256, 16_384, 8_000); }
        public int getProjectDocuments() { return projectDocuments; }
        public void setProjectDocuments(int value) { projectDocuments = bounded(value, 1, 30, 12); }
        public int getInventoryRows() { return inventoryRows; }
        public void setInventoryRows(int value) { inventoryRows = bounded(value, 1, 128, 64); }
        public int getQueueClaimRows() { return queueClaimRows; }
        public void setQueueClaimRows(int value) { queueClaimRows = bounded(value, 1, 16, 1); }
        private static int bounded(int value, int min, int max, int fallback) { return value <= 0 ? fallback : Math.max(min, Math.min(max, value)); }
    }

    /** Optional indexing engines beyond the default source-only one per language (ADR 0012). */
    public static class Indexers {
        private ScipJava scipJava = new ScipJava();
        public ScipJava getScipJava() { return scipJava; }
        public void setScipJava(ScipJava scipJava) { this.scipJava = scipJava; }
    }

    /**
     * The scip-java engine. {@code home} is a directory of scip-java jars (as installed by
     * {@code ./gradlew installScipJava}); when it holds none, {@code command} is looked up on PATH instead.
     * {@code dependencyMode}: {@code offline-first} runs Gradle with {@code --offline} and repeats the build
     * online only when the offline build could not find a dependency in the local Gradle cache; {@code offline}
     * never goes online; {@code online} lets Gradle resolve normally. Either way Gradle uses the machine's own
     * Gradle user home, so anything already downloaded is reused, never downloaded again.
     */
    public static class ScipJava {
        private String home = "";
        private String command = "scip-java";
        private String dependencyMode = "offline-first";
        private int timeoutMinutes = 30;
        private boolean keepWorkDirectory = false;

        public String getHome() { return home; }
        public void setHome(String home) { this.home = home; }
        public String getCommand() { return command; }
        public void setCommand(String command) { this.command = command; }
        public String getDependencyMode() { return dependencyMode; }
        public void setDependencyMode(String dependencyMode) { this.dependencyMode = dependencyMode; }
        public int getTimeoutMinutes() { return timeoutMinutes; }
        public void setTimeoutMinutes(int timeoutMinutes) { this.timeoutMinutes = timeoutMinutes; }
        public boolean isKeepWorkDirectory() { return keepWorkDirectory; }
        public void setKeepWorkDirectory(boolean keepWorkDirectory) { this.keepWorkDirectory = keepWorkDirectory; }
    }
}
