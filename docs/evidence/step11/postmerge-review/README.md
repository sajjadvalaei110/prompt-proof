# Post-merge review remediation — 2026-09-30

Review input: `/tmp/POST_MERGE_REVIEW_FINDINGS_2026-09-30.md`, reviewing merge
`14967bf88e4e897a8e8ecb7c596de67e484638aa`. The reviewer found no confirmed
introduced implementation defect. This follow-up corrects the current integration
report and closes the environment-blocked canonical verification gate, with an
independent parent review of the edits and packaged browser evidence.

Bounded acceptance criterion: correct the 13-versus-12 current Node suite claim,
record the four concrete second-language readiness limits, and run the canonical
Java-only integration gates in a socket-capable environment. No product source,
schema or frozen ADR changes were needed. `docs/BUILD_BRIEF.md` is absent in this
checkout; the actual frozen brief is `docs/BUILD.md` and was read without edits.

## Review dispositions

| Review issue or limitation | Disposition |
| --- | --- |
| Integration claims 13 Node suites; actual tree has 12 | Corrected `PROJECT_STATUS.md` and integration README; fresh fail-fast run enumerates all 12 in [the manifest](node-suite-manifest.txt) and [results](node-results.txt). Historical counts tied to older trees remain historical. |
| Git capture accepts only `.java` | Documented the existing `javaPath()` capture boundary and required future source/manifest policy or unsupported-review gate in Architecture. Deferred to the second-language milestone; Java behavior unchanged. |
| Top-level functions lack package-child graph/UI representation | Documented current package → type → member contract and required real representation/navigation/explanation decisions. No fabricated classes or speculative graph redesign. |
| Adapter discovery, native SDK errors and network isolation unverified | Documented custom discovery responsibility and deferred Go/Dart SDK/network gates. Registration alone is insufficient. |
| Fake non-Java tests establish dispatch only | Documented that real non-Java resolution, review capture and graph/UI fixtures remain required before shipping another adapter. |
| Canonical Gradle blocked by review sandbox | Fresh canonical command and parsed XML results recorded below; review's supplemental direct runner remains historical evidence, not a substitute for this gate. |
| Three ModelClientService HTTP tests blocked by socket sandbox | Fresh canonical XML inspection recorded below for all three named tests; these exercise loopback test servers, not a live model endpoint. |
| Fresh import/Ungroup browser uncertain | PASS: parent independently ran both packaged pipelines after packaging; import and 33/33 Ungroup checks passed, with all 15 screenshots inspected. |
| Original review findings 1–10 | Review already confirmed fixed/removed/addressed: loopback helper, FAILED-write propagation, early language rejection, mock regex, durable evidence, dispatch coverage, dead shims, shared language definitions, registry lookup and ignored caches. No introduced regression or new production edit required. |
| Appended second-review findings | Review confirmed compilation import, private DB, optional framework hook, discovery wrapper removal, shared normalization/repository lookup, dead language fallback/shim removal, shared helpers and status text addressed. The remaining evidence-count discrepancy is corrected here. |
| Merge preservation | Review found parser/Spring facts, source-root parity, OVERRIDES linking and explorer state preserved; fresh canonical, pure-logic and parent browser gates add current evidence. |
| Other legacy browser pipelines, full security audit and live model | Other browser/HTTP pipelines were not rerun because no affected product code changed; some older UI harnesses need current selectors. No comprehensive security audit or live-model result is claimed. |

## Fresh commands and evidence

Run from `/home/sajjad/projects/second-review-assist/review-assist`:

```sh
mkdir -p build/postmerge-review/test-data build/postmerge-review/logs
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  CODEATLAS_DATA_DIR=/home/sajjad/projects/second-review-assist/review-assist/build/postmerge-review/test-data \
  ./gradlew test constrainedMemoryTest bootJar --no-daemon \
  > build/postmerge-review/logs/gradle.log 2>&1

cd frontend && npx tsc -b --force && npm run build \
  > ../build/postmerge-review/logs/frontend.log 2>&1
```

Frontend: PASS, exit 0. Existing bundle-size advisory (>500 kB) remains. The forced
TypeScript check succeeded; canonical packaging also runs its normal frontend build.

Node invocation (exit 0, 12 suites PASS):

