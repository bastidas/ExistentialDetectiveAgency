# Existential Detective Agency — concept, philosophy, and architecture

This repo is a philosophical, therapeutic, and playful chat experience: a place for self-inquiry that is also a building you can walk through. The product is not “a chatbot with a persona.” It is an **institution that pretends to be a conversation**, and a **conversation that pretends to be an institution**.

Fun lives in the friction between those two pretenses. Complexity in the prompts is usually a sign that the friction has been flattened into one string.

This document is high-level guidance: what the Agency *is*, which kinds of knowledge must stay separate, and which software layer should own each kind. For how prompts are assembled today, see [`agent-prompt-construction.md`](agent-prompt-construction.md). For layout, see [`AGENTS.md`](../AGENTS.md).

---

## What we are making

A querent arrives at a front desk, sits a ritual exam (the Baseline), then meets a detective who will not recite a script. Two philosophers listen from the margins and must not steal the room. Notes, a dossier, and a poem accumulate around the conversation. The tone is bureaucratic at the threshold and poetic once the file is open.

The experience is therapeutic in the old sense of a **frame**: reliable enough that the content can be dangerous. It is philosophical because it treats inner life as something to be investigated, not optimized. It is fun because dry procedure and myth are allowed to collide without collapsing into each other.

The Detective persona already quotes the distinction that matters: infinite players prepare to be surprised. They do not protect an unchanging identity so much as they protect a **way of playing**. A frozen character is not a dead character. It is a stable ethos so the play can stay open. Therapy works the same way: the frame is boringly reliable so the session can move.

---

## The cast

| Voice | Role in the fiction | Role in the software |
|---|---|---|
| **Attaché** | Bureaucracy: forms, corridors, the Baseline. | Ritual clerk. Exact questions. Does not invent the exam; does not do therapy. |
| **Detective** | Encounter: inner life, myth, confrontation. | Therapeutic conversation. Stance by stage, not lines to recite. |
| **Lumen** | Holistic chorus: interconnection, what is unsaid. | Parallel advisor. Short. Must not take the chair. |
| **Umbra** | Reductionist chorus: structure, critique, dark humor. | Parallel advisor. Short. Must not take the chair. |
| **Querent** | The person in the room. | History, dossier, this utterance. Never a field dumped into a clerk’s identity. |

The Baseline is liturgy (Voight–Kampff, Rorschach, exact lines). Therapy is not liturgy. If the Detective recites a stage script, it stops being therapy. If the Attaché invents questions, it stops being the Agency.

Lumen and Umbra are a chorus. They advise; they do not become a second detective.

---

## Four kinds of knowledge

What went wrong, when the system felt unmanageable, was **category collapse**. Four kinds of knowledge were taped into one growing system string:

| Name | Question | Belongs in |
|---|---|---|
| **Ethos** | Who is speaking? | Frozen system text (persona, handbook, question bank). |
| **Nomos** | Where are we in the building? | XState (phase, question index, visit clocks, therapy confirm). |
| **Mneme** | Who is this querent? | Dossier + real chat history (relationship, not a file dump). |
| **Kairos** | What did they just say? | This turn’s user message, plus a tiny packet of pointers. |

When those are mixed, the model cannot tell a law from a mood. It either recites procedure at someone in pain, or improvises the Baseline like small talk. Both break the spell.

Putting the whole question bank in the frozen Attaché system is thematically right: the clerk has the exam. The packet is a sticky note: *this item, now*. The server stamping the question if they skip it is also right: forms do not depend on the clerk’s mood.

The Detective uses the same pattern, but looser — a handbook of **stance** per stage, not lines to recite. That is the therapeutic version of a procedure manual: “in middle, go deeper, don’t railroad ordinary chat,” not “say paragraph 4.”

---

## The philosophical rule

1. **Ritual must be exact**, and therefore must not be trusted to the model.
2. **Encounter must be free**, and therefore must not be rewritten every turn.
3. **Memory of the person should feel like relationship**, not like a file dumped into the clerk’s identity.

Fun is not extra copy. Fun is **constraint plus permission**: dry procedure at the desk, then poetry once the file is open. If new coaching is stuffed into the prompt every turn, you get neither — just an anxious model trying to obey a novel.

---

## Four stores, not one mega-prompt

Prompt complexity is usually a sign that state is living in the wrong layer. A maintainable version of this product has four stores:

### 1. XState owns the building (**nomos**)

Phase, question index, shuffle, visit clocks, two-turn therapy confirm, attaché vs detective, whether a dossier exists. Machines should **emit facts, not markdown**.

In this repo: `api/orchestration/chatMachine.js` and the character machines under `api/agents/{attache,detective,philosophers}/`.

### 2. Frozen system text owns character and the books on the desk (**ethos**)

Persona, stage handbook, Attaché question bank. These files should not change because the querent was gone three days. Invariance is the point: you cannot accidentally change *who someone is* because a clock ticked.

In this repo: `api/prompts/{attache,detective,lumen,umbra}/`. Composer code that *loads* those files lives in `api/prompting/` — do not mix model text with assembly code.

### 3. History as real chat roles owns the relationship (**mneme**)

Models are trained on conversation. Flattening dialogue into a JSON blob or a single “Conversation history” user message is how you make a therapist forget they are in a conversation. The dossier is a sketch of the person; the thread is the relationship.

In this repo: thread events and session rows (see [`durable-user-state.md`](durable-user-state.md)). The intended shape of the LLM payload is system + alternating history + this utterance — not a recap stuffed into the persona.

### 4. A tiny packet owns this turn’s sticky note (**kairos**, pointers only)

Phase, `ask_question_id`, `existential_therapy_phase`, `greeting_mode`. Pointers, not essays. The model already has the books; it needs to know which page is open.

In this repo that slice is assembled as `llmSafeState` (`api/orchestration/buildLlmConversationState.js`). The design rule is: pass **facts**. Do not translate those facts into a new coaching essay every turn.

---

## How to decide where a change goes

Ask which kind of knowledge you are adding. Then put it in that store only.

| Temptation | Better home |
|---|---|
| “Remind the Detective they are in middle therapy, and also that the user was gone, and also here is how to greet them…” | Packet pointer + frozen handbook row. Not a new paragraph in the system string. |
| “The Attaché keeps skipping question 7.” | Server stamps the line; machine owns the index. Do not plead with the model. |
| “The Detective should know what they said last week.” | Chat history and dossier. Do not paste the file into the persona. |
| “Lumen should sound more like Lumen this turn.” | Edit `lumen_persona.md`. Do not add turn-local style coaching. |
| “We need a new Baseline item.” | `attache_questions.json` (the book) + machine index (which page). The clerk does not invent it. |
| “Therapy should go deeper now.” | Machine phase + handbook stance. Not a script. |

If a change requires editing persona, catalog, machine, *and* a per-turn essay, the categories have collapsed again. Split it until each layer has one job.

---

## What this is not

- Not a general-purpose assistant with a noir skin.
- Not a choose-your-own-adventure that the model authors as it goes.
- Not an unbounded multi-agent debate. The philosophers are a chorus; the Detective holds the room.
- Not a prompt that grows forever. Growth belongs in machines, files, and memory stores — not in another heading stuffed into the system message.

The Agency works when the desk is exact, the encounter is free, and the querent is remembered as a person. Keep those three from becoming one string.
