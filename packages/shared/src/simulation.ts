import { z } from "zod";
import type { Play } from "./decision";

// F10 scenario simulation input (POST /api/simulate). Bounds mirror the engine's
// pydantic SimulateOverrides (services/engine/src/pdi_engine/api/simulate.py) —
// keep the two in lockstep. All overrides optional; an empty overrides object is
// a valid "re-run baseline" simulation.

export const simulateInputSchema = z.object({
  materialCode: z.string().min(1).max(64),
  plantCode: z.string().min(1).max(64),
  overrides: z
    .object({
      forcedQtyMt: z.number().positive().max(100_000).optional(),
      leadTimeBufferDays: z.number().int().min(-14).max(30).optional(),
      priceShiftPct: z.number().min(-20).max(20).optional(),
      minCoverDays: z.number().int().min(1).max(120).optional(),
      maxSupplierSharePct: z.number().min(1).max(100).optional(),
      wcCapInr: z.number().int().min(0).optional(),
    })
    .default({}),
});

export type SimulateInput = z.infer<typeof simulateInputSchema>;

// Result shape as returned by the engine (camelCase, mirrors the stored E13
// recommendation shape for baseline/simulated). Typed loosely on purpose: the
// web app renders these fields, it never recomputes them.

export interface SimulatedOrderLine {
  supplierCode: string;
  qtyMt: number;
  targetWeek: string;
  estPriceInrMt: number;
}

export interface SimulatedImpact {
  costDeltaInr: number;
  costDeltaP10Inr: number;
  costDeltaP90Inr: number;
  wcDeltaInr: number;
  coverAfterDays: number;
}

export interface SimulatedPlan {
  materialCode: string;
  plantCode: string;
  play: Play | null;
  orderLines: SimulatedOrderLine[];
  expectedImpact: SimulatedImpact | null;
  rationale: Record<string, unknown> | null;
  status: "PENDING" | "ERROR";
  error?: { code: string };
  constraintCheck?: {
    ok: boolean;
    coverViolations: Record<string, unknown>[];
    shareViolations: Record<string, unknown>[];
  };
}

export interface SimulateResult {
  baseline: SimulatedPlan;
  simulated: SimulatedPlan;
  deltas: {
    costDeltaInr: number;
    wcDeltaInr: number;
    coverAfterDays: number;
    playChanged: boolean;
  } | null;
  overridesApplied: Record<string, unknown>;
  policy: {
    minCoverDays: number;
    targetCoverDays: number;
    maxSupplierSharePct: number;
    wcCapInr: number | null;
  };
}
