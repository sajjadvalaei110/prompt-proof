package dev.codeatlas.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "codeatlas")
public class CodeAtlasProperties {

    private String dataDir = "./data";
    private Model model = new Model();

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

    public static class Model {
        private String baseUrl;
        private String modelId;
        private String apiKey;
        private int contextBudget = 8192;
        private int outputBudget = 2048;
        private int timeoutSeconds = 60;
        private int concurrency = 2;
        private double temperature = 0.2;

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
    }
}
