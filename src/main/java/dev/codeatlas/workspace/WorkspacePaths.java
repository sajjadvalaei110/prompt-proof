package dev.codeatlas.workspace;

import java.io.File;

/** How a path typed or pasted into the import form is read: trimmed, unquoted, {@code ~} expanded, absolute. */
final class WorkspacePaths {
    private WorkspacePaths() {}

    static File normalize(String raw) {
        String pathStr = raw.trim();
        // Remove surrounding quotes if pasted with quotes
        if ((pathStr.startsWith("\"") && pathStr.endsWith("\"")) || (pathStr.startsWith("'") && pathStr.endsWith("'"))) {
            pathStr = pathStr.substring(1, pathStr.length() - 1).trim();
        }
        // Expand tilde ~ to user home
        if (pathStr.equals("~") || pathStr.startsWith("~" + File.separator) || pathStr.startsWith("~/")) {
            String userHome = System.getProperty("user.home");
            pathStr = userHome + pathStr.substring(1);
        }
        File file = new File(pathStr);
        return file.isAbsolute() ? file : file.getAbsoluteFile();
    }
}
