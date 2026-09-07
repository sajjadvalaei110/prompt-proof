package dev.codeatlas.api;

import dev.codeatlas.api.dto.JobResponse;
import dev.codeatlas.jobs.JobService;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ExplanationController {

    private final JobService jobService;
    
    public ExplanationController(JobService jobService) {
        this.jobService = jobService;
    }

    @PostMapping("/explanation-jobs")
    public JobResponse submitExplanationJob(@RequestParam String snapshotId, @RequestParam String subjectId) {
        return new JobResponse(UUID.randomUUID().toString(), "EXPLANATION", dev.codeatlas.api.dto.enums.JobStatus.PENDING, 0, 0, 0);
    }

    @GetMapping("/jobs/{id}")
    public JobResponse getJob(@PathVariable String id) {
        return jobService.getJob(id);
    }

    @PostMapping("/jobs/{id}/cancel")
    public void cancelJob(@PathVariable String id) {
    }
}
