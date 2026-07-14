import Link from "next/link";

// User guide (`/guide`): how PDI works end to end, and what every Strategy
// Planner input variable means. Static server component — no data fetch, no
// client JS. Content mirrors the real sandbox controls and PRD §13 glossary;
// keep the ranges here in sync with sandbox/simulator-panel.tsx if they change.

export const metadata = { title: "Guide · PDI" };

export default function GuidePage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">How to use PDI</h1>
        <p className="text-body-lg text-muted">
          PDI turns your purchasing, consumption, stock and market-price data into a clear
          buy-or-wait call for each material — with the reasoning shown. You always decide;
          nothing is ever bought automatically. This guide explains the weekly workflow and
          every input in the Strategy Planner.
        </p>
      </header>

      <TableOfContents />

      <Section id="workflow" title="The weekly workflow">
        <p>
          PDI runs on a simple five-step rhythm. Each week you refresh the data, let the engine
          recompute, then review and decide.
        </p>
        <ol className="space-y-3">
          <Step
            n={1}
            name="Upload"
            icon="upload_file"
            body="On the Data page, upload your SAP-export files — purchase orders, consumption, market prices and stock. PDI validates each row and flags problems before anything is committed."
          />
          <Step
            n={2}
            name="Run"
            icon="play_arrow"
            body="Trigger a run. The engine builds a 12-week demand forecast, a P10/P50/P90 price band, and a recommended play for every material — usually in about a minute."
          />
          <Step
            n={3}
            name="Review"
            icon="fact_check"
            body="Open each recommendation to see what to buy, when, how much and from whom — and the drivers behind it. The dashboard highlights the ones that need attention first."
          />
          <Step
            n={4}
            name="Decide"
            icon="gavel"
            body="Approve, override (choose a different play, with a note) or reject each recommendation. Every decision is permanent and audited — the record of who decided what, and when."
          />
          <Step
            n={5}
            name="Track"
            icon="insights"
            body="The pilot report measures every decision against an agreed market baseline, so the value the system adds is a number both sides trust."
          />
        </ol>
      </Section>

      <Section id="planner" title="The Strategy Planner (what-if sandbox)">
        <p>
          The <Link href="/sandbox" className="underline">Strategy Planner</Link> lets you ask
          &ldquo;what if?&rdquo; without changing anything. Pick a material, adjust the inputs
          below, and PDI re-runs the same optimization the real recommendation uses — then shows
          the result side by side with the system&rsquo;s current plan.
        </p>
        <Callout icon="info">
          Nothing in the planner is saved and no decision can be made here. It is a sandbox for
          testing scenarios. Real decisions happen only on the Recommendations page.
        </Callout>
      </Section>

      <Section id="inputs" title="What each input means">
        <div className="space-y-4">
          <Variable
            name="Series"
            range="pick one material × plant"
            body="Which material at which plant you are simulating. The planner defaults to the pilot series. All other inputs apply to this one series."
          />
          <Variable
            name="Forced buy quantity"
            range="0 – 5,000 MT (0 = optimizer decides)"
            body="Force PDI to buy a specific tonnage now, instead of letting the optimizer choose. Leave it at 0 to see the mathematically optimal plan; raise it to see the cost and cover impact of committing to a fixed order this week. If the forced quantity can't satisfy the cover floor, the planner shows the shortfall honestly rather than hiding it."
          />
          <Variable
            name="Lead time buffer"
            range="Aggressive (−3 days) · Standard · Conservative (+7 days)"
            body="Shifts every supplier's quoted lead time. 'Conservative' assumes deliveries arrive later than promised (a safety margin); 'Aggressive' assumes they arrive sooner. Longer lead times mean orders must be placed earlier to keep cover, which can change the play."
          />
          <Variable
            name="Price outlook shift"
            range="−20% to +20%"
            body="Stress-tests the forecast price band by shifting the whole forward outlook up or down. Positive = you expect prices to rise more than the model predicts (which favours buying now); negative = you expect them to fall. Today's spot price is never changed — only the forward view."
          />
          <Variable
            name="Min cover floor"
            range="1 – 120 days (policy default shown under the slider)"
            body="The minimum days of stock cover the plan must never fall below — the stock-out safety line. Raising it forces larger, earlier buys; lowering it frees up working capital but increases stock-out risk. Defaults to your active policy's floor."
          />
          <Variable
            name="Max supplier share"
            range="10% – 100% (policy default shown under the slider)"
            body="The most any single supplier may hold of your trailing-90-day volume, including the proposed order — the concentration limit. Lowering it forces the plan to spread orders across more suppliers; raising it allows more consolidation."
          />
        </div>
      </Section>

      <Section id="results" title="Reading the results">
        <p>Once you run a simulation, three things appear:</p>
        <div className="space-y-4">
          <Variable
            name="KPI cards"
            body="Expected cost impact (the ₹ saved or added versus buying just-in-time, shown as a P50 with a P10–P90 range), Cover after plan (days of stock the plan leaves you, against the floor), and Supply risk (Within policy, Elevated, or Infeasible)."
          />
          <Variable
            name="Prescriptive recommendation"
            body="The single play the scenario resolves to, with the drivers behind it. This is deterministic, rule-based reasoning — not generative AI. If your overrides changed the play versus the baseline, that's flagged."
          />
          <Variable
            name="Baseline vs simulated"
            body="A row-by-row comparison of the system's current plan against your scenario — play, order quantity, committed spend, cover after, expected cost impact and primary supplier — with the variance for each."
          />
        </div>
      </Section>

      <Section id="plays" title="The five plays">
        <p>Every recommendation resolves to exactly one of these:</p>
        <dl className="space-y-3">
          <Play name="BUY_NOW" body="Place an order this cycle — cover is at risk or prices are set to rise. Comes with quantity, timing and supplier." />
          <Play name="WAIT" body="Do nothing this cycle — cover is comfortable and the price outlook doesn't justify buying early. No order lines." />
          <Play name="PARTIAL_BUY" body="Buy some now, but less than a full restock — a middle path when a full buy isn't warranted or isn't feasible." />
          <Play name="SPLIT_SUPPLIERS" body="Buy now, but spread the order across suppliers to respect the concentration limit or capture a better blended price." />
          <Play name="HEDGE_LOCK" body="A recommendation to lock price via a hedge memo — advisory only. PDI never executes any financial instrument." />
        </dl>
      </Section>

      <Section id="glossary" title="Glossary">
        <dl className="space-y-3">
          <Term term="Cover (days)" def="On-hand stock plus incoming purchase-order arrivals, divided by forecast daily demand — how long before you run out at the forecast consumption rate." />
          <Term term="Price band · P10 / P50 / P90" def="A range for the future price: 10% chance below P10, 50% (median) at P50, 10% chance above P90. Always a decision band, never a single-point prediction." />
          <Term term="Coverage" def="How often, in backtesting, the actual price landed inside the P10–P90 band. PDI's honesty metric — it's shown even when unflattering." />
          <Term term="Baseline" def="The counterfactual PDI measures a plan against: buying the same volume just-in-time as it's consumed. A negative cost impact means the plan beats that baseline." />
          <Term term="Play" def="One of the five recommendation outcomes above. A recommendation is a proposal, never an order — nothing is transacted until you decide." />
          <Term term="Spread" def="The live price gap between suppliers for the same material." />
        </dl>
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <Link href="/sandbox" className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
          Open the Strategy Planner
        </Link>
        <Link href="/" className="rounded border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-alt">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

