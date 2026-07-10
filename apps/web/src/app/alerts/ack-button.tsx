"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Envelope } from "@pdi/shared";

// Client ack button (F7-AC2 happy path, F7-ERR1 409 toast). Mirrors the
// disable-on-click + router.refresh pattern of recommendations/[id]/decision-bar.tsx,
// but has no modal — a single confirm-free action per the PRD route contract
// (POST /api/alerts/:id/ack, 200/409, no request body).

interface AckButtonProps {
  alertId: string;
}

type Phase = "idle" | "submitting" | "failed";

interface AckResponseData {
  alert: { ackedByEmail: string };
}

export function AckButton({ alertId }: AckButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  async function ack(): Promise<void> {
    setPhase("submitting");
    setNotice(null);

    try {
      const res = await fetch(`/api/alerts/${alertId}/ack`, { method: "POST" });
      const envelope = (await res.json()) as Envelope<AckResponseData>;

      if (!envelope.success) {
        setNotice(
          envelope.error.code === "ALREADY_ACKED"
            ? envelope.error.message
            : `${envelope.error.code}: ${envelope.error.message}`,
        );
        setPhase("failed");
        router.refresh();
        return;
      }

      router.refresh();
    } catch {
      setNotice("Couldn't acknowledge — retry");
      setPhase("failed");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {notice ? (
        <p role="alert" data-testid="ack-error" className="text-xs text-amber-800">
          {notice}
        </p>
      ) : null}
      <button
        type="button"
        data-action="ack-alert"
        disabled={phase === "submitting"}
        onClick={() => void ack()}
        className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-50"
      >
        {phase === "submitting" ? "Acknowledging…" : "Acknowledge"}
      </button>
    </div>
  );
}
