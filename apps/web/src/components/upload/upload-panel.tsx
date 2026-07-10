"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useRouter } from "next/navigation";
import type { Envelope, FileType, RowError } from "@pdi/shared";

// Mirrors MAX_UPLOAD_BYTES in apps/web/src/lib/staging.ts (F2-ERR3). Kept as its
// own literal rather than importing staging.ts here: that module pulls in the db
// client and server-only ingest parsers, which have no business in a client bundle.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const FILE_TYPES: ReadonlyArray<{ value: FileType; label: string }> = [
  { value: "purchase_orders", label: "Purchase orders" },
  { value: "consumption", label: "Consumption" },
  { value: "market_prices", label: "Market prices" },
  { value: "inventory", label: "Inventory" },
];

interface StageResult {
  batchId: string;
  type: FileType;
  rows: number;
  validRows: number;
  errors: RowError[];
}

interface CommitResult {
  inserted: number;
  skippedDuplicates: number;
}

type Phase = "idle" | "uploading" | "staged" | "committing" | "committed";

// Upload flow: type selector + drop zone → POST /api/uploads → staged banner with
// a row-error table when errors[] is non-empty → commit (or commit-valid-only after
// a 409 BLOCKING_ROW_ERRORS) → dataset status card refresh (F2-AC1, F2-ERR2, F2-ERR3).
export function UploadPanel() {
  const router = useRouter();
  const [type, setType] = useState<FileType>("consumption");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<StageResult | null>(null);
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [blockingErrors, setBlockingErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "uploading" || phase === "committing";

  async function upload(file: File): Promise<void> {
    setError(null);
    setCommit(null);
    setBlockingErrors(false);

    if (file.size > MAX_UPLOAD_BYTES) {
      // F2-ERR3 client-side pre-check: never opens the request, so there is no
      // spinner to hang and nothing to disable in the first place.
      setError("FILE_TOO_LARGE: File exceeds the 20 MB limit.");
      return;
    }

    setPhase("uploading");
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);

    try {
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const body = (await res.json()) as Envelope<StageResult>;
      if (!body.success) {
        setError(`${body.error.code}: ${body.error.message}`);
        setPhase("idle");
        return;
      }
      setStage(body.data);
      setPhase("staged");
    } catch {
      setError("Upload failed — network error.");
      setPhase("idle");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  }

  async function doCommit(mode?: "valid-only"): Promise<void> {
    if (!stage) return;
    setError(null);
    setPhase("committing");
    try {
      const res = await fetch(`/api/uploads/${stage.batchId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode ? { mode } : {}),
      });
      const body = (await res.json()) as Envelope<CommitResult>;
      if (!body.success) {
        if (body.error.code === "BLOCKING_ROW_ERRORS") {
          setBlockingErrors(true);
          setPhase("staged");
          return;
        }
        setError(`${body.error.code}: ${body.error.message}`);
        setPhase("staged");
        return;
      }
      setCommit(body.data);
      setPhase("committed");
      router.refresh(); // F2-AC1: dataset status card re-reads committed counts server-side.
    } catch {
      setError("Commit failed — network error.");
      setPhase("staged");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="upload-type" className="text-sm text-gray-500">
          File type
        </label>
        <select
          id="upload-type"
          value={type}
          disabled={busy}
          onChange={(e) => setType(e.target.value as FileType)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {FILE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div
        data-testid="upload-drop"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-6 py-8 text-center text-sm text-gray-500 ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300"
        } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <p>
          Drop a {FILE_TYPES.find((t) => t.value === type)?.label} file here, or
          click to browse.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          disabled={busy}
          onChange={onFileInput}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      {stage ? (
        <div className="space-y-2 rounded border border-gray-200 p-3 text-sm">
          <p>
            Staged batch <span className="font-mono">{stage.batchId}</span> —{" "}
            {stage.validRows}/{stage.rows} rows valid.
          </p>

          {stage.errors.length > 0 ? (
            <div className="max-h-48 overflow-auto rounded border border-amber-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-amber-50 text-amber-800">
                  <tr>
                    <th className="px-2 py-1">Row</th>
                    <th className="px-2 py-1">Code</th>
                    <th className="px-2 py-1">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {stage.errors.map((e, i) => (
                    <tr
                      key={`${e.row}-${e.code}-${i}`}
                      className="border-t border-amber-100"
                    >
                      <td className="px-2 py-1">{e.row}</td>
                      <td className="px-2 py-1 font-mono">{e.code}</td>
                      <td className="px-2 py-1">{e.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {phase === "committed" && commit ? (
            <p className="text-green-700">
              Committed: {commit.inserted} inserted, {commit.skippedDuplicates}{" "}
              duplicates skipped.
            </p>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                data-action="commit-batch"
                disabled={busy}
                onClick={() => void doCommit()}
                className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Commit
              </button>
              {blockingErrors ? (
                <button
                  type="button"
                  data-action="commit-valid-only"
                  disabled={busy}
                  onClick={() => void doCommit("valid-only")}
                  className="rounded border border-gray-400 px-3 py-1 text-sm disabled:opacity-50"
                >
                  Commit valid rows only
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
