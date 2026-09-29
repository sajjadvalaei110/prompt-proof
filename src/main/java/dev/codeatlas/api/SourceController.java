package dev.codeatlas.api;
import dev.codeatlas.graph.SourceService;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
@RestController
@RequestMapping("/api/snapshots/{snapshotId}")
public class SourceController {
    private final SourceService service;
    public SourceController(SourceService service) { this.service = service; }
    @GetMapping("/symbols/{id}/source") public SourceService.Source symbol(@PathVariable String snapshotId, @PathVariable String id) { return service.symbol(snapshotId, id); }
    /** Grouped evidence for many relationship occurrences at once; body: {"ids": [...]}. */
    @PostMapping("/relationships/source") public List<SourceService.FileEvidence> relationships(@PathVariable String snapshotId, @RequestBody Map<String, List<String>> body) { return service.relationships(snapshotId, body == null ? List.of() : body.get("ids")); }
    @GetMapping("/relationships/{id}/source") public List<SourceService.Source> relationship(@PathVariable String snapshotId, @PathVariable String id) { return service.relationship(snapshotId, id); }
    /** Whole-file retained source, for building a diff between two snapshots of the same path. */
    @GetMapping("/files/source") public SourceService.FileContent file(@PathVariable String snapshotId, @RequestParam String path) { return service.file(snapshotId, path); }
}
