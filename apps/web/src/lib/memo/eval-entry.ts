import { pathToFileURL } from "node:url";

import { generateLlmMemo, type MemoTransport } from "./client";
import { generateMemo } from "./generate";
import type { WeekAggregate } from "./aggregate";

// T34 · F9 eval entrypoint — the script `evals/run.mjs memo` shells out to (see
// `evals/memo/README.md`). Reads one FIX-4 aggregate JSON from stdin, writes the
// generated memo JSON (flattened content + mode/modelId) to stdout.
//
// `INJECT=timeout|invalid-json` forces the LLM path with a fake FAILING transport
// so the eval exercises client.ts's real retry → template fallback chain
// (F9-ERR2/ERR3) deterministically — never a real Anthropic call, never dependent
// on ANTHROPIC_API_KEY. Anything else (unset, "none") runs the normal env-gated
// `generateMemo` path, same as production (F9-ERR1: template mode with no key).

// ponytail: timeoutMs is short (200ms) purely so the eval case finishes fast; the
// fake transport's own timer is unref()'d so it never keeps the process alive
// past client.ts's own abort.
const INJECT_TIMEOUT_MS = 200;

function timeoutTransport(): MemoTransport {
  return () =>
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("unreachable")), 60_000);
      timer.unref();
    });
}

function invalidJsonTransport(): MemoTransport {
  return async () => "not valid json {{{";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  // client.ts logs one structured line per call via console.info (PRD §11
  // observability) — this script's stdout contract is "exactly one memo JSON
  // blob", so redirect that (and any stray console.log) to stderr for the
  // duration of the run rather than losing the log entirely.
  console.info = console.error;
  console.log = console.error;

  const raw = await readStdin();
  const aggregate = JSON.parse(raw) as WeekAggregate;
  const inject = process.env.INJECT;

  const result =
    inject === "timeout"
      ? await generateLlmMemo(aggregate, { transport: timeoutTransport(), timeoutMs: INJECT_TIMEOUT_MS })
      : inject === "invalid-json"
        ? await generateLlmMemo(aggregate, { transport: invalidJsonTransport() })
        : await generateMemo(aggregate);

  process.stdout.write(
    JSON.stringify({ ...result.content, mode: result.mode, modelId: result.modelId }),
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
