import {
  ArrowUpRight,
  Braces,
  Check,
  Clock3,
  Cookie,
  Copy,
  ExternalLink,
  FileCode2,
  Fingerprint,
  Gauge,
  PanelTop,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { ScraperView } from "@/components/ScraperView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDocumentSize,
  highlightHtml,
  type RenderResult,
} from "@/domain/rendering";
import { cn } from "@/lib/utils";

export type ResultTab =
  | "preview"
  | "html"
  | "headers"
  | "cookies"
  | "scraper";

interface ResultViewProps {
  result: RenderResult;
  previewHtml: string;
  activeTab: ResultTab;
  setActiveTab: (tab: ResultTab) => void;
  onCopy: () => void;
  copied: boolean;
  onRerun: () => void;
  isLoading: boolean;
}

export function ResultView({
  result,
  previewHtml,
  activeTab,
  setActiveTab,
  onCopy,
  copied,
  onRerun,
  isLoading,
}: ResultViewProps) {
  const tabs: {
    id: ResultTab;
    label: string;
    icon: ReactNode;
    count?: number;
  }[] = [
    { id: "preview", label: "Preview", icon: <PanelTop size={15} /> },
    { id: "html", label: "HTML", icon: <Braces size={15} /> },
    {
      id: "headers",
      label: "Headers",
      icon: <Gauge size={15} />,
      count: Object.keys(result.requestHeaders).length,
    },
    {
      id: "cookies",
      label: "Cookies",
      icon: <Cookie size={15} />,
      count: result.cookies.length,
    },
    { id: "scraper", label: "Scraper", icon: <Fingerprint size={15} /> },
  ];

  return (
    <div className="result-view">
      <div className="result-header">
        <div className="result-heading">
          <div className="site-icon">
            {new URL(result.finalUrl).hostname.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="title-row">
              <h2>{result.title || "Untitled page"}</h2>
              <Badge
                variant={
                  result.status >= 200 && result.status < 400
                    ? "success"
                    : "danger"
                }
              >
                {result.status}
              </Badge>
            </div>
            <a href={result.finalUrl} target="_blank" rel="noreferrer">
              {result.finalUrl} <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <div className="result-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={onRerun}
            disabled={isLoading}
          >
            <RotateCcw className={cn(isLoading && "spin")} size={14} />
            Re-run
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={result.finalUrl} target="_blank" rel="noreferrer">
              Open page <ArrowUpRight size={14} />
            </a>
          </Button>
        </div>
      </div>

      <div className="metrics-row">
        <Metric icon={<Clock3 size={16} />} label="Render time">
          {result.durationMs.toLocaleString()} ms
        </Metric>
        <Metric icon={<FileCode2 size={16} />} label="Document">
          {formatDocumentSize(result.html)}
        </Metric>
        <Metric icon={<Gauge size={16} />} label="Status">
          {result.status >= 200 && result.status < 300
            ? "Successful"
            : "Finished"}
        </Metric>
        <Metric icon={<Cookie size={16} />} label="Cookies">
          {result.cookies.length}
        </Metric>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Render output">
        <div className="tab-list">
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && <span>{tab.count}</span>}
            </button>
          ))}
        </div>
        {activeTab === "html" && (
          <Button variant="ghost" size="sm" onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy HTML"}
          </Button>
        )}
      </div>

      <div className="tab-content">
        {activeTab === "preview" && (
          <div className="preview-pane">
            <div className="browser-chrome">
              <div className="window-controls">
                <i />
                <i />
                <i />
              </div>
              <div className="address-bar">
                <ShieldCheck size={13} />
                <span>{result.finalUrl}</span>
              </div>
              <a href={result.finalUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
              </a>
            </div>
            {result.screenshot ? (
              <div className="screenshot-wrap">
                <img
                  src={`data:image/png;base64,${result.screenshot}`}
                  alt={`Full-page screenshot of ${result.title}`}
                />
              </div>
            ) : (
              <iframe
                title={`Preview of ${result.title}`}
                srcDoc={previewHtml}
                sandbox=""
              />
            )}
          </div>
        )}

        {activeTab === "html" && (
          <pre className="code-pane">
            <code
              dangerouslySetInnerHTML={{
                __html: highlightHtml(result.html),
              }}
            />
          </pre>
        )}

        {activeTab === "headers" && (
          <DataTable
            empty="No request headers were captured."
            rows={Object.entries(result.requestHeaders)}
          />
        )}

        {activeTab === "cookies" && <CookieTable result={result} />}

        {activeTab === "scraper" && <ScraperView scraper={result.scraper} />}
      </div>
    </div>
  );
}

function CookieTable({ result }: { result: RenderResult }) {
  if (!result.cookies.length) {
    return (
      <div className="table-empty">
        <Cookie size={22} />
        <p>No cookies were set by this page.</p>
      </div>
    );
  }

  return (
    <div className="cookie-table">
      <div className="cookie-head">
        <span>Name</span>
        <span>Domain</span>
        <span>Value</span>
        <span>Flags</span>
      </div>
      {result.cookies.map((cookie) => (
        <div
          className="cookie-row"
          key={`${cookie.domain}-${cookie.path}-${cookie.name}`}
        >
          <code>{cookie.name}</code>
          <span>{cookie.domain}</span>
          <span className="truncate-value">{cookie.value}</span>
          <span className="cookie-flags">
            {cookie.httpOnly && <Badge variant="outline">HTTP only</Badge>}
            {cookie.secure && <Badge variant="outline">Secure</Badge>}
            <Badge variant="outline">{cookie.sameSite}</Badge>
          </span>
        </div>
      ))}
    </div>
  );
}

function Metric({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{children}</strong>
      </div>
    </div>
  );
}

function DataTable({
  rows,
  empty,
}: {
  rows: [string, string][];
  empty: string;
}) {
  if (!rows.length) {
    return <div className="table-empty">{empty}</div>;
  }

  return (
    <div className="data-table">
      {rows.map(([key, value]) => (
        <div className="data-row" key={key}>
          <code>{key}</code>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
