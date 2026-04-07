# Contributing

Thanks for contributing to Bad Choices.

## Before you start

- Open an issue before making a substantial feature, architecture, or content change.
- Branch from `main`.
- Keep pull requests focused. Smaller, reviewable changes are preferred.

## Development expectations

- Add or update tests when behavior changes.
- Keep gameplay and product impact clear in your PR description.
- If you change scenario flow, packs, or game logic, include the player-facing effect in plain language.

## Validation

Run the relevant checks before opening a pull request:

```bash
npm run lint
npm run test:regressions
npm run test:packs
npm run build
```

If you have local Supabase configured for browser coverage, also run:

```bash
npm run test:e2e:smoke
```

## Commits and pull requests

- Use clear commit messages.
- Describe what changed, why it changed, and any follow-up work or known limitations.
- If your change affects setup, docs, or contributor workflow, update the relevant documentation in the same PR.

## Licensing

By submitting code to this repository, you agree that your code contribution is provided under the MIT License in [`LICENSE`](/Users/adreanpalafox/Developer/bad_choices/LICENSE).

Code contributions are welcome under MIT. Brand assets, image assets, and authored scenario content remain subject to the reserved-rights policy in [`ASSETS.md`](/Users/adreanpalafox/Developer/bad_choices/ASSETS.md).

