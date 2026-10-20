Quickly capture a feature idea as a requirement stub without going through full SDD.

Launch the `requirement-stubber` agent with the following context:

- The user's idea: $ARGUMENTS
- Target directory: `specs/pending/`
- Today's date for the "Captured" field

The agent should:
1. If $ARGUMENTS is detailed enough, write the stub immediately with minimal or no follow-up questions
2. If $ARGUMENTS is too vague to stub usefully, ask at most 2-3 targeted clarifying questions before writing
3. Write `specs/pending/<slug>/stub.md` and update `specs/registry.yaml`
4. Confirm what was captured

The goal is fast capture. The user can flesh it out later when they run `/start-feature` and reference this stub.
