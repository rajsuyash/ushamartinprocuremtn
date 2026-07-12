"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Envelope, MemoContent } from "@pdi/shared";

import type { LatestMemo } from "./queries";

// T34 · F9 memo UI (PRD §6 F9 routes/UI + F9-ERR1 browser clause). Client component:
// button posts to the existing /api/memo (T32/T33 own generation + fallback), then
// re-renders from the response — same "render from what was returned/stored, never
// recompute" discipline as the decision bar (F6 pitfall).

const GENERATE_TIMEOUT_MS = 15_000;

interface MemoResponseData {
  memo: { id: string; mode: "LLM" | "TEMPLATE"; modelId: string | null; content: MemoContent; createdAt: string };
  mode: "LLM" | "TEMPLATE";
}

type Phase = "idle" | "generating" | "failed";

interface MemoPanelProps {
  initialMemo: LatestMemo | null;
  canGenerate: boolean;
}

export function MemoPanel({ initialMemo, canGenerate }: MemoPanelProps) {
  const router = useRouter();
  const [memo, setMemo] = useState<LatestMemo | null>(initialMemo);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/memo", {
        method: "POST",
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
      const envelope = (await res.json()) as Envelope<MemoResponseData>;
      if (!envelope.success) {
        setError(`${envelope.error.code}: ${envelope.error.message}`);
        setPhase("failed");
        return;
      }
      setMemo({
        id: envelope.data.memo.id,
        mode: envelope.data.memo.mode,
        modelId: envelope.data.memo.modelId,
        content: envelope.data.memo.content,
        createdAt: envelope.data.memo.createdAt,
      });
      setPhase("idle");
      router.refresh();
    } catch {
      setError("Couldn't generate memo — retry");
      setPhase("failed");
    }
  }

  return (
    <section className="space-y-3" data-testid="memo-section">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Weekly memo</h2>
        {canGenerate ? (
          <button
            type="button"
            data-action="generate-memo"
            disabled={phase === "generating"}
            onClick={() => void generate()}
            className="rounded bg-primary px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {phase === "generating" ? "Generating…" : "Generate memo"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" data-testid="memo-error" className="text-xs text-risk">
          {error}
        </p>
      ) : null}

      {memo ? <MemoContentView memo={memo} /> : (
        <p className="text-sm text-muted" data-testid="memo-empty">
          No memo generated yet.
        </p>
      )}
    </section>
  );
}

function MemoContentView({ memo }: { memo: LatestMemo }) {
  return (
    <div data-testid="memo-panel" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      {memo.mode === "TEMPLATE" ? (
        <p
          data-testid="memo-template-notice"
          className="inline-block rounded-full bg-warn-surface px-3 py-1 text-xs font-medium text-warn"
        >
          AI memo off — template mode
        </p>
      ) : null}

      <h3 className="text-base font-semibold" data-testid="memo-headline">
        {memo.content.headline}
      </h3>

      <p data-testid="memo-summary" className="whitespace-pre-wrap text-sm text-muted">
        {memo.content.summaryMd}
      </p>

      {memo.content.keyNumbers.length > 0 ? (
        <dl data-testid="memo-key-numbers" className="flex flex-wrap gap-4">
          {memo.content.keyNumbers.map((kn) => (
            <div key={kn.label} className="rounded bg-surface-alt px-3 py-2 text-sm">
              <dt className="text-xs text-muted">{kn.label}</dt>
              <dd className="font-medium">{kn.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {memo.content.risks.length > 0 ? (
        <ul data-testid="memo-risks" className="list-inside list-disc text-sm text-muted">
          {memo.content.risks.map((risk, i) => (
            <li key={i}>{risk}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
