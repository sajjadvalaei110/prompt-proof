package dev.codeatlas.review;

import dev.codeatlas.analysis.JavaAnalysisAdapter;
import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.api.dto.WorkspaceResponse;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.graph.GraphQueryService;
import dev.codeatlas.api.dto.ReviewRequest;
import dev.codeatlas.storage.WorkspaceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.*;

class ReviewServiceLanguageTest {

    @Test
    void unsupportedWorkspaceLanguageIsRejectedBeforeGitCaptureOrSnapshotCreation() {
        WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
        when(workspaces.findById("workspace")).thenReturn(Optional.of(
                new WorkspaceResponse("workspace", "/missing-repository", null, "not-shipped")));

        AnalysisPort java = mock(AnalysisPort.class);
        when(java.language()).thenReturn(JavaAnalysisAdapter.LANGUAGE);
        AnalysisPortRegistry registry = new AnalysisPortRegistry(List.of(java));
        GitReviewSourceAdapter git = mock(GitReviewSourceAdapter.class);
        JdbcTemplate db = mock(JdbcTemplate.class);
        AnalysisService analysis = mock(AnalysisService.class);
        ReviewService service = new ReviewService(
                db, analysis, mock(GraphQueryService.class), git,
                mock(CodeAtlasProperties.class), registry, workspaces);

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> service.capture("workspace", new ReviewRequest("1", null)));

        assertTrue(failure.getMessage().contains("No analysis adapter is available"), failure.getMessage());
        verifyNoInteractions(git, db, analysis);
        verify(workspaces).findById("workspace");
        verifyNoMoreInteractions(workspaces);
    }
}
