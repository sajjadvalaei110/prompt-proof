package dev.codeatlas.analysis;

import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.MemberValuePair;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.File;
import java.util.*;

/**
 * Analyzes Spring Framework annotations in parsed Java source files.
 *
 * Detects:
 * - Spring stereotypes (@Component, @Service, @Repository, @Controller, @RestController, @Configuration)
 * - HTTP route mappings (@RequestMapping, @GetMapping, @PostMapping, etc.)
 * - Dependency injection points (constructor, field, @Autowired)
 * - @Qualifier annotations for named injection
 * - @Bean factory methods in @Configuration classes
 *
 * This analyzer works purely from source annotations — it does not execute
 * the target application or resolve runtime bean definitions. Resolution of
 * injection targets uses heuristic matching against the workspace symbol table.
 */
@Component
public class SpringAnnotationAnalyzer {

    private static final Logger log = LoggerFactory.getLogger(SpringAnnotationAnalyzer.class);

    private final JdbcTemplate jdbcTemplate;

    /** Spring stereotype annotation simple names → role label */
    private static final Map<String, String> STEREOTYPE_ANNOTATIONS = Map.of(
            "Component", "COMPONENT",
            "Service", "SERVICE",
            "Repository", "REPOSITORY",
            "Controller", "CONTROLLER",
            "RestController", "REST_CONTROLLER",
            "Configuration", "CONFIGURATION"
    );

    /** HTTP mapping annotation simple names → HTTP method */
    private static final Map<String, String> HTTP_MAPPING_ANNOTATIONS = Map.of(
            "RequestMapping", "REQUEST",
            "GetMapping", "GET",
            "PostMapping", "POST",
            "PutMapping", "PUT",
            "DeleteMapping", "DELETE",
            "PatchMapping", "PATCH"
    );

    public SpringAnnotationAnalyzer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    // -----------------------------------------------------------------------
    //  Data records for intermediate results
    // -----------------------------------------------------------------------

    /** A Spring stereotype detected on a class. */
    public record SpringRole(String qualifiedClassName, String role, String componentName) {}

    /** An HTTP route mapping detected on a method or class. */
    public record HttpRoute(
            String qualifiedClassName,
            String methodName,
            String httpMethod,
            String path,
            String consumes,
            String produces,
            int line
    ) {}

    /** A dependency injection point. */
    public record InjectionPoint(
            String sourceClassQualifiedName,
            String targetTypeName,
            String injectionKind,    // CONSTRUCTOR, FIELD, SETTER
            String qualifierValue,   // null if no @Qualifier
            int line
    ) {}

    /** A @Bean factory method. */
    public record BeanFactory(
            String configClassQualifiedName,
            String methodName,
            String returnTypeName,
            String qualifierValue,
            String profile,
            int line
    ) {}

    /** Aggregated Spring analysis results for a compilation unit. */
    public record SpringAnalysisResult(
            List<SpringRole> roles,
            List<HttpRoute> routes,
            List<InjectionPoint> injectionPoints,
            List<BeanFactory> beanFactories
    ) {
        public static SpringAnalysisResult empty() {
            return new SpringAnalysisResult(List.of(), List.of(), List.of(), List.of());
        }

        public boolean isEmpty() {
            return roles.isEmpty() && routes.isEmpty()
                    && injectionPoints.isEmpty() && beanFactories.isEmpty();
        }
    }

    // -----------------------------------------------------------------------
    //  Public analysis entry point
    // -----------------------------------------------------------------------

