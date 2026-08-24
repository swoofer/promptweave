# Contributing to promptweave

Thanks for considering a contribution.

## Reporting bugs

Open an issue with the "bug" template. Include the version (`promptweave --version`) and a minimal reproduction.

## Suggesting features

Open an issue with the "feature" template. Explain the use case before proposing implementation.

## Pull requests

1. Fork the repo and create a branch off `main`.
2. Run `pnpm install` then `pnpm test` to confirm baseline passes.
3. Add tests for any new behavior. We use Vitest.
4. Keep commits scoped and follow [Conventional Commits](https://www.conventionalcommits.org/).
5. Open a PR against `main`. CI must pass before review.

## Development

- `pnpm install`
- `pnpm test` — run the full vitest suite.
- `pnpm build` — run TypeScript in `--noEmit` mode.
- `pnpm cli -- build raid --dry-run` — exercise the CLI end-to-end against bundled defaults.

## Architecture

See `README.md` for the high-level model. The engine is in `src/`, the CLI in `cli/`, and bundled YAML defaults are at the repo root in `behaviors/`, `presets/`, `compositions/`.
