package dev.codeatlas.explanations;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import java.nio.file.Path;
import java.sql.DriverManager;
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

    @Test void deletingSnapshotCleansBoundedWorkAndGraphRowsButPreservesWorkspaceNotes() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("cleanup.db");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        try (var connection = DriverManager.getConnection(url)) {
            connection.createStatement().execute("PRAGMA foreign_keys=ON");
            var db = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
            db.update("INSERT INTO workspaces(id,canonical_root,display_name,active_snapshot_id,created_at,updated_at) VALUES('w','/cleanup','Cleanup','s',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
            db.update("INSERT INTO snapshots(id,workspace_id,status,created_at) VALUES('s','w','published',CURRENT_TIMESTAMP)");
            db.update("INSERT INTO logical_symbols(workspace_id,key) VALUES('w','class')");
            db.update("INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,simple_name,content_hash) VALUES('sym','s','class','w','CLASS','demo.C','C','hash')");
            db.update("INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content) VALUES('file','s','C.java','hash','class C {}')");
            db.update("INSERT INTO evidence(id,source_file_version_id,start_line,end_line) VALUES('ev','file',1,1)");
            db.update("INSERT INTO symbol_evidence(symbol_version_id,evidence_id) VALUES('sym','ev')");
            db.update("INSERT INTO relationship_occurrences(id,snapshot_id,source_symbol_id,target_symbol_id,kind,resolution) VALUES('rel','s','sym','sym','CALLS','RESOLVED')");
            db.update("INSERT INTO relationship_evidence(relationship_id,evidence_id) VALUES('rel','ev')");
            db.update("INSERT INTO http_routes(id,snapshot_id,symbol_version_id,http_method,path) VALUES('route','s','sym','GET','/c')");
            db.update("INSERT INTO injection_points(id,snapshot_id,source_symbol_id,target_type_name,injection_kind,resolution) VALUES('inj','s','sym','demo.C','constructor','RESOLVED')");
            db.update("INSERT INTO explanations(id,subject_version_id,subject_type,snapshot_id,status,schema_version,created_at,updated_at) VALUES('exp','sym','symbol','s','READY','1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
            db.update("INSERT INTO explanation_syntheses(id,snapshot_id,status,schema_version,prompt_version,input_fingerprint,context_evidence) VALUES('syn','s','READY','1','3.0','run','{}')");
            db.update("INSERT INTO class_pre_explanations(symbol_id,synthesis_id,business_logic) VALUES('sym','syn','Purpose')");
            db.update("INSERT INTO architecture_checkpoints(snapshot_id,stage_key,stage_kind,prompt_version,input_context,output_json,run_fingerprint) VALUES('s','stage','summary','3.0','bounded','{}','run')");
            db.update("INSERT INTO architecture_class_purposes(snapshot_id,run_fingerprint,symbol_id,stage_key,business_logic) VALUES('s','run','sym','stage','Purpose')");
            db.update("INSERT INTO jobs(id,workspace_id,snapshot_id,operation,status,created_at,updated_at) VALUES('job','w','s','EXPLAIN_ALL','COMPLETED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
            db.update("INSERT INTO job_items(id,job_id,subject_id,subject_type,status,created_at,updated_at) VALUES('item','job','sym','symbol','COMPLETED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
            db.update("INSERT INTO explanation_queue(id,workspace_id,snapshot_id,subject_id,subject_type,job_id,dedup_key) VALUES('queue','w','s','sym','symbol','job','q')");
            db.update("INSERT INTO notes(id,workspace_id,logical_subject_key,subject_type,content,created_at,updated_at) VALUES('note','w','class','symbol','Keep me',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
            db.update("INSERT INTO bookmarks(id,workspace_id,logical_subject_key,subject_type,created_at) VALUES('bookmark','w','class','symbol',CURRENT_TIMESTAMP)");

            assertTrue(db.update("DELETE FROM snapshots WHERE id='s'") >= 1);
            for (String table : new String[]{"snapshots","symbol_versions","source_file_versions","evidence","relationship_occurrences","relationship_evidence","symbol_evidence","http_routes","injection_points","explanations","explanation_syntheses","class_pre_explanations","architecture_checkpoints","architecture_class_purposes","explanation_queue","jobs","job_items"})
                assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class), table);
            assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM notes", Integer.class));
            assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM bookmarks", Integer.class));
            assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM logical_symbols", Integer.class));
            assertNull(db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id='w'", String.class));
            assertEquals("ok", db.queryForObject("PRAGMA integrity_check", String.class));
        }
    }
}
