package dev.codeatlas.api;
import dev.codeatlas.graph.SourceService;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@RestController
@RequestMapping("/api/snapshots/{snapshotId}")
public class SourceController {
    private final SourceService service;
    public SourceController(SourceService service) { this.service = service; }
    @GetMapping("/symbols/{id}/source") public SourceService.Source symbol(@PathVariable String snapshotId, @PathVariable String id) { return service.symbol(snapshotId, id); }
    @GetMapping("/relationships/{id}/source") public List<SourceService.Source> relationship(@PathVariable String snapshotId, @PathVariable String id) { return service.relationship(snapshotId, id); }
}
