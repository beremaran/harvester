import {
  Check,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  ShieldQuestion,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  type BotCheckDefinition,
  type BotCheckResult,
  type BotCheckStatus,
} from "@/domain/bot-checks";
import { cn } from "@/lib/utils";

interface BotCheckViewProps {
  definition: BotCheckDefinition;
  result?: BotCheckResult;
  error?: string;
  isLoading: boolean;
  onRun: () => void;
}

export function BotCheckView({
  definition,
  result,
  error,
  isLoading,
  onRun,
}: BotCheckViewProps) {
  const counts = result?.evaluations.reduce(
    (total, evaluation) => {
      total[evaluation.status] += 1;
      return total;
    },
    { pass: 0, fail: 0, warn: 0, info: 0 } satisfies Record<
      BotCheckStatus,
      number
    >,
  );

  return (
    <div className="bot-check-pane">
      <div className="bot-check-toolbar">
        <div>
          <p className="eyebrow">Preset</p>
          <h3>{definition.label}</h3>
          <p>{definition.description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRun} disabled={isLoading}>
          <RotateCcw className={cn(isLoading && "spin")} size={14} />
          {result ? "Run again" : isLoading ? "Running" : "Run check"}
        </Button>
      </div>

      {isLoading && !result && (
        <div className="bot-check-loading">
          <LoaderCircle className="spin" size={22} />
          <strong>Running {definition.shortLabel}</strong>
          <span>This can take a few seconds.</span>
        </div>
      )}

      {error && !result && (
        <div className="bot-check-loading is-error">
          <ShieldQuestion size={22} />
          <strong>The check did not finish</strong>
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={onRun}>
            Try again
          </Button>
        </div>
      )}

      {result && (
        <>
          <div className="bot-summary">
            <StatusCount status="pass" count={counts?.pass ?? 0} />
            <StatusCount status="fail" count={counts?.fail ?? 0} />
            <StatusCount status="warn" count={counts?.warn ?? 0} />
            <div className="bot-run-meta">
              <span>{result.durationMs.toLocaleString()} ms</span>
              <span>{new Date(result.checkedAt).toLocaleTimeString()}</span>
              <a href={result.url} target="_blank" rel="noreferrer">
                Open source <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {error && (
            <div className="bot-refresh-error" role="alert">
              The last refresh failed: {error}
            </div>
          )}

          <div className="bot-check-grid">
            <div className="evaluation-list">
              {result.evaluations.map((evaluation, index) => (
                <div
                  className="evaluation-row"
                  key={`${evaluation.name}-${index}`}
                >
                  <StatusBadge status={evaluation.status} />
                  <div>
                    <strong>{evaluation.name}</strong>
                    {evaluation.value && <code>{evaluation.value}</code>}
                    {evaluation.note && <p>{evaluation.note}</p>}
                  </div>
                </div>
              ))}
            </div>
            <div className="bot-screenshot">
              <div>
                <span>Page capture</span>
                {isLoading && <LoaderCircle className="spin" size={13} />}
              </div>
              <img
                src={`data:image/png;base64,${result.screenshot}`}
                alt={`${definition.label} results`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusCount({
  status,
  count,
}: {
  status: Exclude<BotCheckStatus, "info">;
  count: number;
}) {
  return (
    <div className={cn("status-count", `is-${status}`)}>
      <strong>{count}</strong>
      <span>{status}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: BotCheckStatus }) {
  return (
    <span className={cn("evaluation-status", `is-${status}`)}>
      {status === "pass" && <Check size={12} />}
      {status === "fail" && "!"}
      {status === "warn" && "•"}
      {status === "info" && "i"}
      {status}
    </span>
  );
}
