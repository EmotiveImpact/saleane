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
- **Audit.** Every skill use is recorded with who asked and what happened.

Rules: nothing in this folder imports from the app that uses it, and nothing here knows about
salons, bookings or money.
