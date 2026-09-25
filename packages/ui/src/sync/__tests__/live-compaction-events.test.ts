/**
 * Regression: the "Context compacted" notice only appeared once the turn
 * settled, because the only input it had was the persisted `compaction` part.
 * OpenCode streams a compaction through its own lifecycle events first
 * (`session.next.compaction.started|delta|ended`), and those events reached the
 * client but nothing recorded them.
 *
 * These tests cover the lifecycle transitions in the store. How the record
 * reaches the transcript is covered by `compaction-notice-live.test.ts` in the
 * chat layer, which drives the same events into the rendered turn.
 */
import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Event, Part, Session, UserMessage } from "@opencode-ai/sdk/v2/client"

import { applyDirectoryEvent } from "../event-reducer"
import { INITIAL_STATE, type State } from "../types"

const SESSION_ID = "ses_1"
const COMPACTION_MESSAGE_ID = "msg_compact"

let eventSequence = 0
/** A unique relay id, so no test can be rescued by duplicate-event filtering. */
const eventId = () => `evt_${++eventSequence}`

const compactionStarted = (
  timestamp = 10,
  messageID = COMPACTION_MESSAGE_ID,
  reason: "auto" | "manual" = "auto",
): Event => ({
  id: eventId(),
  type: "session.next.compaction.started",
  properties: { timestamp, sessionID: SESSION_ID, messageID, reason },
})

const compactionDelta = (text: string, messageID = COMPACTION_MESSAGE_ID): Event => ({
  id: eventId(),
  type: "session.next.compaction.delta",
  properties: { timestamp: 11, sessionID: SESSION_ID, messageID, text },
})

const compactionEnded = (text: string): Event => ({
  id: eventId(),
  type: "session.next.compaction.ended",
  properties: {
    timestamp: 12,
    sessionID: SESSION_ID,
    messageID: COMPACTION_MESSAGE_ID,
    reason: "auto",
    text,
    recent: "",
  },
})

const sessionIdle = (): Event => ({
  id: eventId(),
  type: "session.idle",
  properties: { sessionID: SESSION_ID },
})

const sessionCompacted = (): Event => ({
  id: eventId(),
  type: "session.compacted",
  properties: { sessionID: SESSION_ID },
})

/** The message OpenCode persists to hold the compaction notice. */
const compactionUserMessage: UserMessage = {
  id: COMPACTION_MESSAGE_ID,
  sessionID: SESSION_ID,
  role: "user",
  time: { created: 10 },
  agent: "compaction",
  model: { providerID: "provider", modelID: "model" },
}

const compactionMessageUpdated = (): Event => ({
  id: eventId(),
  type: "message.updated",
  properties: { sessionID: SESSION_ID, info: compactionUserMessage },
})

const persistedCompactionPart: Part = {
  id: "prt_compact",
  sessionID: SESSION_ID,
  messageID: COMPACTION_MESSAGE_ID,
  type: "compaction",
  auto: true,
}

const persistedCompactionPartUpdated = (): Event => ({
  id: eventId(),
  type: "message.part.updated",
  properties: { sessionID: SESSION_ID, part: persistedCompactionPart, time: 12 },
})

const promptUserMessage: UserMessage = {
  id: "msg_user",
  sessionID: SESSION_ID,
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
}

const promptTextPart: Part = {
  id: "prt_user",
  sessionID: SESSION_ID,
  messageID: promptUserMessage.id,
  type: "text",
  text: "do the thing",
}

const answerMessage: AssistantMessage = {
  id: "msg_answer",
  sessionID: SESSION_ID,
  role: "assistant",
  time: { created: 2 },
  parentID: promptUserMessage.id,
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
}

const session: Session = {
  id: SESSION_ID,
  slug: "ses-1",
  projectID: "project",
  directory: "/repo",
  title: "session",
  version: "1",
  time: { created: 1, updated: 1 },
}

/** A session mid-turn: one prompt, one answer still streaming. */
function streamingSessionState(): State {
  return {
    ...INITIAL_STATE,
    message: { [SESSION_ID]: [promptUserMessage, answerMessage] },
    part: { [promptUserMessage.id]: [promptTextPart], [answerMessage.id]: [] },
    session_status: {},
  }
}

function apply(current: State, event: Event): State {
  const draft = { ...current }
  applyDirectoryEvent(draft, event)
  return draft
}

function applyAll(current: State, events: readonly Event[]): State {
  return events.reduce(apply, current)
}

