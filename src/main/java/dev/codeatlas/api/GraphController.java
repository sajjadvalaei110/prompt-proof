package dev.codeatlas.api;

import dev.codeatlas.graph.GraphQueryService;
import dev.codeatlas.api.dto.GraphResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/snapshots")
public class GraphController {
    private final GraphQueryService graphQueryService;

    public GraphController(GraphQueryService graphQueryService) {
        this.graphQueryService = graphQueryService;
    }

    @GetMapping("/{id}/graph")
    public GraphResponse getGraph(@PathVariable String id) {
        return graphQueryService.getGraph(id);
    }
}
