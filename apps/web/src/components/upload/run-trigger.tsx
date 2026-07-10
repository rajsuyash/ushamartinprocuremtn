"use client";

import { useEffect, useRef, useState } from "react";
import type { Envelope } from "@pdi/shared";

type RunStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

interface RunWarning {
  code: string;
  stage?: string;
  detail?: string;
}

interface RunView {
  id: string;
  status: RunStatus;
  warnings: RunWarning[];
}

const POLL_MS = 2000;

// Trigger button + polling status pill (F2-AC3/F2-ERR4 UI half). POST /api/runs,
// then poll GET /api/runs/:id every 2s until DONE/FAILED; stop on unmount too.
export function RunTrigger() {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling(): void {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Stop polling if the component unmounts mid-run.
  useEffect(() => stopPolling, []);

  async function pollOnce(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/runs/${id}`);
      const body = (await res.json()) as Envelope<{ run: RunView }>;
      if (!body.success) return;
      setRun(body.data.run);
      if (body.data.run.status === "DONE" || body.data.run.status === "FAILED") {
        stopPolling();
      }
    } catch {
      // Transient network blip — the next 2s tick retries; self-healing.
    }
  }

  function startPolling(id: string): void {
    stopPolling();
    void pollOnce(id);
    timerRef.current = setInterval(() => void pollOnce(id), POLL_MS);
  }

  async function trigger(): Promise<void> {
    setMessage(null);
    setTriggering(true);
    try {
      const res = await fetch("/api/runs", { method: "POST" });
      const body = (await res.json()) as Envelope<{ runId: string }>;
      if (!body.success) {
        if (body.error.code === "RUN_IN_PROGRESS") {
          // The 409 envelope carries no runId. If this session already triggered
          // one, keep reflecting its status; otherwise there is nothing to poll.
          if (runId) {
            startPolling(runId);
          } else {
            setMessage("A run is already in progress.");
          }
        } else {
          setMessage(`${body.error.code}: ${body.error.message}`);
        }
        return;
      }
      setRunId(body.data.runId);
      setRun(null);
      startPolling(body.data.runId);
    } catch {
      setMessage("Could not start the run — network error.");
    } finally {
      setTriggering(false);
    }
  }

  const isInFlight = run?.status === "QUEUED" || run?.status === "RUNNING";
  const failure = run?.status === "FAILED" ? run.warnings[0] : undefined;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        data-action="trigger-run"
        disabled={triggering || isInFlight}
        onClick={() => void trigger()}
        className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        Trigger run
      </button>

      {run ? (
        <span
          data-testid="run-status"
          className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
        >
          {run.status}
        </span>
      ) : message ? (
        <span data-testid="run-status" className="text-xs text-gray-500">
          {message}
        </span>
      ) : null}

      {run?.status === "FAILED" ? (
        <>
          <span className="text-xs text-red-700">
            {failure?.code ?? "ENGINE_UNAVAILABLE"}
          </span>
          <button
            type="button"
            data-action="retry-run"
            onClick={() => void trigger()}
            className="rounded border border-gray-400 px-3 py-1 text-xs"
          >
            Retry
          </button>
        </>
      ) : null}
    </div>
  );
}
