# SDD Fit Check

Run this before creating a stub. Two minutes of honest assessment saves hours of wasted process.

---

## Is SDD the right fit?

Check all five before proceeding:

- [ ] I can describe what this system does without saying "I'll figure it out"
- [ ] This will be maintained, shared, or built upon — not thrown away after one use
- [ ] There are edge cases I can already anticipate
- [ ] The output will be used by real users or downstream systems
- [ ] Getting it wrong has meaningful consequences

**If fewer than four apply: don't spec it yet.** Vibe-code a prototype, learn what the real requirements are, then come back and spec what you learned.

---

## Gap discovery (before writing the stub)

Once you've confirmed fit, use this prompt before opening a stub file. The goal is to surface what you haven't thought through yet.

```
I want to build: [describe your project in 3-5 sentences]

Before I write a spec, ask me clarifying questions to surface anything I haven't thought through. Focus on:
- Edge cases I might have missed
- Ambiguous requirements that could go multiple ways
- Implicit assumptions I'm making about the tech stack or users
- Anything that would cause the output to be wrong in production

Ask me the most important questions first. Don't generate the spec yet.
```

Answer Claude's questions, then write the stub incorporating what you learned. Every open question Claude surfaces that you can't answer yet goes directly into the stub's open questions section.

---

## Skip SDD if

- You're exploring a new problem space and requirements are shifting weekly
- This is a one-off script with no downstream consumers
- You'd spend more time speccing than building
- You genuinely don't know what you're building yet

In those cases: build a throwaway prototype, learn from it, then spec the real thing.