const SECTIONS = [
  ["workflow", "The weekly workflow"],
  ["planner", "The Strategy Planner"],
  ["inputs", "What each input means"],
  ["results", "Reading the results"],
  ["plays", "The five plays"],
  ["glossary", "Glossary"],
] as const;

function TableOfContents() {
  return (
    <nav className="rounded-xl border border-border bg-surface-alt p-4" aria-label="On this page">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {SECTIONS.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-sm text-secondary underline-offset-2 hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="space-y-4 text-sm text-muted [&_p]:leading-relaxed">{children}</div>
    </section>
  );
}

function Step({ n, name, icon, body }: { n: number; name: string; icon: string; body: string }) {
  return (
    <li className="flex gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-ink">
          {n}. {name}
        </p>
        <p>{body}</p>
      </div>
    </li>
  );
}

function Variable({ name, range, body }: { name: string; range?: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink">{name}</p>
        {range ? (
          <span className="rounded bg-surface-alt px-2 py-0.5 text-xs font-medium text-muted">
            {range}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

function Play({ name, body }: { name: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:gap-4">
      <dt className="w-40 flex-shrink-0 font-mono text-xs font-semibold uppercase tracking-wide text-primary">
        {name}
      </dt>
      <dd className="text-sm text-muted">{body}</dd>
    </div>
  );
}

function Term({ term, def }: { term: string; def: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-48 flex-shrink-0 font-medium text-ink">{term}</dt>
      <dd className="text-sm text-muted">{def}</dd>
    </div>
  );
}

function Callout({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-secondary bg-secondary-surface p-4">
      <span className="material-symbols-outlined text-[20px] text-secondary" aria-hidden="true">
        {icon}
      </span>
      <p className="text-sm text-ink">{children}</p>
    </div>
  );
}
