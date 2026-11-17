# Changelog

All notable changes to Code Atlas will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and released versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Explore Java and Spring code through interactive package, class, and method maps with source-backed relationships and explicit resolution states.
- Narrow the map with hierarchical package and class scopes; expand and resize cards, arrange focused journeys, and ungroup expanded containers.
- Work in independent exploration tabs with per-tab undo/redo, card menus, kind icons, and incoming or outgoing relation stacks.
- Inspect full source files with evidence highlighting, in-file search, and Ctrl/Cmd+click go to definition when the selected indexer supports navigation.
- Review local Git changes directly on the code map, including changed resources and relationships, line counts, and unified or side-by-side diffs.
- Design packages, resources, members, and relations separately from parsed facts; record intent and explanations, exchange design briefs, and prepare outstanding work for coding agents.
- Generate source-grounded explanations and bounded Explain All summaries through a configured OpenAI-compatible model endpoint, with graph browsing available without a model.
- Choose source-only JavaParser analysis by default or opt into scip-java for compiler-backed indexing and navigation with explicit target-build consent.

### Changed

- Center exploration on package-owned cards while preserving map geometry, selection, and per-tab history across exploration, Changes, and Design modes.
- Keep candidate, unresolved, unknown, designed, and stale information visibly distinct instead of presenting it as settled parser fact.

### Fixed

- Open relationship evidence in the full source file rather than an isolated snippet.
- Restore source-navigation scroll positions correctly and isolate cached source by snapshot to prevent stale content after a snapshot change.
- Match Git-review source roots to the original workspace layout so captured analysis retains the same source-resolution context.
- Keep designed-card placement and collapsed-container geometry consistent when toggling Design mode.
