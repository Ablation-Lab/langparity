# Langparity

Langparity checks translations of your app or docs against their source; it doesn't translate for you. A local script compares each translated file with its source (JSON, Flutter ARB, gettext .po, Java .properties, Apple .strings, Android strings.xml, XLIFF, and Markdown or plain text) and flags missing or added text, broken placeholders and formatting, changed numbers, and text left untranslated. Claude then reads each pair for meaning and tone, such as a formal or informal "you", and suggests a corrected translation for each problem it confirms.

It adds one skill, `langparity` (in Claude Code: `/langparity:langparity`). It's an independent project, not made or endorsed by Anthropic.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install langparity --marketplace Ablation-Lab/langparity
```

On older versions, add the marketplace first with `/plugin marketplace add Ablation-Lab/langparity`, then `/plugin install langparity@langparity`. To use the skill without the plugin, copy the `plugin/skills/langparity` folder into `~/.claude/skills/`. It needs Node.js 18 or later.

## What it checks

**Files it reads:** JSON and Flutter ARB (nested keys), gettext `.po`, Java `.properties`, Apple `.strings`, Android `strings.xml` (strings, plurals and arrays), XLIFF 1.2 and 2.0, and Markdown or plain-text documents. `.po` and XLIFF files hold both languages, so one file is enough; for the others you give the source and the translation.

**The script (mechanical checks):**

- **Structure:** keys missing from the translation or left over in it, duplicate keys (in every format except JSON and ARB, where the parser keeps the last one), and in documents, headings, paragraphs, list items, table rows or code blocks with no counterpart. It lines the documents up section by section. Where a section has the same blocks in both, they pair in order; otherwise it matches blocks of the same kind by the numbers, links, emails, inline code and placeholders they contain and by their length. Pairs near an added or removed section, or in a section where blocks of one kind were added or removed, are marked "alignment uncertain", and Claude checks them first. The alignment isn't perfect (see Limits): Claude reads every pair side by side, so a pairing that's off shows up there even when it isn't marked.
- **Placeholders:** `{name}`, `{{name}}`, `${name}`, `%{name}`, `{0}` and typed ones like `{0,number,integer}`, printf (`%s`, `%1$d`, `%@`), Python `%(name)s` and `:name`, compared exactly (typed ones by name and type, so a changed date style isn't flagged). Plural forms are compared fairly: a language with more forms (Russian `few` and `many`) is checked against the source's plural, and `%d` in a singular form is accepted.
- **ICU messages:** the argument names, select branches, a required `other` branch, valid plural categories, the placeholders used inside the branches, and nested messages. Different plural categories are expected between languages (Polish has `few` and `many`), so those are only noted.
- **Markup:** HTML and XML tags (including XLIFF inline tags), link targets, Markdown links, inline code and unclosed bold markers.
- **Numbers, URLs and email addresses:** present in both, allowing for different digit grouping (1,000 / 1.000 / 1 000).
- **Untranslated, empty and suspiciously short or long translations**, line breaks, end punctuation, leading and trailing spaces, and invisible characters added by the translation.
- **Status:** fuzzy `.po` entries and XLIFF states such as `needs-translation`.
- **A glossary**, if you give one: lines of `source term = required translation`.

**Claude (reading every pair):** meaning drift (starts/ends, may/must, paused/stopped), missing or added content within a sentence, tone and register (formal and informal address used consistently), terminology consistency, and a second look at each mechanical finding to confirm or dismiss it. Every FAIL and WARN it confirms gets a suggested translation that keeps the placeholders and tags intact.

The result is `report.md`: the script's findings, then a "Meaning and tone" section that Claude adds.

## Example prompts

```
Check the French translation in locales/fr.json against locales/en.json
Review this .po file for problems before we ship: po/de.po
Compare README.md with README.de.md and tell me what the German version is missing
Check locales/es.json against locales/en.json, using glossary.txt
Is anything broken in values-ja/strings.xml compared with values/strings.xml?
```

## Try it with the sample (for reviewers)

There's no account to set up: Langparity runs locally on files. The repository's [samples/](https://github.com/Ablation-Lab/langparity/tree/main/samples) folder has three sets with problems planted on purpose, and [samples/expected-results.md](https://github.com/Ablation-Lab/langparity/blob/main/samples/expected-results.md) lists each one and which part (the script or Claude) should find it:

- `app/en.json` and `app/fr.json`, an app's interface strings in English and French, with `glossary.txt`;
- `docs/guide.en.md` and `docs/guide.de.md`, a short guide in English and German;
- `po/de.po`, a gettext file with German translations.

To try it:

1. Copy the contents of the repository's `samples/` folder (it isn't installed with the plugin) into an empty folder and open that folder in Claude Code.
2. Say: `Check app/fr.json against app/en.json, using glossary.txt`.
3. Say: `Check docs/guide.de.md against docs/guide.en.md`.
4. Say: `Check po/de.po`.

For the first, you should see 5 FAIL and 7 WARN from the script, plus Claude's meaning and tone issues: the trial that "starts" instead of "ends", "permanently" dropped from the delete warning, and "tu" where the rest uses "vous", each with a corrected French string. For the second, the missing API-key paragraph and the unclosed bold marker; for the third, `%s` changed to `%d` and "beendet" (ended) for "paused".

**Developer note.** Seaready, our plugin submission checker, was built first. Langparity was then checked with it before submission: its local checks found no failures and one warning, because the repository wasn't on GitHub yet (an earlier run raised a false alarm on the Markdown strikethrough marker, which it read as a home-folder path; that was fixed in Seaready). Its online name and overlap search found that the plugin's first name was crowded (see The name), and found several similar tools, now described under How it compares. Langparity also went through a review council (three reviewers and a judge) and two rounds of fixes, each rechecked by a fresh reviewer; the issues left after that are listed under Limits. It's our own pre-check; the directory's validation and Anthropic's reviewers make the actual decision.

## What it runs, reads and writes

- **What it runs:** `node <skill folder>/scripts/langparity.mjs` with the file paths as arguments. Claude Code asks before each run unless your permission settings already allow it. It starts no other programs.
- **What it reads:** only the files it's given: the source, the translation and, if given, a glossary, up to 20 MB each. If you name only one file, Claude finds the matching one next to it and says which pair it's checking before it runs. The script reads them as text; it doesn't run anything in them, follow links or load external XML entities.
- **What it writes:** `report.md`, `pairs.jsonl` (each pair with its findings, for Claude to read) and `summary.json`, in a new private folder under your system's temp folder (`langparity-<file name>-…`), or in a folder you choose, where it replaces those three files if they're there. Claude then adds its "Meaning and tone" section to that `report.md`. Your translation files aren't changed unless you ask Claude to apply the fixes, and then only the strings concerned.
- **Network:** none.

## Where it works

- **Claude Code**, with Node.js 18 or later. Tested on Windows 11; the script uses only Node's standard library, so macOS and Linux should work but weren't tested.
- **Cowork and Claude chat (claude.ai):** not tested.

## Privacy

Langparity has no server, account or telemetry and sends nothing anywhere. The script writes its results to a new folder in your temp folder, and that folder keeps a full copy of the checked text (`pairs.jsonl`) and the report until you delete it; Windows doesn't empty the temp folder on its own unless Storage Sense is on. Claude gives you the folder's path and offers to delete it. Translation files often hold unreleased product text, and sometimes names or email addresses; Claude reads the strings to judge them, so they reach Anthropic the way anything in your conversation does. Don't check files you aren't allowed to share with Claude. Langparity keeps no history of its own between checks.

## How it's built

- **Markdown with YAML front matter.** The skill is `SKILL.md`: instructions for Claude in Markdown, with a short YAML block at the top (name, description, licence). They say how to run the script, how to read the pairs, what counts as drift or a tone problem, and how to write each fix.
- **JavaScript (Node.js ES modules).** `plugin/skills/langparity/scripts/langparity.mjs` and the two files in `plugin/skills/langparity/scripts/lib/` are plain JavaScript that Node runs directly, with no packages. `parsers.mjs` reads each file format; `checks.mjs` holds the checks.
- **JSON Lines for the pairs.** `pairs.jsonl` has one pair per line (JSON, a small text format of names and values), so Claude can read a long file in parts.
- **Markdown for the report.** Text from your files is shown in the report only inside code spans, on one line, with invisible characters written as visible codes. The report's own wording never includes text from the files, so a translation can't add headings, links or instructions to it.

## Design decisions

- **Two steps, each doing what it's good at.** A script is exact about placeholders, tags and numbers and never gets tired; Claude understands meaning and tone. The script's findings also tell Claude where to look hardest.
- **Every confirmed problem gets a fix.** A list of problems without corrections leaves the hard part to you, so each FAIL and WARN Claude confirms comes with a suggested translation.
- **Read only.** It reports and suggests; it doesn't rewrite your files unless you ask.
- **Languages differ, so some differences are only notes.** Plural categories, end punctuation and spacing vary by language and are flagged as notes, not errors.

## How it compares

- **Translation-management QA checks** (Weblate, Tolgee, Localizely, Phrase, SimpleLocalize's file linter) check placeholders, ICU syntax, tags and plural categories inside their platforms. Langparity runs locally on your files with no account, adds Markdown and text documents, and has Claude read every pair for meaning and tone, with a corrected string for each problem it confirms.
- **l10n-catalogs** (claudskills.com) is guidance for Claude on checking .po, XLIFF, ARB, strings.xml and ICU files. Langparity adds a script that does the exact checks first, so Claude's reading starts from a list of mechanical findings and lined-up pairs.
- **Key-sync tools** such as i18next-locales-sync and laravel-translations-checker find missing or extra keys. Langparity also checks what's inside each string, and its meaning.
- **Translation skills** (for example Plane's and ShapeShift's translate skills, translating-products-skill, translate-epub) write new translations. Langparity reviews a translation you already have.
- **intl-review** (ethereum.org) and **i18n-sync** review one project's translations against its own glossary or languages. Langparity works on any project and format, with an optional glossary.

## The name

Langparity was first called Driftcheck. It was renamed before submission because many tools already use that name or "drift-check" for configuration, documentation and code drift, including an updater for agent skills and plugins and a Claude Code plugin command, so the old name was easy to confuse with them. A search of GitHub, the plugin directory, community skill directories, npm, PyPI and the web found no plugin, skill, package or product called Langparity, only a similar name used by an unrelated language-learning service.

## Limits

- Claude's judgement of meaning and tone is only as good as its grasp of the language. It's strong in widely used languages and weaker in rare ones; it says when it can't judge.
- YAML, `.resx`, `.xlsx`, `.docx`, gettext `.mo` and SDLXLIFF files aren't read; export them to one of the supported formats first. UTF-16 files need a byte-order mark, and ISO-8859-1 `.properties` files must be saved as UTF-8 first.
- Document alignment can't always tell which of several similar paragraphs is missing when they share no numbers, links or code; those pairs are marked uncertain and Claude checks them.
- If one block is removed from a section and another of the same kind added, the section still has the same blocks, so they pair in order: the pairs after the change are off by one, nothing is marked missing, and the script's count and exit code don't show it. Claude sees the mismatched pairs side by side.
- When a whole section is added or removed, the sections on either side are marked uncertain, but in long, repetitive documents (an FAQ, say) the pairing can shift further than that, and the section reported missing can be its neighbour.
- A bullet list translated as a numbered list (or the reverse) is reported as missing and added blocks; it's marked uncertain.
- Documents with more than about 2,000 headings are lined up section by section in order, without the uncertainty marks.
- ICU: a plural that drops `{count}` from every branch while keeping `#` isn't caught; a placeholder dropped from one select branch is missed when other branches still have it; `#` in the source against `{count}` in a nested select is reported as a change; and typed arguments' styles (such as the currency in `::currency/USD`) aren't compared.
- Markdown parsing is simple: setext headings (underlined with `===`), YAML front matter and indented code blocks are read as ordinary paragraphs.
- Some rarer cases give false alarms or are missed: numbers in reference-style links, `.properties` escapes such as `http\://`, `.strings` `\U` escapes, deeply nested JSON (thousands of levels), and Android strings with unusual whitespace.
- One string longer than 20,000 characters gets only the placeholder and tag checks.
- A very long document with no headings and a paragraph missing (thousands of paragraphs) takes several seconds and is marked uncertain throughout; add headings or split it.
- In ICU plurals, the argument written out in a branch (`{count}`) is treated as the same as `#`.
- Numbers written out as words ("five" for 5) and ordinals aren't matched.
- Very large files (thousands of strings) are read in parts; for more than about 600 pairs Claude reads every flagged pair and as many others as it can, and says how many.
- The checks look at each pair on its own, apart from terminology and register, which Claude checks across the file.

