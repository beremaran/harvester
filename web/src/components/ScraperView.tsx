import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScraperHandoff } from "@/domain/rendering";

/**
 * The replay kit: what a non-browser HTTP client has to send to look like the
 * session we just rendered. Everything here is copy-to-clipboard because it
 * is meant to be pasted into another tool, not read.
 */
export function ScraperView({ scraper }: { scraper: ScraperHandoff }) {
  const { tls } = scraper;

  return (
    <div className="scraper-pane">
      <div className="scraper-badges">
        <Badge variant={tls.source === "measured" ? "success" : "outline"}>
          TLS {tls.source}
        </Badge>
        <Badge variant="outline">{scraper.tlsClient.profile}</Badge>
        <Badge variant="outline">{scraper.protocol}</Badge>
        <Badge variant="outline">{tls.tlsVersion}</Badge>
        <Badge variant="outline">Chrome {tls.chromeMajorVersion}</Badge>
      </div>

      <Section
        title="tls-client request"
        hint={`POST body for ${scraper.tlsClient.library}`}
        copyValue={JSON.stringify(scraper.tlsClient.requestPayload, null, 2)}
      >
        <pre className="code-pane">
          <code>
            {JSON.stringify(scraper.tlsClient.requestPayload, null, 2)}
          </code>
        </pre>
      </Section>

      <Section
        title="curl-impersonate"
        hint="Same request from the curl-impersonate build"
        copyValue={scraper.curlImpersonate}
      >
        <pre className="code-pane wrap">
          <code>{scraper.curlImpersonate}</code>
        </pre>
      </Section>

      <Section
        title="Transport fingerprint"
        hint="What the handshake has to look like"
      >
        <div className="data-table">
          <Row label="JA4" value={tls.ja4} />
          <Row label="JA4_r" value={tls.ja4r} />
          <Row label="JA3" value={tls.ja3} />
          <Row label="JA3 hash" value={tls.ja3Hash} />
          <Row label="PeetPrint hash" value={tls.peetprintHash} />
          <Row label="HTTP/2 (Akamai)" value={tls.http2.fingerprint} />
          <Row label="ALPN" value={tls.alpn.join(", ")} />
          <Row label="Curves" value={tls.curves.join(", ")} />
          <Row label="Ciphers" value={tls.ciphers.join(", ")} />
        </div>
        <ul className="scraper-notes">
          {tls.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Section>

      <Section
        title="Header order"
        hint="Send them in this order, including client-owned headers"
        copyValue={JSON.stringify(scraper.headerOrder)}
      >
        <div className="data-table">
          {scraper.headerOrder.map((name, index) => (
            <div className="data-row" key={name}>
              <code>{`${index + 1}. ${name}`}</code>
              <span>
                {scraper.headers[name] ??
                  scraper.clientOwnedHeaders[name] ??
                  "—"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Cookie header"
        hint={`Cookies scoped to ${scraper.origin}`}
        copyValue={scraper.cookieHeader}
      >
        <pre className="code-pane wrap">
          <code>{scraper.cookieHeader || "No cookies apply to this URL."}</code>
        </pre>
      </Section>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <div className="data-row">
      <code>{label}</code>
      <span>{value}</span>
    </div>
  );
}

function Section({
  title,
  hint,
  copyValue,
  children,
}: {
  title: string;
  hint: string;
  copyValue?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (copyValue === undefined) return;

    await navigator.clipboard.writeText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <section className="scraper-section">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
        {copyValue !== undefined && (
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}
