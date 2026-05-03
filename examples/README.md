# Examples

This directory holds small examples that demonstrate the engine. The bundled defaults at the package root (`behaviors/`, `presets/`) are deliberately minimal — promptweave is an engine, not an opinionated catalog.

## Building your own catalog

1. Create a directory in your project, e.g. `my-prompts/`, with subdirs `behaviors/`, `presets/`, `compositions/`.
2. Copy or write your own behaviors into `my-prompts/behaviors/*.yaml`.
3. Compose them into presets in `my-prompts/presets/*.yaml`.
4. Preview: `promptweave build <preset> --root ./my-prompts --dry-run`.
5. Write: `promptweave build <preset> --root ./my-prompts`.

## Real-world catalogs

For a production-scale coordinator-aware catalog (announce-before-write, conflict-resolution, work-stealing phases, etc.), see [mcp-coordinator](https://github.com/swoofer/mcp-coordinator). It ships behaviors and presets for the multi-agent coordination scenario alongside the MCP server itself.
