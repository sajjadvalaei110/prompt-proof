import java.sql.*;

public class CheckDb {
    public static void main(String[] args) throws Exception {
        Connection conn = DriverManager.getConnection("jdbc:sqlite:./data/codeatlas.db");
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT active_snapshot_id FROM workspaces");
        if(rs.next()) {
            System.out.println("Active snapshot: " + rs.getString("active_snapshot_id"));
        }
        rs = stmt.executeQuery("SELECT count(*) FROM symbol_versions");
        if(rs.next()) {
            System.out.println("Symbols: " + rs.getInt(1));
        }
        conn.close();
    }
}
