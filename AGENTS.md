# AGENTS.md

This file provides guidance to Claude (claude.com/claude-code) and Codex (openai.com/codex) when working with code in this repository.

## Overview

`See @README.md for an overview of the product.`

## Key Commands

### Code Quality

```bash
# Linting
pnpm lint
pnpm lint:fix

# Format code
pnpm format

# Type checking
pnpm typecheck
```

### Development

```bash
# Run the app locally (hot-reload, no build step)
pnpm dev

# Run the app from the production build
pnpm start
```

### Build

```bash
# Build the production build
pnpm build
```

### Testing

```bash
# Full project - slower, use only when needed
pnpm test

# Run unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration
```

## Database

When a schema change is required, you'll perfom the following steps:

1. Edit the `./src/db/schema.ts` file with the new changes.
2. Run `pnpm db:generate` to generate the SQL migration files under `./src/db/migrations`.
3. Finally, run `pnpm db:migrate` to apply any pending migrations to the local database.

For `production`, migrations must be applied manually from the generated SQL files. **Do not ever apply a migration directly to a production database**.

## Architecture Overview

### Key Development Principles

- Prefer `const`; use `let` only when reassignment is exceptionally required.
- Use **named exports only**, instead of **default exports**.
- Use **type** for declaring most of the types, and **interface** only when a **type** doesn't have a place.
- Use **string literal** over **enum**.
- Prefer **composition** over **inheritance**.
- Keep API endpoints thin; do not put business or domain logic there.
- Use early returns and guard clauses; do not use `else-if`.
- Don't throw exception unless it's exceptionally required. Prefer returning errors as values for 99% of the cases.
- In classes, private methods must be declared after the public API methods have been declared.

### Naming Conventions

- **Variables/functions**: camelCase.
- **Constants**: SCREAMING_SNAKE_CASE.
- **Types/Classes**: PascalCase.
- **Files/directories**: kebab-case with descriptive suffixes (`.domain.ts`, `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`).
- **TypeScript generics**: descriptive names (`TData` not `T`).
- **TypeScript array annotation**: use **Array<T>** instead of **T[]**.
- No **abbreviations** in variable or function names. For instance `user` over `u`, `fieldMetadata` over `fm`.

### Comments

- Use short-form comments (`//`), not JSDoc blocks.
- Explain why (business logic), not what.
- Do not comment obvious code.
- Multi-line comments use multiple `//` lines, not `/** */`.

### Git

- Use Conventional Commits for commit messages.
- Do not push, rewrite history, delete branches, or discard working-tree changes without explicit user approval.

## Behavioral Guidelines

### Planning

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a fact can be found by exploring the codebase, look it up rather than asking me. The decisions, though, are mine — put each one to me and wait for my answer.

Do not enact the plan until I confirm we have reached a shared understanding.

### Surgical Changes

Touch only what you must. Clean up only your own mess. When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.

## OpenAPI Synchronization

Whenever a public API contract changes, update openapi.json in the same change to keep the implementation and specification in sync.

This includes changes to endpoints, parameters, request/response schemas, status codes, enums, validation, authentication, and other externally observable API behavior.

Do not consider the change complete until `openapi.json` is updated.

For fixed sets of string values, use `type: "string"` with an `enum` array instead of `anyOf` or `oneOf` branches containing string `const` values. This lets API documentation viewers display the allowed values instead of repeated `const` labels. Preserve the allowed values, descriptions, and examples when converting existing schemas. Keep `const` for individual discriminator fields and retain unions that describe different object shapes.

# Testing

## Writing tests

Use Arrange, Act, Assert as the default structure for tests. Keep the phases visibly separate when doing so, and add phase comments only when they improve clarity.

Test observable behavior and meaningful regressions. Use descriptive test names that identify the scenario and expected outcome. Avoid tests that merely verify mock setup, duplicate implementation logic, or increase coverage without validating behavior.

Keep each test focused on one behavior; use multiple assertions when they are necessary to verify that behavior.

When tests require objects, fixtures, or representative data, prefer realistic examples derived from the project's existing contracts, domain models, schemas, or types rather than inventing arbitrary objects. Inspect the codebase for suitable domain objects and use their shape and terminology to construct test cases.

Do not introduce unnecessary coupling to unrelated domain behavior solely to make test data realistic. Use minimal synthetic objects when no suitable project model exists or when a deliberately isolated shape makes the behavior under test clearer.

Cover relevant normal, alternative, failure, boundary, and edge cases based on the behavior being changed and its regression risk. Consider invalid or missing inputs, duplicate operations, and dependency failures when applicable.

Keep tests deterministic and independent. Control time, randomness, and external dependencies where necessary. Run the relevant tests after making changes, and report any significant scenarios left untested and why.

## Independent test review

Whenever you create or materially modify tests, request an independent
review from a separate subagent before declaring the task complete.

Give the reviewer the task requirements, relevant source files, changed
tests, and existing testing conventions. Let it form its own conclusions
without supplying the author's justification for the tests.

> **NOTE:** The reviewer must run in a fresh session to avoid polluting the current context.

The reviewer must inspect the implementation and tests for:

- Missing meaningful behavior, failure cases, and boundary conditions.
- Assertions that would still pass if the behavior were broken.
- Tests that duplicate implementation logic or only verify mock setup.
- Redundant tests, unnecessary mocks, and coupling to private details.
- Flaky behavior or uncontrolled time, randomness, and dependencies.

The reviewer returns actionable findings with file references and reasons.
It must not invent requirements or demand tests merely to raise coverage.
It reviews only and does not modify files or spawn further reviewers.

Evaluate each finding, apply justified changes within the task's scope,
and run the affected tests. Request one follow-up review if substantive
issues were found. Report unresolved disagreements instead of looping.

In the final response, briefly report the review outcome, changes made,
and test results. If independent review is unavailable, disclose that
limitation and perform a separate self-review.
