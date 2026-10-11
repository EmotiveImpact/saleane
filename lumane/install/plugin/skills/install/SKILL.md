---
name: install
description: Installs LUMANE in this app as "Ask" and the app's name. Reads the app, asks five questions, writes and checks the pack, adds the Ask button and panel in the app's own design, and opens a pull request for a person's yes. Use only when someone runs /lumane:install.
argument-hint: '[answers copied from the LUMANE install page]'
disable-model-invocation: true
---

# Install LUMANE

LUMANE is the assistant engine behind Ask SALEANE. In each app it is called "Ask" and the app's
name. You are installing it in the app in front of you. The app opens the pathways; LUMANE walks
only those, and every change it prepares waits for a person to tap Approve.

Work through the steps below in order. Keep the person informed in short, plain sentences: no
jargon in anything you ask them.

## Rules that never bend

- Work on a new branch called `lumane/install` and finish with a **draft pull request**. Never
  merge it, never deploy anything and never push to the default branch.
- Never add an API key, a password or real customer data, in code, tests or the pull request.
  LUMANE runs in test mode, sending nothing, until the app's owner sets keys on their own server.
- A pathway that changes anything (`actionSkill`) only **prepares** the change and describes it in
  one plain sentence. The app carries it out only after a person approves, through the app's own
  permission checks. Never write a pathway that saves, sends, pays, refunds or deletes by itself.
- Nothing in LUMANE's folder may import from the app. Do not edit LUMANE's own files to make them
  fit: the app's side lives in the app.
- Every pathway checks who is asking (`allowed`) with the app's existing permission rules.
- When the person picks the app's own design, use the app's own components, colours and fonts.

## 1. Read the app

Find, and keep notes on:

- **Its name** as written on screen, and a shorter name if the team uses one.
- **What it handles**, in at most five plain words or phrases (for a calendar: events,
  calendars, people, invitations, reminders). Count the files with `git ls-files | wc -l`.
- **Its design**: where its colours, fonts and corners are defined (CSS variables, a Tailwind
  config, a theme file), its main colour as a hex code, its font, its usual corner radius and
  whether it has a dark mode. Note its button, dialog or drawer components.
- **Its screens**: LUMANE's screen parts are React. If the app is not React, stop and tell the
  person; do not rebuild the parts in another framework without their yes.
- **Its server**: where requests are handled, how a signed-in person is identified and how their
  permissions are checked, and where records are kept.
- **Pathways**: three to eight things Ask could do here. For each, a name an AI supplier accepts
  (lower case letters, digits and underscores, such as `look_up_events`), a title ("Look up
  events"), whether it only looks (`read`) or prepares a change (`action`), one sentence for the
  AI saying what it does, and an example question ("What's on tomorrow?"). Prefer looking things
  up; recommend at most two changes to begin with.

## 2. Say what you found

Three short lines, then the questions. For example:

```
✓ Read your app: 212 files.
✓ Found what it could help with: events, calendars, people, invitations and reminders.
✓ Found your design: colours, fonts and corners in src/styles/tokens.css.
```

If `$ARGUMENTS` holds a block that starts with `LUMANE answers`, it was copied from the LUMANE
install page. Show those answers back in five lines and ask one question, "Use these answers?",
with Yes and Change something. On yes, skip step 3.

## 3. Ask the five questions

Use the AskUserQuestion tool. It takes at most four questions at a time and four options for each,
and the person can always type their own answer. Put "(recommended)" after the option you
recommend, and list it first.

**First call**, four questions:

1. Header `Name`: "What should the assistant be called?" Options: "Ask [App] (recommended)",
   "Ask [Short name]" when there is one. LUMANE always adds "Ask"; the pack holds the name
   without it.
2. Header `Tone`: "How should it sound?" Options: "Warm and friendly (recommended)", "Calm and
   polished", "Bright and cheerful". Each option's description: "Kind and clear, like a good
   receptionist." / "Quiet and precise." / "Upbeat, with short sentences."
3. Header `Allowances`: "How much should each account include each month?" Options: "Starter
   amounts (recommended)" (300 typed questions and 30 minutes of talking), "More" (1,000 typed
   questions and 120 minutes of talking). Typing their own means their own amounts. Say that
   LUMANE stops before going over, so it never costs more than planned.
4. Header `Look`: "How should it look?" Options: "[App]'s own design (recommended)" (your
   colours, fonts and corners), "LUMANE's default look" (set by a colour, a font, the corners
   and light or dark), "Plain parts only" (no styling at all; your team dresses them).

