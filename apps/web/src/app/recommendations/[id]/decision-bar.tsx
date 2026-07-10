"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionActionInput, Envelope, Play } from "@pdi/shared";
import { DECISION_NOTE_MIN_LENGTH, PLAYS } from "@pdi/shared";

import { extractDecidedByEmail, isNoteValid } from "./decision-logic";

// Client decision bar (F6 happy path + F6-ERR1/ERR2/ERR3). Mounted into the
// `[data-testid="decision-bar-slot"]` seam on the (server) detail page, which
// re-renders the status chip/audit line/override comparison from the DB after
// every `router.refresh()` — this component never renders decided-state itself.

const SUBMIT_TIMEOUT_MS = 10_000;

interface DecisionBarProps {
  recommendationId: string;
  status: string;
  play: string | null;
}

interface DecisionResponseData {
  decision: { id: string };
  status: string;
}

type Phase = "idle" | "submitting" | "failed";

const ACTION_LABEL: Record<DecisionActionInput, string> = {
  APPROVE: "Approve",
  OVERRIDE: "Override",
  REJECT: "Reject",
};

export function DecisionBar({ recommendationId, status, play }: DecisionBarProps) {
  const router = useRouter();
  const [openAction, setOpenAction] = useState<DecisionActionInput | null>(null);
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [overridePlay, setOverridePlay] = useState<Play>("WAIT");
  const [phase, setPhase] = useState<Phase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  // Generated once per modal-open, reused across retries (F6-ERR3 idempotent retry).
  const idempotencyKeyRef = useRef<string>("");

  const showActions = status === "PENDING" && !decided;
  const noteValid = openAction ? isNoteValid(openAction, note) : true;

  function openModal(action: DecisionActionInput): void {
    idempotencyKeyRef.current = crypto.randomUUID();
    setOpenAction(action);
    setNote("");
    setNoteTouched(false);
    setOverridePlay("WAIT");
    setPhase("idle");
    setSubmitError(null);
  }

  function closeModal(): void {
    setOpenAction(null);
    setPhase("idle");
    setSubmitError(null);
  }

  async function submit(): Promise<void> {
    if (!openAction) return;
    if (!isNoteValid(openAction, note)) {
      setNoteTouched(true);
      return;
    }

    setPhase("submitting");
    setSubmitError(null);

    const body: Record<string, unknown> = {
      action: openAction,
      note,
      idempotencyKey: idempotencyKeyRef.current,
    };
    if (openAction === "OVERRIDE") body.override = { play: overridePlay };

    try {
      const res = await fetch(`/api/recommendations/${recommendationId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      const envelope = (await res.json()) as Envelope<DecisionResponseData>;

      if (!envelope.success) {
        if (envelope.error.code === "ALREADY_DECIDED") {
          const email = extractDecidedByEmail(envelope.error.message) ?? "another user";
          closeModal();
          setStaleNotice(`Already decided by ${email}.`);
          router.refresh();
          return;
        }
        if (envelope.error.code === "NOTE_REQUIRED") {
          setNoteTouched(true);
          setPhase("idle");
          return;
        }
        setSubmitError(`${envelope.error.code}: ${envelope.error.message}`);
        setPhase("failed");
        return;
      }

      setDecided(true);
      setOpenAction(null);
      router.refresh();
    } catch {
      // Network failure or the 10s AbortSignal timeout — same retry-safe path
      // either way; idempotencyKeyRef is untouched so a retry replays cleanly.
      setSubmitError("Couldn't record decision — retry");
      setPhase("failed");
    }
  }

  return (
    <section data-testid="decision-bar" className="flex flex-col gap-2">
      {staleNotice ? (
        <p
          role="alert"
          data-testid="decision-stale-notice"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {staleNotice}
        </p>
      ) : null}

      {showActions ? (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              data-action="approve"
              onClick={() => openModal("APPROVE")}
              className="rounded bg-green-700 px-3 py-1 text-sm text-white"
            >
              Approve
            </button>
            <button
              type="button"
              data-action="override"
              onClick={() => openModal("OVERRIDE")}
              className="rounded bg-blue-700 px-3 py-1 text-sm text-white"
            >
              Override
            </button>
            <button
              type="button"
              data-action="reject"
              onClick={() => openModal("REJECT")}
              className="rounded bg-red-700 px-3 py-1 text-sm text-white"
            >
              Reject
            </button>
          </div>

          {openAction ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${ACTION_LABEL[openAction]} recommendation`}
              data-testid="decision-modal"
              className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
            >
              <div className="w-full max-w-md space-y-3 rounded bg-white p-4 shadow-lg">
                <h2 className="text-sm font-semibold">
                  {ACTION_LABEL[openAction]} recommendation
                </h2>

                {openAction === "OVERRIDE" ? (
                  <div className="space-y-1">
                    <label htmlFor="override-play" className="text-xs text-gray-500">
                      Replacement play (system play: {play ?? "ERROR"})
                    </label>
                    <select
                      id="override-play"
                      data-testid="override-play-select"
                      value={overridePlay}
                      disabled={phase === "submitting"}
                      onChange={(e) => setOverridePlay(e.target.value as Play)}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      {PLAYS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <label htmlFor="decision-note" className="text-xs text-gray-500">
                    Note{" "}
                    {openAction === "APPROVE"
                      ? "(optional)"
                      : `(min ${DECISION_NOTE_MIN_LENGTH} characters)`}
                  </label>
                  <textarea
                    id="decision-note"
                    data-testid="decision-note"
                    value={note}
                    disabled={phase === "submitting"}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setNoteTouched(true);
                    }}
                    rows={3}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  {noteTouched && !noteValid ? (
                    <p role="alert" data-testid="note-error" className="text-xs text-red-700">
                      A note of at least {DECISION_NOTE_MIN_LENGTH} characters is required.
                    </p>
                  ) : null}
                </div>

                {submitError ? (
                  <p role="alert" data-testid="decision-error" className="text-xs text-red-700">
                    {submitError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    data-action="cancel-decision"
                    disabled={phase === "submitting"}
                    onClick={closeModal}
                    className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-action={submitError ? "retry-decision" : "confirm-decision"}
                    disabled={phase === "submitting" || (openAction !== "APPROVE" && !noteValid)}
                    onClick={() => void submit()}
                    className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    {submitError ? "Retry" : phase === "submitting" ? "Submitting…" : "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
