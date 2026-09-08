package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Spring annotation detection in {@link SpringAnnotationAnalyzer}.
 *
 * Uses the R3 test fixture at test-fixtures/spring-project/ to verify
 * detection of stereotypes, HTTP routes, injection points, and bean factories.
 *
 * Note: These tests invoke only the pure analysis logic (no DB).
 * The analyze() method works purely from the AST without database access.
 */
class SpringAnnotationAnalyzerTest {

    private SpringAnnotationAnalyzer analyzer;

    @BeforeEach
    void setUp() {
        // Pass null JdbcTemplate since analyze() doesn't use DB
        analyzer = new SpringAnnotationAnalyzer(null);
    }

    // -----------------------------------------------------------------------
    //  Stereotype detection
    // -----------------------------------------------------------------------

    @Test
    void detectsRestControllerStereotype() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertFalse(result.roles().isEmpty(), "Should detect Spring stereotypes");
        assertTrue(result.roles().stream()
                        .anyMatch(r -> "REST_CONTROLLER".equals(r.role())
                                && r.qualifiedClassName().contains("UserController")),
                "Should detect @RestController on UserController");
    }

    @Test
    void detectsServiceStereotype() throws Exception {
        CompilationUnit cu = parseFixture("service/OrderService.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.roles().stream()
                        .anyMatch(r -> "SERVICE".equals(r.role())
                                && r.qualifiedClassName().contains("OrderService")),
                "Should detect @Service on OrderService");
    }

    @Test
    void detectsRepositoryStereotype() throws Exception {
        CompilationUnit cu = parseFixture("repository/UserRepositoryImpl.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.roles().stream()
                        .anyMatch(r -> "REPOSITORY".equals(r.role())),
                "Should detect @Repository on UserRepositoryImpl");
    }

    @Test
    void detectsComponentWithName() throws Exception {
        CompilationUnit cu = parseFixture("service/CreditCardPaymentService.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.roles().stream()
                        .anyMatch(r -> "COMPONENT".equals(r.role())
                                && "primaryPayment".equals(r.componentName())),
                "Should detect @Component(\"primaryPayment\") with its name");
    }

    @Test
    void detectsConfigurationStereotype() throws Exception {
        CompilationUnit cu = parseFixture("config/AppConfig.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.roles().stream()
                        .anyMatch(r -> "CONFIGURATION".equals(r.role())),
                "Should detect @Configuration on AppConfig");
    }

    // -----------------------------------------------------------------------
    //  HTTP route detection
    // -----------------------------------------------------------------------

    @Test
    void detectsGetMapping() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertFalse(result.routes().isEmpty(), "Should detect HTTP routes");
        assertTrue(result.routes().stream()
                        .anyMatch(r -> "GET".equals(r.httpMethod())
                                && r.path().contains("/api/users")),
                "Should detect GET /api/users");
    }

    @Test
    void detectsPostMapping() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.routes().stream()
                        .anyMatch(r -> "POST".equals(r.httpMethod())
                                && r.path().contains("/api/users")),
                "Should detect POST /api/users");
    }

    @Test
    void detectsPutMapping() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.routes().stream()
                        .anyMatch(r -> "PUT".equals(r.httpMethod())
                                && r.path().contains("/api/users")),
                "Should detect PUT /api/users/{id}");
    }

    @Test
    void detectsDeleteMapping() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.routes().stream()
                        .anyMatch(r -> "DELETE".equals(r.httpMethod())
                                && r.path().contains("/api/users")),
                "Should detect DELETE /api/users/{id}");
    }

    @Test
    void combinesClassAndMethodPaths() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        // UserController has @RequestMapping("/api/users") and @GetMapping("/{id}")
        assertTrue(result.routes().stream()
                        .anyMatch(r -> r.path().contains("/api/users") && r.path().contains("{id}")),
                "Should combine class-level and method-level paths");
    }

    @Test
    void detectsMultipleRoutesOnOneController() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        long routeCount = result.routes().size();
        assertTrue(routeCount >= 5,
                "UserController should have at least 5 routes (GET, GET/{id}, POST, PUT/{id}, DELETE/{id}), got " + routeCount);
    }

    // -----------------------------------------------------------------------
    //  Injection point detection
    // -----------------------------------------------------------------------

    @Test
    void detectsConstructorInjection() throws Exception {
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.injectionPoints().stream()
                        .anyMatch(ip -> "CONSTRUCTOR".equals(ip.injectionKind())
                                && ip.targetTypeName().contains("UserService")),
                "Should detect constructor injection of UserService into UserController");
    }

    @Test
    void detectsFieldInjectionWithQualifier() throws Exception {
        CompilationUnit cu = parseFixture("service/OrderService.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.injectionPoints().stream()
                        .anyMatch(ip -> "FIELD".equals(ip.injectionKind())
                                && ip.targetTypeName().contains("PaymentService")
                                && "primaryPayment".equals(ip.qualifierValue())),
                "Should detect @Autowired @Qualifier(\"primaryPayment\") PaymentService field injection");
    }

    @Test
    void detectsConstructorInjectionWithoutExplicitAutowired() throws Exception {
        // UserController has a single constructor — Spring auto-wires it implicitly
        CompilationUnit cu = parseFixture("controller/UserController.java");
        var result = analyzer.analyze(cu);

        assertFalse(result.injectionPoints().isEmpty(),
                "Single constructor should be detected as an injection point even without @Autowired");
    }

    // -----------------------------------------------------------------------
    //  @Bean factory detection
    // -----------------------------------------------------------------------

    @Test
    void detectsBeanFactory() throws Exception {
        CompilationUnit cu = parseFixture("config/AppConfig.java");
        var result = analyzer.analyze(cu);

        assertFalse(result.beanFactories().isEmpty(),
                "Should detect @Bean factory methods in @Configuration class");
        assertTrue(result.beanFactories().stream()
                        .anyMatch(bf -> bf.returnTypeName().contains("EmailSender")),
                "Should detect @Bean method returning EmailSender");
    }

    // -----------------------------------------------------------------------
    //  Integration: no Spring annotations
    // -----------------------------------------------------------------------

    @Test
    void returnsEmptyForPlainClass() throws Exception {
        CompilationUnit cu = parseFixture("model/User.java");
        var result = analyzer.analyze(cu);

        assertTrue(result.roles().isEmpty(), "Plain POJO should have no Spring roles");
        assertTrue(result.routes().isEmpty(), "Plain POJO should have no HTTP routes");
        assertTrue(result.injectionPoints().isEmpty(), "Plain POJO should have no injection points");
        assertTrue(result.beanFactories().isEmpty(), "Plain POJO should have no bean factories");
        assertTrue(result.isEmpty(), "Result should report as empty for plain POJO");
    }

    // -----------------------------------------------------------------------
    //  Full fixture analysis
    // -----------------------------------------------------------------------

    @Test
    void analyzesEntireSpringFixture() throws Exception {
        Path fixtureRoot = Path.of("test-fixtures/spring-project/src/main/java");
        if (!Files.exists(fixtureRoot)) {
            return; // Skip if fixture not available
        }

        int totalRoles = 0;
        int totalRoutes = 0;
        int totalInjections = 0;
        int totalBeanFactories = 0;

        List<Path> javaFiles;
        try (var stream = Files.walk(fixtureRoot)) {
            javaFiles = stream.filter(p -> p.toString().endsWith(".java")).toList();
        }

        for (Path file : javaFiles) {
            CompilationUnit cu = StaticJavaParser.parse(file);
            var result = analyzer.analyze(cu);
            totalRoles += result.roles().size();
            totalRoutes += result.routes().size();
            totalInjections += result.injectionPoints().size();
            totalBeanFactories += result.beanFactories().size();
        }

        // Verify minimum expected counts from the fixture
        assertTrue(totalRoles >= 7,
                "Should find at least 7 Spring stereotypes (2 controllers, 3 services, 2 repos, 1 config...), got " + totalRoles);
        assertTrue(totalRoutes >= 7,
                "Should find at least 7 HTTP routes (5 on UserController, 2 on OrderController), got " + totalRoutes);
        assertTrue(totalInjections >= 4,
                "Should find at least 4 injection points, got " + totalInjections);
        assertTrue(totalBeanFactories >= 1,
                "Should find at least 1 @Bean factory, got " + totalBeanFactories);

        System.out.printf("Spring fixture analysis: %d roles, %d routes, %d injections, %d bean factories%n",
                totalRoles, totalRoutes, totalInjections, totalBeanFactories);
    }

    // -----------------------------------------------------------------------
    //  Test helpers
    // -----------------------------------------------------------------------

    private CompilationUnit parseFixture(String relativePath) throws Exception {
        Path file = Path.of("test-fixtures/spring-project/src/main/java/com/example/spring", relativePath);
        if (!Files.exists(file)) {
            fail("Fixture file not found: " + file);
        }
        return StaticJavaParser.parse(file);
    }
}
