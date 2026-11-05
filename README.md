# Langparity

Langparity is a Claude Code plugin that checks translations of your app or docs against their source; it doesn't translate for you. A local script compares each translated file with its source (JSON, Flutter ARB, gettext .po, Java .properties, Apple .strings, Android strings.xml, XLIFF, and Markdown or plain text) and flags missing or added text, broken placeholders and formatting, changed numbers, and text left untranslated. Claude then reads each pair for meaning and tone, such as a formal or informal "you", and suggests a corrected translation for each problem it confirms. The plugin lives in [plugin/](plugin/); its README, [plugin/README.md](plugin/README.md), describes what it checks, what it reads and writes, and how to try it.

## Install

```
/plugin install langparity --marketplace Ablation-Lab/langparity
```

Or copy `plugin/skills/langparity` into `~/.claude/skills/` to use it as a personal skill.

## Repository layout

| Path | What it is |
|---|---|
| `plugin/` | the plugin folder (Plugin path `plugin` in the directory portal) |
| `plugin/skills/langparity/` | the skill: `SKILL.md`, `scripts/langparity.mjs` and `scripts/lib/` |
| `samples/` | sample files with planted problems, and `expected-results.md` |
| `.claude-plugin/marketplace.json` | lets Claude Code install the plugin from this repo |
| `test/` | tests, run with `node --test` (not part of the plugin) |
| `scripts/privacy-check.sh`, `.githooks/` | the maintainer's pre-commit privacy check; the plugin never runs it |

Keep `plugin/README.md` and `SKILL.md` in step, and the versions in `plugin.json` and `marketplace.json` equal.

Langparity was renamed before release; see [The name](plugin/README.md#the-name) for its first name and why it changed.

MIT licence. An independent project, not made or endorsed by Anthropic.