**Second call**, the pathways, with `multiSelect: true`. With four or fewer, one question,
header `Pathways`: "Which pathways should it have?" With more, two questions: header `Look ups`
for the `read` pathways and header `Changes` for the `action` pathways. Each option's
description says "Looks only." or "Waits for a person to approve it."

## 4. Bring LUMANE into the app

If the app already has LUMANE (a `lumane/` folder, or a `lumane` package), use it. Otherwise copy
the `lumane/` folder from https://github.com/EmotiveImpact/saleane at one fixed commit, unchanged,
leaving out `lumane/install/plugin`, and note the commit in the pull request. LUMANE needs `react`
and `zod`; reuse the versions the app has. Import it the way the app imports its own folders.

## 5. Write the pack

Write `src/lumane.pack.ts` (or the same place in the app's source folder) exactly in the shape of
[pack-template.md](pack-template.md). LUMANE's `packSource()` in `lumane/install/write.ts` writes
this same file from the answers, so you can also run it.

Then connect each chosen pathway to the app's own code:

- A `read` pathway calls the app's existing functions for its records, only for what the person
  may see, and returns plain facts. Keep what it returns short.
- An `action` pathway checks the request can be done (throwing `SkillRefusal` with a plain reason
  when it cannot), changes nothing, and returns `{ summary, effect }`: one plain sentence the
  person approves, and the change for the app to carry out after they do.
- A pathway you cannot connect safely keeps `notConnected(...)`, so Ask says plainly it cannot do
  that yet. List it in the pull request.

## 6. Check the pack

Write `src/lumane.pack.test.ts` from the template and run it with the app's test runner:
`packProblems(pack)` must be empty. If it lists problems, fix them and run it again. Then run the
app's own checks (lint, type checks, tests) until they pass.

## 7. Connect the server

On the app's server, add the routes the panel needs: one that answers a question (it runs
`runTurn` with the team's pathways and the allowance, keeps the conversation and each prepared
change on the server until a person decides, and never trusts earlier lines sent by the browser),
one that records a decision (on approve, it carries out the change through the app's own
permission-checked path, and only then says it is saved), and one that reports usage. Use LUMANE's
`scriptedBrain` (test mode) unless the owner has set an Anthropic key in the server's environment.
SALEANE's `server/assistant.ts` and `server/assistantRecords.ts` are the worked example.

## 8. Add the Ask button and panel

The button reads "Ask [Name]" and opens the panel in the app's own drawer or dialog. The panel says
it is an AI and that changes wait for approval. Choose by the Look answer:

- **The app's own design**: build the panel from `lumane/react`'s parts and dress them with the
  app's components through `asChild`, as SALEANE's `src/components/AskSaleane.tsx` does:

  ```tsx
  <ApprovalCard.Root onDecide={(approve) => decide(change.id, approve)} className="...">
    <ApprovalCard.Summary>{change.summary}</ApprovalCard.Summary>
    <ApprovalCard.Actions>
      <ApprovalCard.Approve asChild>
        <Button>Approve</Button>
      </ApprovalCard.Approve>
      <ApprovalCard.Decline asChild>
        <Button variant="quiet">Not now</Button>
      </ApprovalCard.Decline>
    </ApprovalCard.Actions>
    <ApprovalCard.Outcome />
  </ApprovalCard.Root>
  ```

- **LUMANE's default look**: `<AskPanel name="Ask [Name]" look={{ colour, font, corners, scheme }}
transport={...} />`, importing `lumane/react/look.css` once. Start from the app's main colour
  and font.
- **Plain parts only**: `<AskPanel look="plain" ... />` with no stylesheet.

Look at it at a wide screen and at a phone's width (390 pixels) before going on.

## 9. Open the pull request

Commit on `lumane/install` and open a **draft** pull request titled "Add Ask [Name]". Describe
what a person would see, in a "Before:" and an "After:" paragraph, then list the five answers,
each pathway (connected, or not yet and why), what each account includes, and that LUMANE runs
in test mode until keys are set on the server. Never merge it.

## At the end

Tell the person, in this shape:

```
Ask [Name] is ready for your yes
✓ Wrote the pack: src/lumane.pack.ts
✓ Checked it: no problems found.
✓ Added the Ask [Name] button and panel, in [App]'s own design.
✓ Opened a pull request: Add Ask [Name]
Nothing changes in [App] until you approve the pull request.
```

Say honestly what did not happen: a pathway left unconnected, a check that failed, a step skipped.
