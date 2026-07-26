export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface TlsFingerprint {
  source: "measured" | "profile";
  chromeMajorVersion: number;
  tlsVersion: string;
  alpn: string[];
  ja3?: string;
  ja3Hash?: string;
  ja4?: string;
  ja4r?: string;
  peetprintHash?: string;
  ciphers: string[];
  curves: string[];
  signatureAlgorithms: string[];
  http2: {
    fingerprint: string;
    settings: string;
    windowUpdate: string;
    priority: string;
    pseudoHeaderOrder: string;
  };
  notes: string[];
}

export interface ScraperHandoff {
  origin: string;
  finalUrl: string;
  userAgent: string;
  protocol: string;
  headers: Record<string, string>;
  headerOrder: string[];
  cookieHeader: string;
  clientOwnedHeaders: Record<string, string>;
  tls: TlsFingerprint;
  tlsClient: {
    library: string;
    profile: string;
    requestPayload: Record<string, unknown>;
  };
  proxy?: {
    server: string;
    note?: string;
  };
  curlImpersonate: string;
}

export interface ProxyDescription {
  server: string;
  source: "request" | "config";
  authenticated: boolean;
}

export interface RenderResult {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  html: string;
  screenshot?: string;
  requestHeaders: Record<string, string>;
  cookies: BrowserCookie[];
  proxy?: ProxyDescription;
  scraper: ScraperHandoff;
  durationMs: number;
}

export interface RenderOptions {
  url: string;
  timeoutMs: number;
  screenshot: boolean;
  proxy?: { server: string };
}

export interface RenderHistoryItem {
  url: string;
  title: string;
  status: number;
  durationMs: number;
  renderedAt: Date;
}

export function validateRenderUrl(value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an HTTP or HTTPS address.");
  }
}

export function buildPreviewHtml(result: RenderResult): string {
  const finalUrl = result.finalUrl.replaceAll('"', "&quot;");
  return result.html.replace(
    /<head([^>]*)>/i,
    `<head$1><base href="${finalUrl}">`,
  );
}

export function addToRenderHistory(
  history: RenderHistoryItem[],
  result: RenderResult,
  renderedAt = new Date(),
): RenderHistoryItem[] {
  const item = {
    url: result.finalUrl,
    title: result.title || new URL(result.finalUrl).hostname,
    status: result.status,
    durationMs: result.durationMs,
    renderedAt,
  };

  return [
    item,
    ...history.filter((previous) => previous.url !== item.url),
  ].slice(0, 5);
}

export function formatDocumentSize(value: string): string {
  const bytes = new Blob([value]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatHistoryTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function highlightHtml(html: string): string {
  return html
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(
      /(&lt;\/?)([\w-]+)(.*?)(\/?&gt;)/g,
      '<span class="code-punctuation">$1</span><span class="code-tag">$2</span><span class="code-attribute">$3</span><span class="code-punctuation">$4</span>',
    );
}