describe("live compaction lifecycle", () => {
  test("started and its deltas accumulate before the session goes idle", () => {
    const beforeIdle = applyAll(streamingSessionState(), [
      compactionStarted(),
      compactionDelta("## Summary"),
      compactionDelta("\n\nthe history was rewritten"),
    ])

    expect(beforeIdle.live_compaction[SESSION_ID]).toEqual({
      sessionID: SESSION_ID,
      messageID: COMPACTION_MESSAGE_ID,
      reason: "auto",
      streaming: true,
      text: "## Summary\n\nthe history was rewritten",
      startedAt: 10,
    })
    // The turn has not settled: no idle status has been observed yet.
    expect(beforeIdle.session_status[SESSION_ID]).toBeUndefined()

    // session.idle is not what ends the record, and it does not take it away.
    const afterIdle = apply(beforeIdle, sessionIdle())
    expect(afterIdle.session_status[SESSION_ID]).toEqual({ type: "idle" })
    expect(afterIdle.live_compaction[SESSION_ID]?.streaming).toBe(true)
  })

  test("the persisted compaction part ends the record", () => {
    const live = applyAll(streamingSessionState(), [compactionStarted(), compactionDelta("summary so far")])
    expect(live.live_compaction[SESSION_ID]?.messageID).toBe(COMPACTION_MESSAGE_ID)

    const persisted = applyAll(live, [compactionMessageUpdated(), persistedCompactionPartUpdated()])
    expect(persisted.live_compaction[SESSION_ID]).toBeUndefined()
  })

  test("a delta without its started compaction is rejected", () => {
    const orphaned = apply(streamingSessionState(), compactionDelta("no lifecycle behind this"))

    expect(orphaned.live_compaction[SESSION_ID]).toBeUndefined()
  })

  test("a delta that arrives after the compaction ended does not reopen it", () => {
    const ended = applyAll(streamingSessionState(), [compactionStarted(), compactionEnded("the whole summary")])
    const late = apply(ended, compactionDelta("late chunk"))

    expect(late.live_compaction[SESSION_ID]).toMatchObject({ streaming: false, text: "the whole summary" })
  })

  test("the ended event replaces the streamed text with the whole summary", () => {
    const ended = applyAll(streamingSessionState(), [
      compactionStarted(10, COMPACTION_MESSAGE_ID, "manual"),
      compactionDelta("partial"),
      compactionEnded("the whole summary"),
    ])

    expect(ended.live_compaction[SESSION_ID]).toEqual({
      sessionID: SESSION_ID,
      messageID: COMPACTION_MESSAGE_ID,
      reason: "manual",
      streaming: false,
      text: "the whole summary",
      startedAt: 10,
      endedAt: 12,
    })
  })

  test("session.compacted settles the stream without inventing a summary", () => {
    const settled = applyAll(streamingSessionState(), [
      compactionStarted(),
      compactionDelta("what was streamed"),
      sessionCompacted(),
    ])

    expect(settled.live_compaction[SESSION_ID]).toMatchObject({ streaming: false, text: "what was streamed" })
  })

  test("a new compaction replaces the previous record", () => {
    const restarted = applyAll(streamingSessionState(), [
      compactionStarted(),
      compactionDelta("first"),
      compactionStarted(20, "msg_compact_2", "manual"),
    ])

    expect(restarted.live_compaction[SESSION_ID]).toEqual({
      sessionID: SESSION_ID,
      messageID: "msg_compact_2",
      reason: "manual",
      streaming: true,
      text: "",
      startedAt: 20,
    })
  })

  test("a started event for the tracked compaction is that compaction retold", () => {
    const started = compactionStarted()
    const streaming = applyAll(streamingSessionState(), [started, compactionDelta("streamed")])
    const replayed = apply(streaming, started)

    expect(replayed.live_compaction[SESSION_ID]?.text).toBe("streamed")
  })

  test("the record is dropped when the session or its message goes away", () => {
    const live = applyAll(streamingSessionState(), [compactionStarted(), compactionDelta("summary")])

    const removed = apply(live, {
      id: eventId(),
      type: "message.removed",
      properties: { sessionID: SESSION_ID, messageID: COMPACTION_MESSAGE_ID },
    })
    expect(removed.live_compaction[SESSION_ID]).toBeUndefined()

    const archived = apply(live, {
      id: eventId(),
      type: "session.deleted",
      properties: { sessionID: SESSION_ID, info: session },
    })
    expect(archived.live_compaction[SESSION_ID]).toBeUndefined()
  })

  test("the record survives the message that will hold it, until its part arrives", () => {
    const live = applyAll(streamingSessionState(), [compactionStarted(), compactionDelta("summary")])
    // The store learned about the compaction's message before its part arrived.
    // Suppressing the projection of the record is the snapshot's job, not the
    // reducer's: the persisted part is what ends it.
    const withMessage = apply(live, compactionMessageUpdated())

    expect(withMessage.message[SESSION_ID]?.map((message) => message.id)).toContain(COMPACTION_MESSAGE_ID)
    expect(withMessage.live_compaction[SESSION_ID]?.text).toBe("summary")
  })
})
