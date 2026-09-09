package dev.codeatlas.explanations;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class HierarchicalMigrationTest {
    @TempDir Path directory;

    @Test void upgradeRetiresLegacyBulkEdgesButPreservesClicksAndCompletedOutputs() {
        String url = "jdbc:sqlite:" + directory.resolve("upgrade.db");
        Flyway.configure().dataSource(url, "", "").target("3").load().migrate();
        var db = new JdbcTemplate(new DriverManagerDataSource(url));
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES ('w','/fixture','Fixture',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        db.update("INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES ('s','w','published',CURRENT_TIMESTAMP)");
        db.update("INSERT INTO jobs (id, workspace_id, snapshot_id, operation, status, created_at, updated_at) VALUES ('job','w','s','EXPLAIN_ALL','RUNNING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        for (String item : new String[]{"bulk-edge", "explicit-edge", "completed-edge"}) {
            db.update("INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, priority, status, job_id, dedup_key) VALUES (?, 'w', 's', ?, 'relationship', ?, ?, 'job', ?)", item, item, item.equals("explicit-edge") ? 100 : 0, item.equals("completed-edge") ? "COMPLETED" : "PENDING", item);
        }
        db.update("INSERT INTO explanations (id, subject_version_id, subject_type, snapshot_id, status, hover_summary, created_at, updated_at) VALUES ('e','completed-edge','relationship','s','READY','Retain this successful explanation',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        assertEquals("SKIPPED", db.queryForObject("SELECT status FROM explanation_queue WHERE id = 'bulk-edge'", String.class));
        assertEquals("PENDING", db.queryForObject("SELECT status FROM explanation_queue WHERE id = 'explicit-edge'", String.class));
        assertEquals("COMPLETED", db.queryForObject("SELECT status FROM explanation_queue WHERE id = 'completed-edge'", String.class));
        assertEquals("READY", db.queryForObject("SELECT status FROM explanations WHERE id = 'e'", String.class));
        assertEquals("PENDING", db.queryForObject("SELECT synthesis_status FROM jobs WHERE id = 'job'", String.class));
        assertEquals("ok", db.queryForObject("PRAGMA integrity_check", String.class));
    }
}
