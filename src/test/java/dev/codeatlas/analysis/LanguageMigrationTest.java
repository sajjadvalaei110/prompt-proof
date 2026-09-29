package dev.codeatlas.analysis;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class LanguageMigrationTest {
    @TempDir Path directory;

    @Test void upgradeBackfillsExistingWorkspaceAndSnapshotWithoutReplacingThem() {
        String url = "jdbc:sqlite:" + directory.resolve("language.db");
        Flyway.configure().dataSource(url, "", "").target("11").load().migrate();
        var db = new JdbcTemplate(new DriverManagerDataSource(url));
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,created_at,updated_at) VALUES('w','/fixture','Fixture',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        db.update("INSERT INTO snapshots(id,workspace_id,status,purpose,review_identity,created_at) VALUES('s','w','published','ANALYSIS','analysis-v11',CURRENT_TIMESTAMP)");
        db.update("INSERT INTO snapshots(id,workspace_id,status,purpose,review_identity,created_at) VALUES('review','w','published','REVIEW_BASE','base-v11',CURRENT_TIMESTAMP)");
        db.update("""
                INSERT INTO explanations(
                    id,subject_version_id,subject_type,snapshot_id,status,short_label,hover_summary,
                    claims,model_id,prompt_version,input_fingerprint,context_evidence,provider_base_url,
                    context_dependencies,created_at,updated_at)
                VALUES('legacy-explanation','legacy-symbol','symbol','s','READY','Legacy label','Legacy summary',
                       '[]','legacy-model','1.0','legacy-fingerprint','[]','mock://legacy','[]',
                       CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                """);
        db.update("UPDATE workspaces SET active_snapshot_id='s' WHERE id='w'");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        assertEquals("java", db.queryForObject("SELECT language FROM workspaces WHERE id='w'", String.class));
        assertEquals("java", db.queryForObject("SELECT language FROM snapshots WHERE id='s'", String.class));
        assertEquals("java", db.queryForObject("SELECT language FROM snapshots WHERE id='review'", String.class));
        assertEquals("s", db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id='w'", String.class));
        assertEquals("published", db.queryForObject("SELECT status FROM snapshots WHERE id='s'", String.class));
        assertEquals("REVIEW_BASE", db.queryForObject("SELECT purpose FROM snapshots WHERE id='review'", String.class));
        assertEquals("base-v11", db.queryForObject("SELECT review_identity FROM snapshots WHERE id='review'", String.class));
        assertEquals("READY", db.queryForObject("SELECT status FROM explanations WHERE id='legacy-explanation'", String.class));
        assertEquals("Legacy label", db.queryForObject("SELECT short_label FROM explanations WHERE id='legacy-explanation'", String.class));
        assertEquals("legacy-model", db.queryForObject("SELECT model_id FROM explanations WHERE id='legacy-explanation'", String.class));
        assertEquals("legacy-fingerprint", db.queryForObject("SELECT input_fingerprint FROM explanations WHERE id='legacy-explanation'", String.class));
        assertEquals("mock://legacy", db.queryForObject("SELECT provider_base_url FROM explanations WHERE id='legacy-explanation'", String.class));
        assertThrows(org.springframework.dao.DataAccessException.class,
                () -> db.update("UPDATE workspaces SET language=NULL WHERE id='w'"));
        assertThrows(org.springframework.dao.DataAccessException.class,
                () -> db.update("UPDATE snapshots SET language=NULL WHERE id='s'"));
        assertEquals("ok", db.queryForObject("PRAGMA integrity_check", String.class));
    }
}
