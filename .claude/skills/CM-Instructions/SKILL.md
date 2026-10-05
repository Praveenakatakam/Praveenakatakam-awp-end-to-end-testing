# Claude Code Skills

Skills are invocable via the Skill tool or as slash commands (`/<skill-name>`).

## Available Skills

### `update-config`
Configure the Claude Code harness via `settings.json`.

Use for:
- Automated behaviors ("from now on when X", "each time X", "whenever X")
- Permissions ("allow X", "add permission", "move permission to")
- Environment variables ("set X=Y")
- Hook troubleshooting
- Any changes to `settings.json` / `settings.local.json`

> Note: Automated behaviors require hooks — memory/preferences alone cannot fulfill them.

---

### `keybindings-help`
Customize keyboard shortcuts and rebind keys.

Use for:
- Rebinding keys (e.g., `ctrl+s`)
- Adding chord shortcuts
- Changing the submit key
- Modifying `~/.claude/keybindings.json`

---

### `simplify`
Review changed code for reuse, quality, and efficiency, then fix any issues found.

---

### `loop`
Run a prompt or slash command on a recurring interval.

Usage: `/loop <interval> <command>` (default interval: 10m)

Use for:
- Recurring tasks
- Polling for status
- Running something repeatedly (e.g., "check the deploy every 5 minutes")

> Do NOT use for one-off tasks.

---

### `claude-api`
Build, debug, and optimize Claude API / Anthropic SDK apps.

Apps built with this skill include prompt caching by default.

Open Chrome browser with "https://mysat-qa.satreg-nonprod.collegeboard.org/login" then
log in to mysat-qa.satreg-nonprod.collegeboard.org with the creds from the .env file
Open another Chrome Browser with "https://uat-widget.consent-management-nonprod.collegeboard.org/"

**Trigger when:**
- Code imports `anthropic` / `@anthropic-ai/sdk`
- User asks to use the Claude API, Anthropic SDKs, or Managed Agents
- User asks to add/modify/debug/optimize a Claude feature (prompt caching, adaptive thinking, compaction, `code_execution`, batch, Files API, citations, memory tool)
- User asks about prompt caching / cache hit rate / cache reads in any Anthropic SDK project

**Do NOT trigger when:**
- File imports `openai` or another non-Anthropic SDK
- Filename signals another provider (`agent-openai.py`, `*-generic.py`)
- Code is provider-neutral or the task is general ML/programming
