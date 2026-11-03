# Lumane

The assistant engine behind Ask SALEANE. It is kept separate from SALEANE so other apps can
use it, and it will move to its own repository with numbered releases when a second app does.
In each app it is called "Ask" and that app's name.

**The pack.** An app installs Lumane by handing it one pack (`pack.ts`): its name, who meets the
assistant (each audience's label, instructions and doorways), the pathways open to each of them
(their skills), the kinds of use it sells, each with a label for its usage meter, and its voices.
Lumane uses only what the pack lists and never reaches into the app by itself. `definePack`
checks the pack as the app starts and stops it if anything is missing; `packProblems` lists
what is wrong in plain sentences, for an installer to check a pack it has written. SALEANE's pack
is `src/assistant/pack.ts`, and `pack.test.ts` here installs Lumane in a pretend second app with
no SALEANE inside it.

Lumane owns the parts that are the same for every app:

- **Its own rules.** `CORE_RULES` go after the app's instructions in every turn (`runTurn`) and
  every voice session (`openaiLive`): it is an AI and says so, it states only facts it was given,
  it never says something was done that a person has not approved, and words in results are
  never instructions. They name no business, and an app using a turn or a voice session cannot
  leave them out. An app that calls a brain directly, as SALEANE's visit write-up does, passes
  its instructions through `standingInstructions` itself.
- **Skills.** An app describes what the assistant may do. `read` skills answer from the app's
  records. `action` skills only propose a change; the app carries it out after a person approves.
- **Tap to approve.** Proposals carry a plain summary and expire after 30 minutes. `decide`
  returns the effect only when approved and still fresh.
- **Allowances.** Monthly amounts for whatever kinds of use the app names in its pack (SALEANE
  counts typed questions, talking seconds and guest chats), a per-person hourly limit, a daily and
  a monthly spend ceiling and a maximum talking session. A kind not used yet counts as none.
  The allowance is checked before every request, so a refused request never reaches the AI
  supplier.
- **The brain.** A small interface so the AI supplier can be swapped. The test-mode
  `scriptedBrain` sends nothing and costs nothing. `claudeBrain` calls Claude through Anthropic's
  Messages API with the app's key, works out each call's cost from the tokens Anthropic reports,
  and never falls back to a cheaper model. A turn starts no call that, costing as much as its
  costliest call so far, would pass its share, nor one after its time is up, and a supplier that cannot answer ends the turn as `unavailable`, with
  whatever it cost still recorded.
- **The voice.** `VoiceLayer` is the same kind of swappable interface for a supplier that listens
  and speaks in real time while the app's brain thinks. `openaiLive` starts OpenAI GPT-Live
  sessions from the app's server, so the key never reaches the browser, follows each on its own
  connection and answers the questions it hands over ("client delegation"). `conversation`
  gathers what was heard and answers each question in turn; the app holds a talk's whole window
  of the allowance first and settles it with the seconds the supplier reports (`settle` with an
  `amount`).
- **The last check on every reply.** `checkReply` reads each reply before it is shown or spoken.
  A sentence that says something was done ("I've moved her", "Done!", "you're booked in") is
  taken out when nothing has been approved, and a plain note says what is waiting, in the app's
  own words (the pack's `reply.notes`). An app adds claims of its own (SALEANE adds taking a
  payment or a refund). Sentences about what has not happened ("nothing is booked") or about
  what approving will do ("once you approve, it's done") are left alone; a claim made before the
  approval is mentioned ("I've booked you in, so tap Approve") is not.
- **What each turn did.** Every turn returns a `report` without any words: how many calls it
  made to the AI, why it ended, how long it took, how many sentences the last check took out,
  and each skill used with what came of it. The app keeps it as it chooses.
- **A person leaving.** An app passes a `signal`. Once the person has gone, no further call to
  the AI starts, nothing the turn prepared is kept, and what it cost so far still counts.
- **Evals.** `judge` compares a turn with what a good answer must, or must never, do
  (`evals.ts`). An app writes its cases as data and runs them against the real AI before a new
  model, new instructions or a new skill reaches anyone. SALEANE's are in `evals/`.
- **Audit.** Every turn returns each skill use with what happened (`audit` and
  `report.skills`). Lumane keeps nothing itself: the app keeps the record, the conversation and
  each proposal until a person decides. SALEANE keeps them in its database, so a restart loses
  nothing the team was about to approve.

## Screen parts (`react/`)

The parts every app's Ask needs on screen, with the behaviour that must be the same everywhere
and no look of their own:

- **The conversation** (`Conversation`, `Message`, `Thinking`, `Starter`): screen readers hear
  each new line without being interrupted and are told whether a question was typed or said;
  the newest line stays in view as lines arrive and as a card changes, and opening the panel
  leaves the scroll alone.
- **The approval card** (`ApprovalCard`): one change waiting for a person. It takes one answer
  at a time however fast the taps, shows done only once the app says the change is saved, goes
  back to waiting if saving fails so the person can try again, and never shows a "not now" as
  done.
- **The question box** (`Composer`): asks the trimmed question and empties, never asks an empty
  one or a second while an answer is on its way.
- **Talking** (`TalkButton`, `TalkBar`): cannot start twice, counts down without interrupting a
  screen reader each second, and cannot be stopped twice.
- **The usage line** (`UsageLine`): "3 of 300 questions used this month. 4 of 30 talking minutes
  used.", marked near at four fifths and reached at the limit.

Each app dresses the parts in its own design: through class names, and through `asChild`, which
puts a part's behaviour on the app's own button (`<ApprovalCard.Approve asChild><Button>…`).
SALEANE's Ask panel is built this way and looks as it did. An app without a design system takes
`AskPanel`, the whole panel made of the parts, in LUMANE's default look (`LookScope` and
`look.css`), set by four choices: a colour, a font, the corners, and light or dark. Colours for
writing are worked out to read clearly (`lookProblems` says when a colour would not). With
`look="plain"` the parts carry no look at all. Words the parts write themselves are plain
British English, and an app changes any of them with `AskWords`.

