import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addToRenderHistory,
  buildPreviewHtml,
  validateRenderUrl,
  type RenderResult,
} from "../../web/src/domain/rendering.js";

const result: RenderResult = {
  url: "https://example.com",
  finalUrl: "https://example.com/path",
  status: 200,
  title: "Example",
  html: "<html><head></head><body></body></html>",
  requestHeaders: {},
  cookies: [],
  durationMs: 10,
};

describe("playground rendering rules", () => {
  it("rejects URLs the worker cannot render", () => {
    assert.throws(() => validateRenderUrl("not a URL"), /valid URL/);
    assert.throws(() => validateRenderUrl("file:///tmp/page"), /HTTP or HTTPS/);
  });

  it("adds the final URL as the preview base", () => {
    assert.match(
      buildPreviewHtml(result),
      /<head><base href="https:\/\/example\.com\/path">/,
    );
  });

  it("keeps the five most recent unique pages", () => {
    const older = Array.from({ length: 5 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: String(index),
      status: 200,
      durationMs: index,
      renderedAt: new Date(index),
    }));

    const history = addToRenderHistory(older, result, new Date(10));

    assert.equal(history.length, 5);
    assert.equal(history[0]?.url, result.finalUrl);
    assert.equal(history.some((item) => item.url === older[4]?.url), false);
  });
});
