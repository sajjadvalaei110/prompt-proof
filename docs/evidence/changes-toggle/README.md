# Changes toggle layout evidence

Step zero of the Step 10 backlog: one arrangement across ordinary and Changes modes.

The packaged application is exercised in Chromium against an isolated, synthetic
Java/Git fixture and the real parser and review API. `report.json` records numeric
geometry, expansion ancestry, selection and camera comparisons. The screenshots
show ordinary mode, first Changes activation, ordinary source inspection after
turning Changes off, and restoration of the first tab. The intentionally zoomed
map extends beyond the viewport; numeric assertions cover cards outside the crop.

Run from the repository root:

```sh
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar
JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py
```

The pipeline also checks unchanged fixture source and Git index hashes and zero
requests to a rejecting local model endpoint. This verifies operation without a
model, not live model integration. See [PROJECT_STATUS.md](../../../PROJECT_STATUS.md) for final outcomes and
remaining limits.

Final combined Step Zero/Step One remediation run: `build/git-review/run-ddy2cjdp`
— 39/39 checks, zero page errors,
zero model requests; all four screenshots inspected. Source SHA-256:
`ff76dcffe6570e4cc4b4acebe146f0c427116d57866cb613af76fa04e0043596`;
Git index SHA-256:
`8f58d29e303e6ba2bd1b6e2228e2c8f2fca9abc4739f20e29a32988b18e50536`.
Both were unchanged across the run.