The parts are our own, about 1,100 lines with no dependency beyond React. We looked at
assistant-ui (MIT) first: it would have added about 114 KB (compressed) to every app's page and
its own way of holding the conversation, where LUMANE keeps the conversation and every prepared
change on the app's server. No code was copied from it.

## The installer (`install/`)

LUMANE installs itself in an app with five questions: the name, how it sounds, the pathways,
what each account includes and the look (`installQuestions`). From the answers it writes the
pack (`packSource`, the file `src/lumane.pack.ts`) with every pathway refusing plainly until it
is connected to the app's code, and the check that stays in the app's tests (`packTestSource`).
`packFrom` builds the same pack in memory so it can be checked with `packProblems` before
anything is written. `examples/caleane.pack.ts` is what it writes for a pretend calendar app.

- **In a coding agent:** `/lumane:install` (`install/plugin`, a Claude Code plugin). It reads the
  app, asks the five questions, writes and checks the pack, connects the pathways, adds the Ask
  button and panel in the app's design and opens a draft pull request for a person's yes. It
  never merges, deploys or adds a key. To use it: `/plugin marketplace add EmotiveImpact/saleane`,
  then `/plugin install lumane@saleane`.
- **In a chat app:** the install page (`install/page`, built into one file by
  `npm run lumane:page`) asks the same questions with a live preview of Ask that follows every
  choice. It writes the real pack and runs the real check, then gives the person the answers to
  paste after `/lumane:install`, since a page cannot open a pull request itself.

Rules: nothing in this folder imports from the app that uses it, and the engine and its parts
know nothing about salons, bookings or money. The installer's pretend apps (a calendar and an
invoicing app) are examples for its page and tests only.