    /**
     * Analyze a compilation unit for Spring annotations.
     * Returns structured results without persisting anything.
     */
    public SpringAnalysisResult analyze(CompilationUnit cu) {
        List<SpringRole> roles = new ArrayList<>();
        List<HttpRoute> routes = new ArrayList<>();
        List<InjectionPoint> injectionPoints = new ArrayList<>();
        List<BeanFactory> beanFactories = new ArrayList<>();

        cu.findAll(ClassOrInterfaceDeclaration.class).forEach(cid -> {
            String qualifiedName = cid.getFullyQualifiedName().orElse(cid.getNameAsString());

            // 1. Detect Spring stereotypes
            detectStereotypes(cid, qualifiedName, roles);

            // 2. Detect class-level @RequestMapping
            String classPath = extractClassLevelRequestMapping(cid);

            // 3. Detect HTTP route mappings on methods
            detectHttpRoutes(cid, qualifiedName, classPath, routes);

            // 4. Detect constructor injection
            detectConstructorInjection(cid, qualifiedName, injectionPoints);

            // 5. Detect field injection (@Autowired fields)
            detectFieldInjection(cid, qualifiedName, injectionPoints);

            // 6. Detect @Bean factory methods in @Configuration classes
            if (hasAnnotation(cid, "Configuration")) {
                detectBeanFactories(cid, qualifiedName, beanFactories);
            }
        });

        return new SpringAnalysisResult(
                List.copyOf(roles),
                List.copyOf(routes),
                List.copyOf(injectionPoints),
                List.copyOf(beanFactories)
        );
    }

    // -----------------------------------------------------------------------
    //  Stereotype detection
    // -----------------------------------------------------------------------

    private void detectStereotypes(ClassOrInterfaceDeclaration cid,
                                   String qualifiedName,
                                   List<SpringRole> roles) {
        for (AnnotationExpr ann : cid.getAnnotations()) {
            String annName = ann.getNameAsString();
            String role = STEREOTYPE_ANNOTATIONS.get(annName);
            if (role != null) {
                String componentName = extractAnnotationValue(ann);
                roles.add(new SpringRole(qualifiedName, role, componentName));
                log.debug("Detected Spring stereotype {} on {}", role, qualifiedName);
            }
        }
    }

    // -----------------------------------------------------------------------
    //  HTTP route detection
    // -----------------------------------------------------------------------

    private String extractClassLevelRequestMapping(ClassOrInterfaceDeclaration cid) {
        for (AnnotationExpr ann : cid.getAnnotations()) {
            if ("RequestMapping".equals(ann.getNameAsString())) {
                String path = extractPathFromAnnotation(ann);
                return path != null ? path : "";
            }
        }
        return "";
    }

