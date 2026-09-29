# Current selection dashes and margins (2026-09-24)

- [Ordinary selection](selected-dashes.png): moving gray dashes with thin indigo
  incoming and cyan outgoing margins, and retained resource halos.
- [Changes selection](changes-dashes.png): factual route colors remain distinct
  from the indigo incoming margins.
- [Ordinary browser report](dashes-report.json) and
  [Changes browser report](changes-dashes-report.json): both pass with zero page
  errors; Changes has 40/40 checks. Fixtures remain unchanged and no model is used.

Screenshots inspected from `build/change-edges/run-hsr6mopc` and
`build/git-review/run-_1vpq26m`. Native dash-offset changes, margin color assertions
and deselection cleanup are covered by the browser checks. Thin margins are less
prominent at small zoom. The earlier arrowhead screenshots below are historical.

# Step 1 selection halo and change colors

These screenshots come from the packaged Java application in Chromium, with a
copied source fixture and an unreachable model endpoint. They were visually
inspected after the browser assertions passed.

- `incoming-halo.png`: selecting `Dep` gives related `Hub` an indigo halo.
- `outgoing-halo.png`: selecting `Caller` gives related `Hub` a cyan halo;
  adaptive arrowheads run toward the target on the lighter gray routes.
- `split-halo.png`: selecting `Peer` gives related `Hub` one hard-split ring,
  indigo left and cyan right.
- `changes-colors.png`: Changes mode displays added green, removed red and
  modified yellow resource cards with a selection active. Route colors remain
  tied to change state.

Sources: `build/change-edges/run-c10q4let` and
`build/git-review/run-ddy2cjdp`. Both browser runs reported zero page errors,
no model requests, and unchanged fixture source bytes.
