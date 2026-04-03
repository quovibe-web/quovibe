# Contributing to quovibe

## Git Flow

### Branch model

| Branch      | Purpose                        | Merge strategy                        |
|-------------|--------------------------------|---------------------------------------|
| `main`      | Public, stable, released       | **Squash merge** from `development`   |
| `development` | Integration and testing      | Regular merge (`--no-ff`) from feature/fix branches |

### Temporary branches

| Prefix           | From          | Merge into    | Purpose              |
|------------------|---------------|---------------|----------------------|
| `feature/<name>` | `development` | `development` | New feature          |
| `fix/<name>`     | `development` | `development` | Bug fix              |
| `hotfix/<name>`  | `main`        | `main` + `development` | Critical production fix |

### Daily workflow

```bash
# 1. Create a branch from development
git checkout development
git checkout -b feature/my-feature

# 2. Develop and commit freely
git commit -m "feat: description"

# 3. Merge back into development
git checkout development
git merge --no-ff feature/my-feature
git branch -d feature/my-feature

# 4. Release — squash merge into main
git checkout main
git merge --squash development
git commit -m "feat: short description"
git tag v1.1.0
git push origin main --tags
```

### Rules

- Never commit directly to `main` or `development`
- Squash merge to `main` keeps the public history clean and readable
- Version tags follow [semver](https://semver.org/) and trigger the Docker image build via GitHub Actions

---

## Commit messages

Format: `<type>: <short description>`

| Type       | When                                        |
|------------|---------------------------------------------|
| `feat`     | New feature                                 |
| `fix`      | Bug fix                                     |
| `chore`    | Maintenance (build, deps, config)           |
| `docs`     | Documentation only                          |
| `test`     | Adding or modifying tests                   |
| `refactor` | Refactoring without functional change       |

---

## Local setup

See [README.md](README.md#getting-started).

---

## Code quality

| Command               | When to use                                              |
|-----------------------|----------------------------------------------------------|
| `pnpm build`          | Always — typechecks all packages                         |
| `pnpm test`           | Always                                                   |
| `pnpm lint`           | Always                                                   |
| `pnpm lint:engine`    | After touching `packages/engine/`                        |
| `pnpm check:governance` | After changing engine, services, routes, or docs       |
| `pnpm check:arch`     | After adding dependencies or cross-package imports       |
| `pnpm preflight`      | Before starting a development session                    |
| `pnpm postflight`     | After finishing a development session                    |
| `pnpm ci`             | Full pipeline — mirrors what GitHub Actions runs         |

### Financial logic rules

- Use `decimal.js` for **all** calculations — never native floats for money or percentages
- The engine (`packages/engine`) must have **zero I/O** — it receives data and returns results only
- Every public engine function must have tests with **concrete numeric values**
- Financial formulas follow standard definitions (TTWROR, IRR, FIFO, Moving Average)

---

## Automated governance

`pnpm check:governance` and `pnpm check:arch` enforce 23 rules covering engine I/O isolation, dependency boundaries, DDL consistency, sign conventions, Zod-Drizzle parity, and more.

CI fails if any rule is violated or if the test count drops below the enforced minimum.

Full rule documentation is in [`CLAUDE.md`](CLAUDE.md) and the [`.claude/rules/`](.claude/rules/) files.
