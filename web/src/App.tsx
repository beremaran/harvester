import {
  ArrowUpRight,
  Bot,
  Code2,
  FileCode2,
  Globe2,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Network,
  PanelTop,
  Play,
  Server,
  ShieldCheck,
  TerminalSquare,
  TimerReset,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ResultView,
  type ResultTab,
} from "@/components/ResultView";
import {
  checkRendererHealth,
  requestBotCheck,
  requestRender,
} from "@/api/renderer-client";
import { BotCheckView } from "@/components/BotCheckView";
import {
  BOT_CHECKS,
  type BotCheckId,
  type BotCheckResult,
} from "@/domain/bot-checks";
import {
  addToRenderHistory,
  buildPreviewHtml,
  formatHistoryTime,
  validateRenderUrl,
  type RenderHistoryItem,
  type RenderResult,
} from "@/domain/rendering";
import { cn } from "@/lib/utils";

const SAMPLE_URLS = [
  { label: "Example", url: "https://example.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "MDN", url: "https://developer.mozilla.org" },
];

function App() {
  const [url, setUrl] = useState("https://example.com");
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [proxyServer, setProxyServer] = useState("");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>("preview");
  const [copied, setCopied] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [history, setHistory] = useState<RenderHistoryItem[]>([]);
  const [botChecks, setBotChecks] = useState<
    Partial<Record<BotCheckId, BotCheckResult>>
  >({});
  const [botCheckErrors, setBotCheckErrors] = useState<
    Partial<Record<BotCheckId, string>>
  >({});
  const [loadingBotCheck, setLoadingBotCheck] = useState<BotCheckId | null>(
    null,
  );
  const [activePreset, setActivePreset] = useState<BotCheckId | null>(null);

  useEffect(() => {
    void checkRendererHealth().then(setApiOnline);
  }, []);

  const previewHtml = useMemo(
    () => (result ? buildPreviewHtml(result) : ""),
    [result],
  );

  async function render(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setActivePreset(null);

    try {
      validateRenderUrl(url);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Enter a valid URL.",
      );
      return;
    }

    setIsLoading(true);
    try {
      const proxy = proxyServer.trim();
      const next = await requestRender({
        url,
        timeoutMs,
        screenshot: includeScreenshot,
        // Left out entirely when blank, so the server's own proxy setting
        // stays in charge.
        ...(proxy ? { proxy: { server: proxy } } : {}),
      });
      setResult(next);
      setActiveTab("preview");
      setApiOnline(true);
      setHistory((items) => addToRenderHistory(items, next));
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : "Could not reach the renderer.",
      );
      setApiOnline(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyHtml() {
    if (!result) return;
    await navigator.clipboard.writeText(result.html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function runBotCheck(id: BotCheckId) {
    setLoadingBotCheck(id);
    setBotCheckErrors((errors) => ({ ...errors, [id]: undefined }));

    try {
      const body = await requestBotCheck(id);
      setBotChecks((checks) => ({
        ...checks,
        [id]: body,
      }));
      setApiOnline(true);
    } catch (checkError) {
      setBotCheckErrors((errors) => ({
        ...errors,
        [id]:
          checkError instanceof Error
            ? checkError.message
            : "Could not run this bot check.",
      }));
    } finally {
      setLoadingBotCheck((current) => (current === id ? null : current));
    }
  }

  function selectPreset(id: BotCheckId) {
    setActivePreset(id);
    const preset = BOT_CHECKS.find((check) => check.id === id);
    if (preset) {
      setUrl(preset.url);
      setError(null);
    }
    if (!botChecks[id] && loadingBotCheck !== id) {
      void runBotCheck(id);
    }
  }

  function useHistoryItem(item: RenderHistoryItem) {
    setUrl(item.url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Harvester home">
          <span className="brand-mark">
            <PanelTop size={18} strokeWidth={2.2} />
          </span>
          <span>Harvester</span>
          <span className="brand-divider" />
          <span className="brand-product">Render playground</span>
        </a>

        <nav className="preset-bar" aria-label="Bot check presets">
          <span className="preset-label">
            <Bot size={14} /> Presets
          </span>
          {BOT_CHECKS.map((check) => (
            <button
              type="button"
              key={check.id}
              className={cn(
                "preset-button",
                activePreset === check.id && "selected",
              )}
              aria-pressed={activePreset === check.id}
              title={check.description}
              onClick={() => selectPreset(check.id)}
            >
              {loadingBotCheck === check.id ? (
                <LoaderCircle className="spin" size={13} />
              ) : null}
              {check.shortLabel}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <Badge
            variant={
              apiOnline === null
                ? "outline"
                : apiOnline
                  ? "success"
                  : "danger"
            }
          >
            <span className="status-dot" />
            {apiOnline === null
              ? "Checking API"
              : apiOnline
                ? "Renderer online"
                : "Renderer offline"}
          </Badge>
          <a
            className="docs-link"
            href="/health"
            target="_blank"
            rel="noreferrer"
          >
            API health <ArrowUpRight size={14} />
          </a>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <p className="eyebrow">New request</p>
            <h1>Render a page</h1>
            <p>Load any public page in a clean browser session.</p>
          </div>

          <form onSubmit={render} className="render-form">
            <div className="field-group">
              <label htmlFor="url">Page URL</label>
              <div className="url-input-wrap">
                <Globe2 size={16} />
                <Input
                  id="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="sample-list" aria-label="Sample sites">
                {SAMPLE_URLS.map((sample) => (
                  <button
                    type="button"
                    key={sample.url}
                    onClick={() => setUrl(sample.url)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <div className="label-row">
                <label>Timeout</label>
                <span>{timeoutMs / 1000} seconds</span>
              </div>
              <div className="timeout-options">
                {[10_000, 30_000, 60_000].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={cn(timeoutMs === value && "selected")}
                    onClick={() => setTimeoutMs(value)}
                  >
                    {value / 1000}s
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <div className="label-row">
                <label htmlFor="proxy">Proxy</label>
                <span>{proxyServer.trim() ? "This render" : "Server default"}</span>
              </div>
              <div className="url-input-wrap">
                <Network size={16} />
                <Input
                  id="proxy"
                  value={proxyServer}
                  onChange={(event) => setProxyServer(event.target.value)}
                  placeholder="http://user:pass@proxy.example:3128"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="option-card">
              <span className="option-icon">
                <ImageIcon size={17} />
              </span>
              <div>
                <label htmlFor="screenshot-switch">Full-page screenshot</label>
                <p>Add a visual capture to the response.</p>
              </div>
              <Switch
                id="screenshot-switch"
                checked={includeScreenshot}
                onCheckedChange={setIncludeScreenshot}
                aria-label="Include full-page screenshot"
              />
            </div>

            {error && (
              <div className="error-message" role="alert">
                <TerminalSquare size={16} />
                <span>{error}</span>
              </div>
            )}

            <Button className="render-button" type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <LoaderCircle className="spin" size={17} /> Rendering page
                </>
              ) : (
                <>
                  <Play size={16} fill="currentColor" /> Run render
                </>
              )}
            </Button>
            <p className="keyboard-hint">
              <kbd>Enter</kbd> to run this request
            </p>
          </form>

          <div className="api-note">
            <Server size={16} />
            <p>
              Sends a <code>POST</code> request to <code>/render</code>
            </p>
          </div>

          {history.length > 0 && (
            <section className="history-section">
              <div className="history-title">
                <span>
                  <History size={15} /> Recent
                </span>
                <button type="button" onClick={() => setHistory([])}>
                  <Trash2 size={13} /> Clear
                </button>
              </div>
              <div className="history-list">
                {history.map((item) => (
                  <button
                    type="button"
                    key={item.url}
                    className="history-item"
                    onClick={() => useHistoryItem(item)}
                  >
                    <span className="history-favicon">
                      {new URL(item.url).hostname.charAt(0).toUpperCase()}
                    </span>
                    <span className="history-copy">
                      <strong>{item.title}</strong>
                      <small>{formatHistoryTime(item.renderedAt)}</small>
                    </span>
                    <span className="history-duration">{item.durationMs}ms</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <section className="result-panel">
          {activePreset ? (
            <BotCheckView
              definition={
                BOT_CHECKS.find((check) => check.id === activePreset) ??
                BOT_CHECKS[0]
              }
              result={botChecks[activePreset]}
              error={botCheckErrors[activePreset]}
              isLoading={loadingBotCheck === activePreset}
              onRun={() => void runBotCheck(activePreset)}
            />
          ) : result ? (
            <ResultView
              result={result}
              previewHtml={previewHtml}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onCopy={copyHtml}
              copied={copied}
              onRerun={() => void render()}
              isLoading={isLoading}
            />
          ) : (
            <EmptyState isLoading={isLoading} />
          )}
        </section>
      </main>
    </div>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="empty-state">
      <div className="empty-toolbar">
        <div className="empty-tabs">
          <span className="active" />
          <span />
          <span />
        </div>
        <span />
      </div>
      <div className="empty-content">
        <div className={cn("empty-illustration", isLoading && "is-loading")}>
          <div className="browser-frame">
            <div className="browser-frame-top">
              <i />
              <i />
              <i />
              <span />
            </div>
            <div className="browser-frame-body">
              <Globe2 size={30} />
              <span />
              <span />
            </div>
          </div>
          <div className="signal-card">
            {isLoading ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <Code2 size={20} />
            )}
          </div>
        </div>
        <h2>{isLoading ? "Rendering your page…" : "Your render will show here"}</h2>
        <p>
          {isLoading
            ? "Starting a clean browser and waiting for the page to settle."
            : "Enter a URL, tune the request, and run your first render."}
        </p>
        <div className="empty-features">
          <span>
            <ShieldCheck size={14} /> Clean browser
          </span>
          <span>
            <TimerReset size={14} /> Network idle
          </span>
          <span>
            <FileCode2 size={14} /> Full HTML
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;