```python
from pathlib import Path
import subprocess, sys
paths = sorted(Path('scripts').glob('test-*.mjs'))
Path('build/postmerge-review/node-suite-manifest.txt').write_text(
    '\n'.join(str(p) for p in paths) + '\n')
with Path('build/postmerge-review/logs/node.log').open('w') as log:
    for p in paths:
        log.write(f'RUN {p}\n'); log.flush()
        r = subprocess.run(['node', str(p)], stdout=log,
                           stderr=subprocess.STDOUT)
        log.write(f'EXIT {r.returncode}: {p}\n'); log.flush()
        if r.returncode: sys.exit(r.returncode)
    log.write(f'PASS {len(paths)} suites\n')
print(f'PASS {len(paths)} suites')
```

The data directory is absolute and ignored under `build/`; generated databases and
raw Gradle/application logs remain outside tracked evidence. Durable test summaries
contain counts/statuses rather than private source, credentials or provider prompts.

Canonical Gradle: **PASS, exit 0**, `BUILD SUCCESSFUL in 2m 44s`; nine actionable
tasks, eight executed and one up-to-date. Parsed ordinary test XML: **166 tests in
28 suites, zero failures/errors/skips**. Constrained-memory XML is fresh from this
run: **one test PASS, zero failures/errors/skips**, 136.17 seconds, 256 MiB maximum
heap, sampled peak used heap 71,508,968 bytes. Maximum query rows 128, retained
symbols/batch 16, simultaneous requests 1, prompt bytes 16,788 and response bytes
1,517. Durable parsed counts, UTC suite timestamps and metrics are in
[test-summary.json](test-summary.json); raw XML remains under
`build/test-results/{test,constrainedMemoryTest}/`.

`ModelClientServiceTest` has **8/8 PASS**. XML explicitly confirms that the three
review-blocked cases now pass:

- `oversizedProviderResponseIsStoppedAtTheByteLimit()`
- `contextRejectionDoesNotReplayIdenticalInputWithoutResponseFormat()`
- `truncatedJsonIsRejectedBeforeItCanBeMistakenForACompleteAnswer()`

The executable JAR is `build/libs/code-atlas-0.1.0-SNAPSHOT.jar`. Packaging finished
before the parent started fixture/browser servers; it will not be rebuilt during
those browser runs. No fresh command failed in this subagent validation. The
review's earlier sandbox/cache/SLF4J failures remain honestly described in its
original report and are not product failures from this rerun. No live model was
contacted.

## Parent quality verification

```sh
JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 \
  python3 scripts/verify_language_import_pipeline.py \
  > build/postmerge-review/logs/import.log 2>&1

JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java \
  PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH PYTHONDONTWRITEBYTECODE=1 \
  python3 scripts/verify_ungroup_pipeline.py \
  > build/postmerge-review/logs/ungroup.log 2>&1
```

Both commands: **PASS, exit 0**. Import confirms the Java-only labelled selector,
desktop/mobile fit, real Java form submissions, offline graph browsing, reanalysis
and recent-workspace loading without a snapshot; no page errors. See
[import-report.json](import/import-report.json) and its three screenshots.
Ungroup: **33/33 PASS**, including hidden container hit-testing, nearest-parent
collapse, undo/redo, Changes, tree reveal and method deep links; no page or console
errors. See [report.json](ungroup/report.json) and its twelve screenshots.

The parent visually inspected all 15 fresh screenshots, with full-size inspection
of import layouts, freed methods and deep-link navigation. Fixtures were copied,
servers/databases isolated, and the model endpoint unavailable. Ungroup fixture
hashes remained unchanged. The real `data/` file inventory and SHA-256 hashes also
match the pre-run baseline; private hash values remain in ignored build output.

The parent independently reviewed all documentation edits, parsed canonical test
XML and checked the 12-suite manifest against the tree. `git diff --check` and
`git diff --exit-code -- src frontend scripts`: **PASS**. No production code,
frozen brief or ADR changed. Remediation contains only documentation and durable
verification evidence.

Other browser/HTTP pipelines were not rerun because no
affected product code changed; some older UI harnesses need current selectors.
No exhaustive security audit or shipped Go/Dart capability is claimed.
