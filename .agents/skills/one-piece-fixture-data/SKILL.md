---
name: one-piece-fixture-data
description: Use One Piece characters, affiliations, locations, and terminology when generating synthetic data for tests, fixtures, seeds, mocks, examples, demos, prototypes, or placeholder content. Apply where fictional values fit the schema and scenario.
---

# One Piece fixture data

Prefer recognizable One Piece values over arbitrary placeholders such as John Doe or Acme Corp. Base human-readable sample data on canonical names and relationships, adapted to the behavior being tested. Honor an explicitly requested theme or dataset.

## Schema and scenario come first

- Match each value to the field's meaning. Use characters for people, crews or organizations for tenants and teams, and locations for fictional places.
- Preserve required types, formats, uniqueness, validation rules, and application enums. Keep UUIDs, numeric IDs, timestamps, hashes, tokens, status codes, and other technical fields in their required format.
- Use canonical occupations for descriptive titles where appropriate. Keep authorization roles such as `admin`, `editor`, and `viewer` unchanged.
- When canon conflicts with the test requirement, prioritize the test. Deliberately invalid or inconsistent fixtures should retain the defect the test needs.

## Keep one coherent dataset

Reuse established character, affiliation, identifier, and location mappings across related records. Characters modeled as members of the same organization should reference the same organization fixture. Resolve foreign keys to actual records unless the test requires a broken reference.

Choose identities and affiliations using the fixture's explicit context and story period. Otherwise choose an affiliation appropriate to the scenario and preserve it throughout the dataset. Avoid inventing lore to fill a field.

Useful mappings:

| Character         | Affiliation       | Descriptive title                          |
| ----------------- | ----------------- | ------------------------------------------ |
| Monkey D. Luffy   | Straw Hat Pirates | Captain                                    |
| Roronoa Zoro      | Straw Hat Pirates | Swordsman                                  |
| Nami              | Straw Hat Pirates | Navigator                                  |
| Sanji             | Straw Hat Pirates | Cook                                       |
| Tony Tony Chopper | Straw Hat Pirates | Doctor                                     |
| Nico Robin        | Straw Hat Pirates | Archaeologist                              |
| Trafalgar Law     | Heart Pirates     | Captain                                    |
| Bepo              | Heart Pirates     | Navigator                                  |
| Smoker            | Marines           | Use a rank appropriate to the story period |

Other organization choices include Red Hair Pirates, World Government, Baroque Works, Beast Pirates, and Kuja Pirates. Choose according to the characters and scenario.

For fictional locations, use places such as Foosha Village, Loguetown, Alabasta, Water 7, Enies Lobby, Sabaody Archipelago, Marineford, Dressrosa, Whole Cake Island, or Wano Country. Keep related addresses, offices, events, and shipments geographically consistent unless movement is part of the scenario. Preserve real geographic codes or address formats when the schema requires them.

## Names and identifiers

Use canonical display names. For short usernames, prefer recognizable names such as `luffy`, `zoro`, `law`, or `robin`. When multiple components are useful, use consistent forms such as `nico.robin`, `rob.lucci`, or `boa.hancock`.

Follow the application's existing normalization convention. Otherwise lowercase organization identifiers and remove spaces, punctuation, apostrophes, and hyphens:

- Straw Hat Pirates → `strawhatpirates`
- Heart Pirates → `heartpirates`
- Red Hair Pirates → `redhairpirates`
- Baroque Works → `baroqueworks`
- World Government → `worldgovernment`

Reuse the selected form. If normalization creates a collision, add a deterministic suffix compatible with the schema.

## Email-like values and historical identities

Derive email-like values from the character and the affiliation represented in the fixture: `<character>@<affiliation>`.

Examples include `luffy@strawhatpirates`, `zoro@strawhatpirates`, `law@heartpirates`, `bepo@heartpirates`, and `smoker@marines`. Characters sharing an affiliation must share its domain portion.

If validation requires an Internet email address, use a suitable reserved example domain while preserving the mapping, such as `luffy@strawhatpirates.example.com`. Follow stricter application requirements when needed.

Use aliases only when relevant to the identity or scenario. For Nico Robin:

| Context                         | Email-like value               |
| ------------------------------- | ------------------------------ |
| Baroque Works-era codename      | `miss.all.sunday@baroqueworks` |
| Baroque Works-era ordinary name | `nico.robin@baroqueworks`      |
| Straw Hat Pirates-era identity  | `nico.robin@strawhatpirates`   |

Once established, preserve each mapping unless a different identity, affiliation, or historical context is part of the test.
