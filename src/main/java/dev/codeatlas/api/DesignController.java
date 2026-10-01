package dev.codeatlas.api;

import dev.codeatlas.design.AgentGuide;
import dev.codeatlas.design.DesignExchangeService;
import dev.codeatlas.design.DesignService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** The engineer-owned design layer (ADR 0014): read, change, export and import. */
@RestController
public class DesignController {
    private static final MediaType MARKDOWN = new MediaType("text", "markdown", java.nio.charset.StandardCharsets.UTF_8);
    private final DesignService design;
    private final DesignExchangeService exchange;

    public DesignController(DesignService design, DesignExchangeService exchange) {
        this.design = design;
        this.exchange = exchange;
    }

    @GetMapping("/api/workspaces/{workspaceId}/design")
    public DesignService.Overlay overlay(@PathVariable String workspaceId, @RequestParam(required = false) String snapshotId) {
        return design.overlay(workspaceId, snapshotId);
    }

    @PostMapping("/api/workspaces/{workspaceId}/design/changes")
    public DesignService.ChangeResult apply(@PathVariable String workspaceId, @RequestParam(defaultValue = "false") boolean dryRun,
                                            @RequestBody DesignService.ChangeSet changes) {
        return design.apply(workspaceId, changes, dryRun);
    }

    @GetMapping("/api/workspaces/{workspaceId}/design/export")
    public ResponseEntity<String> exportAll(@PathVariable String workspaceId) {
        return markdown(exchange.export(workspaceId, null));
    }

    @PostMapping("/api/workspaces/{workspaceId}/design/export")
    public ResponseEntity<String> export(@PathVariable String workspaceId, @RequestBody(required = false) DesignExchangeService.ExportRequest request) {
        return markdown(exchange.export(workspaceId, request));
    }

    @PostMapping("/api/workspaces/{workspaceId}/design/import")
    public DesignExchangeService.ImportResult importBrief(@PathVariable String workspaceId, @RequestBody DesignExchangeService.ImportRequest request) {
        return exchange.importBrief(workspaceId, request);
    }

    @GetMapping("/api/agent-guide")
    public ResponseEntity<String> agentGuide(@RequestParam(required = false) String workspaceId) {
        return markdown("# Code Atlas agent guide\n\n" + AgentGuide.markdown(workspaceId));
    }

    private static ResponseEntity<String> markdown(String body) {
        return ResponseEntity.ok().contentType(MARKDOWN).header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }
}
