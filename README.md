# Langparity

Langparity is a Claude Code plugin that checks a translation against its source before you ship it: a local script reports missing and extra parts, broken placeholders, ICU plurals, tags, links and formatting, changed numbers and untranslated text, then Claude reads every pair for meaning drift and tone and suggests a corrected translation for each problem it confirms. The plugin lives in [plugin/](plugin/); its README, [plugin/README.md](plugin/README.md), describes what it checks, what it reads and writes, and how to try it.

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

MIT licence. An independent project, not made or endorsed by Anthropic.
