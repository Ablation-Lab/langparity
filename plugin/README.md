# Driftcheck

Driftcheck checks a translation against its source before you ship it. A local script lines up the source and the translation, string by string or section by section, and reports what's mechanically broken: missing and extra parts, renamed or dropped placeholders, broken ICU plurals, unclosed tags and formatting, changed links and numbers, and text left untranslated. Then Claude reads every pair for what a script can't see: meaning drift, dropped clauses, the wrong tone or form of address, and inconsistent terms. Each problem Claude confirms comes with a corrected translation.

It adds one skill, `driftcheck` (in Claude Code: `/driftcheck:driftcheck`). It's an independent project, not made or endorsed by Anthropic.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install driftcheck --marketplace Ablation-Lab/driftcheck
```

On older versions, add the marketplace first with `/plugin marketplace add Ablation-Lab/driftcheck`, then `/plugin install driftcheck@driftcheck`. To use the skill without the plugin, copy the `skills/driftcheck` folder into `~/.claude/skills/`. It needs Node.js 18 or later.

## What it checks

**Files it reads:** JSON and Flutter ARB (nested keys), gettext `.po`, Java `.properties`, Apple `.strings`, Android `strings.xml` (strings, plurals and arrays), XLIFF 1.2 and 2.0, and Markdown or plain-text documents. `.po` and XLIFF files hold both languages, so one file is enough; for the others you give the source and the translation.

**The script (mechanical checks):**

- **Structure:** keys missing from the translation or left over in it, duplicate keys (in every format except JSON and ARB, where the parser keeps the last one), and in documents, headings, paragraphs, list items, table rows or code blocks with no counterpart. It lines the documents up section by section, matching blocks of the same kind by the numbers, links, inline code and placeholders they contain and by their length. Where blocks were added or removed and that leaves a choice, it marks those pairs "alignment uncertain", and Claude checks them first.
- **Placeholders:** `{name}`, `{{name}}`, `${name}`, `%{name}`, `{0}` and typed ones like `{0,number,integer}`, printf (`%s`, `%1$d`, `%@`), Python `%(name)s` and `:name`, compared exactly. Plural forms are compared fairly: a language with more forms (Russian `few` and `many`) is checked against the source's plural, and `%d` in a singular form is accepted.
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

There's no account to set up: Driftcheck runs locally on files. The repository's [samples/](https://github.com/Ablation-Lab/driftcheck/tree/main/samples) folder has three sets with problems planted on purpose, and [samples/expected-results.md](https://github.com/Ablation-Lab/driftcheck/blob/main/samples/expected-results.md) lists each one and which part (the script or Claude) should find it:

- `app/en.json` and `app/fr.json`, an app's interface strings in English and French, with `glossary.txt`;
- `docs/guide.en.md` and `docs/guide.de.md`, a short guide in English and German;
- `po/de.po`, a gettext file with German translations.

To try it:

1. Copy the contents of the repository's `samples/` folder (it isn't installed with the plugin) into an empty folder and open that folder in Claude Code.
2. Say: `Check app/fr.json against app/en.json, using glossary.txt`.
3. Say: `Check docs/guide.de.md against docs/guide.en.md`.
4. Say: `Check po/de.po`.

For the first, you should see 5 FAIL and 7 WARN from the script, plus Claude's meaning and tone issues: the trial that "starts" instead of "ends", "permanently" dropped from the delete warning, and "tu" where the rest uses "vous", each with a corrected French string. For the second, the missing API-key paragraph and the unclosed bold marker; for the third, `%s` changed to `%d` and "beendet" (ended) for "paused".

**Developer note.** Driftcheck has not been checked with Seaready yet. (This note is updated once it has.)

## What it runs, reads and writes

- **What it runs:** `node <skill folder>/scripts/driftcheck.mjs` with the file paths as arguments. Claude Code asks before each run unless your permission settings already allow it. It starts no other programs.
- **What it reads:** only the files it's given: the source, the translation and, if given, a glossary, up to 20 MB each. If you name only one file, Claude finds the matching one next to it and says which pair it's checking before it runs. The script reads them as text; it doesn't run anything in them, follow links or load external XML entities.
- **What it writes:** `report.md`, `pairs.jsonl` (each pair with its findings, for Claude to read) and `summary.json`, in a new private folder under your system's temp folder (`driftcheck-<file name>-…`), or in a folder you choose, where it replaces those three files if they're there. Claude then adds its "Meaning and tone" section to that `report.md`. Your translation files aren't changed unless you ask Claude to apply the fixes, and then only the strings concerned.
- **Network:** none.

## Where it works

- **Claude Code**, with Node.js 18 or later. Tested on Windows 11; the script uses only Node's standard library, so macOS and Linux should work but weren't tested.
- **Cowork and Claude chat (claude.ai):** not tested.

## Privacy

Driftcheck has no server, account or telemetry and sends nothing anywhere. The script writes its results to a new folder in your temp folder, and that folder keeps a full copy of the checked text (`pairs.jsonl`) and the report until you delete it; Windows doesn't empty the temp folder on its own unless Storage Sense is on. Claude gives you the folder's path and offers to delete it. Translation files often hold unreleased product text, and sometimes names or email addresses; Claude reads the strings to judge them, so they reach Anthropic the way anything in your conversation does. Don't check files you aren't allowed to share with Claude. Driftcheck keeps no history of its own between checks.

## How it's built

- **Markdown with YAML front matter.** The skill is `SKILL.md`: instructions for Claude in Markdown, with a short YAML block at the top (name, description, licence). They say how to run the script, how to read the pairs, what counts as drift or a tone problem, and how to write each fix.
- **JavaScript (Node.js ES modules).** `scripts/driftcheck.mjs` and the two files in `scripts/lib/` are plain JavaScript that Node runs directly, with no packages. `parsers.mjs` reads each file format; `checks.mjs` holds the checks.
- **JSON Lines for the pairs.** `pairs.jsonl` has one pair per line (JSON, a small text format of names and values), so Claude can read a long file in parts.
- **Markdown for the report.** Text from your files is shown in the report only inside code spans, on one line, with invisible characters written as visible codes. The report's own wording never includes text from the files, so a translation can't add headings, links or instructions to it.

## Design decisions

- **Two passes, each doing what it's good at.** A script is exact about placeholders, tags and numbers and never gets tired; Claude understands meaning and tone. The script's findings also tell Claude where to look hardest.
- **Every issue gets a fix.** A list of problems without corrections leaves the hard part to you, so each meaning or tone issue comes with a suggested translation.
- **Read only.** It reports and suggests; it doesn't rewrite your files unless you ask.
- **Languages differ, so some differences are only notes.** Plural categories, end punctuation and spacing vary by language and are flagged as notes, not errors.

## How it compares

(Filled in after the name and overlap search.)

## Limits

- Claude's judgement of meaning and tone is only as good as its grasp of the language. It's strong in widely used languages and weaker in rare ones; it says when it can't judge.
- YAML, `.resx`, `.xlsx`, `.docx`, gettext `.mo` and SDLXLIFF files aren't read; export them to one of the supported formats first. UTF-16 files need a byte-order mark, and ISO-8859-1 `.properties` files must be saved as UTF-8 first.
- Document alignment can't always tell which of several similar paragraphs is missing when they share no numbers, links or code; those pairs are marked uncertain and Claude checks them.
- Markdown parsing is simple: setext headings (underlined with `===`), YAML front matter and indented code blocks are read as ordinary paragraphs.
- Some rarer cases give false alarms or are missed: numbers in reference-style links, `.properties` escapes such as `http\://`, `.strings` `\U` escapes, deeply nested JSON (thousands of levels), and Android strings with unusual whitespace.
- One string longer than 20,000 characters gets only the placeholder and tag checks.
- Numbers written out as words ("five" for 5) and ordinals aren't matched.
- Very large files (thousands of strings) are read in parts; for more than about 600 pairs Claude reads every flagged pair and as many others as it can, and says how many.
- The checks look at each pair on its own, apart from terminology and register, which Claude checks across the file.

## Troubleshooting

- **"give the translation file too":** that format holds one language per file; name both files.
- **"the two files look like different formats":** they have different extensions; pass `--format` if they really are the same format.
- **"isn't UTF-8 or UTF-16 text":** save the file as UTF-8 in your editor and try again.
- **"node" isn't found:** install Node.js 18 or later.

## Support

Report problems at https://github.com/Ablation-Lab/driftcheck/issues.

## Licence

MIT. See the LICENSE file in the repository.

Research by Ablation Lab.
