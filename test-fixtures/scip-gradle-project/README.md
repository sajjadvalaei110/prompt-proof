# scip-gradle-project

Compiling two-module Gradle fixture for the scip-java indexer (ADR 0012). It has no external
dependencies, so the build needs nothing beyond a Gradle distribution. It covers inheritance
(`extends`/`implements`), constructor calls, cross-module method calls, field access, an overloaded
method, `super(..)`, and locals/parameters that exist only in the occurrence index.

Tests use it two ways:

- `ScipJavaAnalysisIntegrationTest` analyzes the fixture (and its `app/` module as a workspace)
  from the committed golden index `src/test/resources/scip/scip-gradle-project.scip`;
- `ScipJavaLiveIndexingTest` runs the real scip-java + Gradle on it (skipped when scip-java is
  not installed) and checks the fixture is byte-identical afterwards.

Regenerate the golden index after changing the fixture (needs `./gradlew installScipJava` and a
`gradle` on PATH; this fixture has no wrapper). Run it in a copy so no `build/` lands here:

```bash
rm -rf /tmp/scip-fixture && cp -r test-fixtures/scip-gradle-project /tmp/scip-fixture
(cd /tmp/scip-fixture && java -cp "$OLDPWD/data/tools/scip-java/lib/*" com.sourcegraph.scip_java.ScipJava \
  index --build-tool gradle --output "$OLDPWD/src/test/resources/scip/scip-gradle-project.scip" \
  -- --offline clean scipPrintDependencies scipCompileAll)
```
