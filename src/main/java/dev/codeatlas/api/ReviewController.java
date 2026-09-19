package dev.codeatlas.api;

import dev.codeatlas.api.dto.ReviewRequest;
import dev.codeatlas.api.dto.ReviewResponse;
import dev.codeatlas.review.ReviewService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workspaces")
public class ReviewController {
    private final ReviewService reviews;
    public ReviewController(ReviewService reviews) { this.reviews = reviews; }

    @PostMapping("/{workspaceId}/reviews")
    public ReviewResponse create(@PathVariable String workspaceId, @RequestBody(required = false) ReviewRequest request) {
        return reviews.capture(workspaceId, request == null ? new ReviewRequest("1", null) : request);
    }
}