    private void detectHttpRoutes(ClassOrInterfaceDeclaration cid,
                                   String qualifiedName,
                                   String classPath,
                                   List<HttpRoute> routes) {
        cid.getMethods().forEach(method -> {
            for (AnnotationExpr ann : method.getAnnotations()) {
                String annName = ann.getNameAsString();
                String httpMethod = HTTP_MAPPING_ANNOTATIONS.get(annName);
                if (httpMethod != null) {
                    String methodPath = extractPathFromAnnotation(ann);
                    String fullPath = combinePaths(classPath, methodPath);
                    String consumes = extractNamedAttribute(ann, "consumes");
                    String produces = extractNamedAttribute(ann, "produces");
                    int line = method.getBegin().map(p -> p.line).orElse(-1);

                    // For @RequestMapping, determine actual HTTP method
                    if ("REQUEST".equals(httpMethod)) {
                        String requestMethod = extractNamedAttribute(ann, "method");
                        httpMethod = requestMethod != null ? requestMethod : "GET";
                    }

                    routes.add(new HttpRoute(
                            qualifiedName, method.getNameAsString(),
                            httpMethod, fullPath, consumes, produces, line));
                    log.debug("Detected HTTP route {} {} on {}.{}",
                            httpMethod, fullPath, qualifiedName, method.getNameAsString());
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    //  Injection detection
    // -----------------------------------------------------------------------

    private void detectConstructorInjection(ClassOrInterfaceDeclaration cid,
                                             String qualifiedName,
                                             List<InjectionPoint> injectionPoints) {
        List<ConstructorDeclaration> constructors = cid.getConstructors();
        if (constructors.isEmpty()) return;

        // In Spring, if a class has exactly one constructor, it's auto-wired implicitly.
        // If it has @Autowired, it's explicit.
        for (ConstructorDeclaration ctor : constructors) {
            boolean isAutowired = hasAnnotation(ctor, "Autowired") || constructors.size() == 1;
            if (!isAutowired) continue;

            for (Parameter param : ctor.getParameters()) {
                String typeName = param.getType().asString();
                // Try to resolve fully qualified name
                try {
                    typeName = param.getType().resolve().describe();
                } catch (Exception e) {
                    // Use simple name if resolution fails
                }

                String qualifier = extractQualifierFromAnnotations(param.getAnnotations());
                int line = ctor.getBegin().map(p -> p.line).orElse(-1);

                injectionPoints.add(new InjectionPoint(
                        qualifiedName, typeName, "CONSTRUCTOR", qualifier, line));
                log.debug("Detected constructor injection of {} into {} (qualifier={})",
                        typeName, qualifiedName, qualifier);
            }
        }
    }

    private void detectFieldInjection(ClassOrInterfaceDeclaration cid,
                                       String qualifiedName,
                                       List<InjectionPoint> injectionPoints) {
        for (FieldDeclaration field : cid.getFields()) {
            if (hasAnnotation(field, "Autowired")) {
                field.getVariables().forEach(var -> {
                    String typeName = var.getType().asString();
                    try {
                        typeName = var.getType().resolve().describe();
                    } catch (Exception e) {
                        // Use simple name
                    }

                    String qualifier = extractQualifierFromAnnotations(field.getAnnotations());
                    int line = field.getBegin().map(p -> p.line).orElse(-1);

                    injectionPoints.add(new InjectionPoint(
                            qualifiedName, typeName, "FIELD", qualifier, line));
                    log.debug("Detected field injection of {} into {} (qualifier={})",
                            typeName, qualifiedName, qualifier);
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    //  @Bean factory detection
    // -----------------------------------------------------------------------

    private void detectBeanFactories(ClassOrInterfaceDeclaration cid,
                                      String qualifiedName,
                                      List<BeanFactory> beanFactories) {
        for (MethodDeclaration method : cid.getMethods()) {
            if (hasAnnotation(method, "Bean")) {
                String returnType = method.getType().asString();
                try {
                    returnType = method.getType().resolve().describe();
                } catch (Exception e) {
                    // Use simple name
                }

                String qualifier = extractQualifierFromAnnotations(method.getAnnotations());
                String profile = extractProfileFromAnnotations(method.getAnnotations());
                int line = method.getBegin().map(p -> p.line).orElse(-1);

                beanFactories.add(new BeanFactory(
                        qualifiedName, method.getNameAsString(),
                        returnType, qualifier, profile, line));
                log.debug("Detected @Bean factory {}.{} returning {} (qualifier={}, profile={})",
                        qualifiedName, method.getNameAsString(), returnType, qualifier, profile);
            }
        }
    }

    // -----------------------------------------------------------------------
    //  Injection resolution (against symbol table)
    // -----------------------------------------------------------------------

    /**
     * Resolve injection points against the symbol table for a given snapshot.
     * Finds candidate implementations for injected types.
     *
     * @return Map of injection point index → list of candidate symbol IDs
     */
    public Map<Integer, List<ResolvedCandidate>> resolveInjections(
            String snapshotId,
            List<InjectionPoint> injectionPoints) {

        Map<Integer, List<ResolvedCandidate>> results = new LinkedHashMap<>();

        for (int i = 0; i < injectionPoints.size(); i++) {
            InjectionPoint ip = injectionPoints.get(i);
            List<ResolvedCandidate> candidates = findCandidates(snapshotId, ip);
            results.put(i, candidates);
        }

        return results;
    }

    public record ResolvedCandidate(
            String symbolId,
            String qualifiedName,
            String matchReason    // "implements_interface", "qualifier_match", "exact_type", "bean_factory"
    ) {}

    private List<ResolvedCandidate> findCandidates(String snapshotId, InjectionPoint ip) {
        List<ResolvedCandidate> candidates = new ArrayList<>();
        String targetType = ip.targetTypeName();

        // 1. Find exact type matches
        List<Map<String, Object>> exactMatches = jdbcTemplate.queryForList(
                "SELECT id, qualified_name FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?",
                snapshotId, targetType);

        // 2. Find by simple name if no exact match (when type wasn't fully resolved)
        if (exactMatches.isEmpty()) {
            String simpleName = targetType.contains(".")
                    ? targetType.substring(targetType.lastIndexOf('.') + 1)
                    : targetType;
            exactMatches = jdbcTemplate.queryForList(
                    "SELECT id, qualified_name FROM symbol_versions WHERE snapshot_id = ? AND simple_name = ? AND kind IN ('CLASS', 'INTERFACE')",
                    snapshotId, simpleName);
        }

        // 3. Check if the target is an interface → find all implementations
        for (Map<String, Object> match : exactMatches) {
            String matchId = (String) match.get("id");
            String matchKind = getSymbolKind(snapshotId, (String) match.get("qualified_name"));

            if ("INTERFACE".equals(matchKind)) {
                // Find all classes that implement this interface
                List<Map<String, Object>> implementors = jdbcTemplate.queryForList(
                        "SELECT sv.id, sv.qualified_name, sv.annotations, sv.spring_metadata " +
                                "FROM relationship_occurrences ro " +
                                "JOIN symbol_versions sv ON ro.source_symbol_id = sv.id " +
                                "WHERE ro.snapshot_id = ? AND ro.target_symbol_id = ? AND ro.kind = 'IMPLEMENTS'",
                        snapshotId, matchId);

                for (Map<String, Object> impl : implementors) {
                    String reason = "implements_interface";

                    // If qualifier specified, check for matching component name
                    if (ip.qualifierValue() != null) {
                        String annotations = (String) impl.get("annotations");
                        String springMeta = (String) impl.get("spring_metadata");
                        if (annotations != null && annotations.contains(ip.qualifierValue())) {
                            reason = "qualifier_match";
                        } else if (springMeta != null && springMeta.contains(ip.qualifierValue())) {
                            reason = "qualifier_match";
                        } else {
                            // Check if the class has a @Component("name") matching the qualifier
                            String roles = getSymbolRoles(snapshotId, (String) impl.get("qualified_name"));
                            if (roles != null && roles.contains(ip.qualifierValue())) {
                                reason = "qualifier_match";
                            } else {
                                reason = "implements_interface_no_qualifier_match";
                            }
                        }
                    }

                    candidates.add(new ResolvedCandidate(
                            (String) impl.get("id"),
                            (String) impl.get("qualified_name"),
                            reason));
                }
            } else {
                // Direct class match
                candidates.add(new ResolvedCandidate(matchId, (String) match.get("qualified_name"), "exact_type"));
            }
        }

        // 4. Check @Bean factories that return this type
        String targetSimple = targetType.contains(".") ? targetType.substring(targetType.lastIndexOf('.') + 1) : targetType;
        List<Map<String, Object>> beanFactories = jdbcTemplate.queryForList(
                "SELECT sv.id, sv.qualified_name, sv.annotations FROM symbol_versions sv " +
                        "WHERE sv.snapshot_id = ? AND sv.kind = 'METHOD' " +
                        "AND (sv.return_type = ? OR sv.return_type = ?) AND sv.annotations LIKE '%Bean%'",
                snapshotId, targetType, targetSimple);

        for (Map<String, Object> factory : beanFactories) {
            String reason = "bean_factory";
            if (ip.qualifierValue() != null) {
                String anns = (String) factory.get("annotations");
                if (anns != null && anns.contains(ip.qualifierValue())) {
                    reason = "qualifier_match";
                }
            }
            candidates.add(new ResolvedCandidate(
                    (String) factory.get("id"),
                    (String) factory.get("qualified_name"),
                    reason));
        }

        // 5. Apply qualifier filtering
        if (ip.qualifierValue() != null && candidates.size() > 1) {
            List<ResolvedCandidate> qualifierMatches = candidates.stream()
                    .filter(c -> "qualifier_match".equals(c.matchReason()))
                    .toList();
            if (!qualifierMatches.isEmpty()) {
                return qualifierMatches;  // Prefer qualifier matches
            }
        }

        return candidates;
    }

    // -----------------------------------------------------------------------
    //  Persistence: store Spring analysis results in the database
    // -----------------------------------------------------------------------

    /**
     * Persist Spring analysis results to the database for a snapshot.
     */
    public void persistResults(String snapshotId, String workspaceId, SpringAnalysisResult result) {
        persistRolesRoutesBeans(snapshotId, workspaceId, result);
        persistInjections(snapshotId, result);
    }

    /**
     * Persist Spring stereotypes, HTTP routes, and @Bean factory declarations.
     * This should be called for all files before resolving injection points.
     */
    public void persistRolesRoutesBeans(String snapshotId, String workspaceId, SpringAnalysisResult result) {
        // 1. Update symbol_versions with Spring roles
        for (SpringRole role : result.roles()) {
            String symbolId = getSymbolId(snapshotId, role.qualifiedClassName());
            if (symbolId != null) {
                // Get existing roles and merge
                String existingRoles = getSymbolRoles(snapshotId, role.qualifiedClassName());
                String rolesJson = mergeRoleJson(existingRoles, role.role());
                String componentName = role.componentName();

                // Build spring_metadata JSON
                String metadata = componentName != null
                        ? "{\"componentName\":\"" + componentName + "\"}"
                        : null;

                jdbcTemplate.update(
                        "UPDATE symbol_versions SET roles = ?, spring_metadata = COALESCE(spring_metadata, ?) WHERE id = ?",
                        rolesJson, metadata, symbolId);
            }
        }

        // 2. Insert HTTP routes
        for (HttpRoute route : result.routes()) {
            String symbolId = getMethodSymbolId(snapshotId, route.qualifiedClassName(), route.methodName());
            if (symbolId == null) {
                // Try class-level symbol
                symbolId = getSymbolId(snapshotId, route.qualifiedClassName());
            }

            jdbcTemplate.update(
                    "INSERT INTO http_routes (id, snapshot_id, symbol_version_id, http_method, path, consumes, produces) " +
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID().toString(), snapshotId, symbolId,
                    route.httpMethod(), route.path(), route.consumes(), route.produces());
        }

        // 4. Store @Bean factory methods as DECLARES_BEAN relationships
        for (BeanFactory bf : result.beanFactories()) {
            String configId = getSymbolId(snapshotId, bf.configClassQualifiedName());
            String methodId = getMethodSymbolId(snapshotId, bf.configClassQualifiedName(), bf.methodName());
            if (configId == null) continue;

            // Find the return type symbol
            String returnTypeId = findSymbolBySimpleName(snapshotId, bf.returnTypeName());

            if (returnTypeId != null) {
                String sourceId = methodId != null ? methodId : configId;
                try {
                    jdbcTemplate.update(
                            "INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, " +
                                    "kind, resolution, reason) VALUES (?, ?, ?, ?, 'DECLARES_BEAN', 'RESOLVED', ?)",
                            UUID.randomUUID().toString(), snapshotId, sourceId, returnTypeId,
                            bf.qualifierValue() != null ? "qualifier:" + bf.qualifierValue() : "factory_method");
                } catch (Exception e) {
                    log.debug("Skipped duplicate DECLARES_BEAN edge");
                }
            }
        }
    }

    /**
     * Resolve and persist injection points for a file.
     * Must be called AFTER persistRolesRoutesBeans has been called for all files.
     */
    public void persistInjections(String snapshotId, SpringAnalysisResult result) {
        // 3. Insert injection points
        for (InjectionPoint ip : result.injectionPoints()) {
            String sourceSymbolId = getSymbolId(snapshotId, ip.sourceClassQualifiedName());
            if (sourceSymbolId == null) continue;

            // Resolve candidates
            List<ResolvedCandidate> candidates = findCandidates(snapshotId, ip);
            String candidatesJson = buildCandidatesJson(candidates);
            String resolution = determineResolution(candidates, ip.qualifierValue());

            jdbcTemplate.update(
                    "INSERT INTO injection_points (id, snapshot_id, source_symbol_id, target_type_name, " +
                            "injection_kind, qualifier_value, resolved_candidates, resolution) " +
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID().toString(), snapshotId, sourceSymbolId,
                    ip.targetTypeName(), ip.injectionKind(), ip.qualifierValue(),
                    candidatesJson, resolution);

            // Also create INJECTS relationship edges
            for (ResolvedCandidate candidate : candidates) {
                String targetId = candidate.symbolId();
                try {
                    jdbcTemplate.update(
                            "INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, " +
                                    "kind, resolution, reason) VALUES (?, ?, ?, ?, 'INJECTS', ?, ?)",
                            UUID.randomUUID().toString(), snapshotId, sourceSymbolId, targetId,
                            resolution, candidate.matchReason());
                } catch (Exception e) {
                    log.debug("Skipped duplicate INJECTS edge: {} -> {}", sourceSymbolId, targetId);
                }
            }

            // If no candidates found, record an unresolved injection
            if (candidates.isEmpty()) {
                try {
                    jdbcTemplate.update(
                            "INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, unresolved_target, " +
                                    "kind, resolution, reason) VALUES (?, ?, ?, ?, 'INJECTS', 'UNRESOLVED', 'no_candidate_found')",
                            UUID.randomUUID().toString(), snapshotId, sourceSymbolId, ip.targetTypeName());
                } catch (Exception e) {
                    log.debug("Skipped duplicate INJECTS unresolved edge for: {}", ip.targetTypeName());
                }
            }
        }

        log.info("Persisted Spring analysis: {} roles, {} routes, {} injection points, {} bean factories",
                result.roles().size(), result.routes().size(),
                result.injectionPoints().size(), result.beanFactories().size());
    }

    // -----------------------------------------------------------------------
    //  Annotation extraction helpers
    // -----------------------------------------------------------------------

    private boolean hasAnnotation(com.github.javaparser.ast.nodeTypes.NodeWithAnnotations<?> node, String name) {
        return node.getAnnotations().stream()
                .anyMatch(a -> name.equals(a.getNameAsString()));
    }

    private String extractAnnotationValue(AnnotationExpr ann) {
        if (ann instanceof SingleMemberAnnotationExpr sma) {
            String val = sma.getMemberValue().toString();
            return unquote(val);
        }
        if (ann instanceof NormalAnnotationExpr nae) {
            for (MemberValuePair pair : nae.getPairs()) {
                if ("value".equals(pair.getNameAsString())) {
                    return unquote(pair.getValue().toString());
                }
            }
        }
        return null;
    }

    private String extractPathFromAnnotation(AnnotationExpr ann) {
        if (ann instanceof SingleMemberAnnotationExpr sma) {
            return unquote(sma.getMemberValue().toString());
        }
        if (ann instanceof NormalAnnotationExpr nae) {
            for (MemberValuePair pair : nae.getPairs()) {
                String name = pair.getNameAsString();
                if ("value".equals(name) || "path".equals(name)) {
                    return unquote(pair.getValue().toString());
                }
            }
        }
        return null;
    }

    private String extractNamedAttribute(AnnotationExpr ann, String attrName) {
        if (ann instanceof NormalAnnotationExpr nae) {
            for (MemberValuePair pair : nae.getPairs()) {
                if (attrName.equals(pair.getNameAsString())) {
                    return unquote(pair.getValue().toString());
                }
            }
        }
        return null;
    }

    private String extractQualifierFromAnnotations(
            com.github.javaparser.ast.NodeList<AnnotationExpr> annotations) {
        for (AnnotationExpr ann : annotations) {
            if ("Qualifier".equals(ann.getNameAsString())) {
                return extractAnnotationValue(ann);
            }
        }
        return null;
    }

    private String extractProfileFromAnnotations(
            com.github.javaparser.ast.NodeList<AnnotationExpr> annotations) {
        for (AnnotationExpr ann : annotations) {
            if ("Profile".equals(ann.getNameAsString())) {
                return extractAnnotationValue(ann);
            }
        }
        return null;
    }

    // -----------------------------------------------------------------------
    //  DB helper methods
    // -----------------------------------------------------------------------

    private String getSymbolId(String snapshotId, String qualifiedName) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? LIMIT 1",
                    String.class, snapshotId, qualifiedName);
        } catch (Exception e) {
            return null;
        }
    }

    private String getMethodSymbolId(String snapshotId, String classQName, String methodName) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? AND kind = 'METHOD' LIMIT 1",
                    String.class, snapshotId, classQName + "." + methodName);
        } catch (Exception e) {
            return null;
        }
    }

    private String findSymbolBySimpleName(String snapshotId, String name) {
        String simpleName = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : name;
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND simple_name = ? AND kind IN ('CLASS', 'INTERFACE') LIMIT 1",
                    String.class, snapshotId, simpleName);
        } catch (Exception e) {
            return null;
        }
    }

    private String getSymbolKind(String snapshotId, String qualifiedName) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT kind FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? LIMIT 1",
                    String.class, snapshotId, qualifiedName);
        } catch (Exception e) {
            return null;
        }
    }

    private String getSymbolRoles(String snapshotId, String qualifiedName) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT roles FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? LIMIT 1",
                    String.class, snapshotId, qualifiedName);
        } catch (Exception e) {
            return null;
        }
    }

    // -----------------------------------------------------------------------
    //  Utility
    // -----------------------------------------------------------------------

    private String unquote(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private String combinePaths(String classPath, String methodPath) {
        if (classPath == null) classPath = "";
        if (methodPath == null) methodPath = "";

        // Normalize
        classPath = classPath.isEmpty() ? "" : classPath;
        methodPath = methodPath.isEmpty() ? "" : methodPath;

        if (classPath.isEmpty()) return methodPath.isEmpty() ? "/" : methodPath;
        if (methodPath.isEmpty()) return classPath;

        // Combine with proper slash handling
        String combined = classPath;
        if (!combined.endsWith("/") && !methodPath.startsWith("/")) {
            combined += "/";
        } else if (combined.endsWith("/") && methodPath.startsWith("/")) {
            combined = combined.substring(0, combined.length() - 1);
        }
        return combined + methodPath;
    }

    private String mergeRoleJson(String existingRoles, String newRole) {
        if (existingRoles == null || existingRoles.isBlank() || "null".equals(existingRoles)) {
            return "[\"" + newRole + "\"]";
        }
        // Simple JSON array merge
        if (existingRoles.contains(newRole)) {
            return existingRoles;
        }
        return existingRoles.substring(0, existingRoles.length() - 1) + ",\"" + newRole + "\"]";
    }

    private String buildCandidatesJson(List<ResolvedCandidate> candidates) {
        if (candidates.isEmpty()) return "[]";
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < candidates.size(); i++) {
            if (i > 0) sb.append(",");
            ResolvedCandidate c = candidates.get(i);
            sb.append("{\"symbolId\":\"").append(c.symbolId())
                    .append("\",\"qualifiedName\":\"").append(c.qualifiedName())
                    .append("\",\"matchReason\":\"").append(c.matchReason())
                    .append("\"}");
        }
        sb.append("]");
        return sb.toString();
    }

    private String determineResolution(List<ResolvedCandidate> candidates, String qualifier) {
        if (candidates.isEmpty()) return "UNRESOLVED";
        if (candidates.size() == 1) return "RESOLVED";
        if (qualifier != null) {
            long qualifierMatches = candidates.stream()
                    .filter(c -> "qualifier_match".equals(c.matchReason()))
                    .count();
            if (qualifierMatches == 1) return "RESOLVED";
        }
        return "CANDIDATE";  // Multiple candidates, ambiguous
    }
}
