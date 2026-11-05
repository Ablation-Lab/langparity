# Expected results for the samples

Every problem below was planted on purpose. Pair numbers are the ones in Driftcheck's report.

## app/en.json and app/fr.json (with glossary.txt, target language fr)

Mechanical checks (the script): 5 FAIL, 7 WARN, 1 NOTE.

| Pair / key | What's wrong | Found by |
|---|---|---|
| `logout` | missing from the translation | script (FAIL) |
| `legacy.banner` | in the translation but not the source | script (WARN) |
| 1 `greeting` | placeholder `{name}` renamed to `{nom}` | script (FAIL, twice: missing and extra) |
| 2 `inbox` | ICU plural has no `other` branch | script (FAIL) |
| 3 `cart.total` | $50 became 30 $ | script (WARN, twice) |
| 5 `settings.save` | left in English | script (WARN) |
| 6 `settings.danger` | `</b>` missing; "permanently" dropped | script (FAIL) for the tag; Claude for the meaning |
| 7 `help` | link target changed; the support email is gone | script (WARN, twice) |
| 8 `trial` | "commence" (starts) where the source says ends | Claude (meaning drift) |
| 9 `onboarding.tip` | "Tu" where the rest of the file uses "vous"; "Réglages" where the glossary says "Paramètres" | Claude (register); script (glossary WARN) |

## docs/guide.en.md and docs/guide.de.md

Mechanical checks: 2 FAIL, 6 WARN.

- The last paragraph (never share your API key) is missing: script (FAIL).
- `**5 Minuten.` has an unclosed bold marker: script (FAIL).
- Version 2.4 became 2.5, and the releases link points to a different page: script (WARN for each).
- The code block and the inline code `tool check` were translated: script (WARN, twice).

## po/de.po

Mechanical checks: 3 FAIL, 1 WARN.

- `Saved %s files.`: `%s` became `%d`: script (FAIL, twice).
- `Sync is paused.`: marked fuzzy (script WARN), and "beendet" means ended, not paused: Claude (meaning drift).
- `Remove`: empty translation: script (FAIL).
