package dev.codeatlas.config;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.io.File;
import java.sql.Connection;
import java.sql.Statement;

@Configuration
public class DataSourceConfig {

    @Value("${codeatlas.data-dir:./data}")
    private String dataDir;

    @Bean
    public DataSource dataSource(DataSourceProperties properties) {
        File dataDirFile = new File(dataDir);
        if (!dataDirFile.exists()) {
            dataDirFile.mkdirs();
        }

        HikariDataSource dataSource = properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
        
        dataSource.setConnectionInitSql("PRAGMA foreign_keys = ON;");
        dataSource.addDataSourceProperty("foreign_keys", "true");
        dataSource.addDataSourceProperty("journal_mode", "WAL");
        dataSource.addDataSourceProperty("busy_timeout", "5000");

        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement()) {
            stmt.execute("PRAGMA journal_mode = WAL;");
            stmt.execute("PRAGMA synchronous = NORMAL;");
            stmt.execute("PRAGMA busy_timeout = 5000;");
            stmt.execute("PRAGMA foreign_keys = ON;");
        } catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger(DataSourceConfig.class)
                    .warn("Failed to initialize SQLite pragmas: {}", e.getMessage());
        }

        return dataSource;
    }
}