## Troubleshooting

- **"give the translation file too":** that format holds one language per file; name both files.
- **"the two files look like different formats":** they have different extensions; add `--format` if they really are the same format.
- **"isn't UTF-8 or UTF-16 text":** save the file as UTF-8 in your editor and try again.
- **"node" isn't found:** install Node.js 18 or later.

## Support

Report problems at https://github.com/Ablation-Lab/langparity/issues.

## Licence

MIT. See the LICENSE file in the repository.

## Repository layout

| Path | What it is |
|---|---|
| `plugin/` | the plugin folder (Plugin path `plugin` in the directory portal) |
| `plugin/skills/langparity/` | the skill: `SKILL.md`, `scripts/langparity.mjs` and `scripts/lib/` |
| `samples/` | sample files with planted problems, and `expected-results.md` |
| `.claude-plugin/marketplace.json` | lets Claude Code install the plugin from this repo |
| `test/` | tests, run with `node --test` (not part of the plugin) |
| `scripts/privacy-check.sh`, `.githooks/` | the maintainer's pre-commit privacy check; the plugin never runs it |

## Development

- Run the tests with `node --test` from the repository root.
- The privacy check (`scripts/privacy-check.sh`) runs before every commit; turn it on once per clone with `git config core.hooksPath .githooks`.
- Keep `plugin/README.md` and `SKILL.md` in step, and the versions in `plugin.json` and `marketplace.json` equal.
- Keep this README and `plugin/README.md` in step: when either changes, make the same change in the other (apart from the paths, which this one gives from the repository root, and these last two sections).

Research by Ablation Lab.
