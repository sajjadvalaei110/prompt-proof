package dev.codeatlas.api;
import dev.codeatlas.graph.NavigationService;
import dev.codeatlas.graph.SourceService;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
@RestController
@RequestMapping("/api/snapshots/{snapshotId}")
public class SourceController {
    private final SourceService service;
    private final NavigationService navigation;
    public SourceController(SourceService service, NavigationService navigation) { this.service = service; this.navigation = navigation; }
    @GetMapping("/symbols/{id}/source") public SourceService.Source symbol(@PathVariable String snapshotId, @PathVariable String id) { return service.symbol(snapshotId, id); }
    /** Grouped evidence for many relationship occurrences at once; body: {"ids": [...]}. */
    @PostMapping("/relationships/source") public List<SourceService.FileEvidence> relationships(@PathVariable String snapshotId, @RequestBody Map<String, List<String>> body) { return service.relationships(snapshotId, body == null ? List.of() : body.get("ids")); }
    @GetMapping("/relationships/{id}/source") public List<SourceService.Source> relationship(@PathVariable String snapshotId, @PathVariable String id) { return service.relationship(snapshotId, id); }
    /** Whole-file retained source, for building a diff between two snapshots of the same path. */
    @GetMapping("/files/source") public SourceService.FileContent file(@PathVariable String snapshotId, @RequestParam String path) { return service.file(snapshotId, path); }
    /** Go to definition for the resolved name at a 1-based position of an indexed file (ADR 0012). */
    @GetMapping("/files/definition") public NavigationService.Definition definition(@PathVariable String snapshotId, @RequestParam String path, @RequestParam int line, @RequestParam int column) { return navigation.definition(snapshotId, path, line, column); }
}
