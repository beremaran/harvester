"""Extends stealth evasions into Worker global scopes.

``playwright-stealth`` (and Playwright's own ``add_init_script``) only patches the
page's main-world ``window`` context. A dedicated ``Worker`` runs in its own global
scope with its own ``navigator``/``WebGLRenderingContext``, so it never receives
those patches — CreepJS and similar fingerprinters spawn a worker specifically to
read the *unpatched* UA and WebGL renderer, which leaks "HeadlessChrome" and a
software (SwiftShader) GPU renderer even when the main page looks clean.

This wraps ``window.Worker`` so that every worker script is fetched synchronously
(preserving ``new Worker()``'s synchronous construction semantics) and has the same
UA/WebGL patch prepended before it runs, then reconstructed as a blob URL.
"""

import json

# Shared by both evasion paths below: re-applies the UA/WebGL overrides inside
# whatever global scope it's run in (dedicated Worker or ServiceWorker), since
# neither inherits the page-level ``playwright-stealth`` patches.
_WORKER_CONTEXT_PATCH_TEMPLATE = """(() => {
  try {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'userAgent', {
      get: () => %(ua)s, configurable: true,
    });
  } catch (e) {}
  try {
    const patchGetParameter = (proto) => {
      const orig = proto.getParameter;
      proto.getParameter = new Proxy(orig, {
        apply(target, ctx, args) {
          if (args[0] === 37445) return %(vendor)s;
          if (args[0] === 37446) return %(renderer)s;
          return Reflect.apply(target, ctx, args);
        },
      });
    };
    if (typeof WebGLRenderingContext !== 'undefined') patchGetParameter(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGetParameter(WebGL2RenderingContext.prototype);
  } catch (e) {}
})();"""


def worker_context_patch(*, user_agent: str, webgl_vendor: str, webgl_renderer: str) -> str:
    """The evaluate()-able snippet applied directly to an already-running worker context."""
    return _WORKER_CONTEXT_PATCH_TEMPLATE % {
        "ua": json.dumps(user_agent),
        "vendor": json.dumps(webgl_vendor),
        "renderer": json.dumps(webgl_renderer),
    }


_PATCH_TEMPLATE = """
(() => {
  const OriginalWorker = window.Worker;
  if (!OriginalWorker || OriginalWorker.__harvesterPatched) return;

  const PATCH = %(patch_js)s + '\\n';

  function wrapAsBlobUrl(scriptURL) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', scriptURL, false);
      xhr.send(null);
      const blob = new Blob([PATCH, xhr.responseText], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  function PatchedWorker(scriptURL, options) {
    const resolved = typeof scriptURL === 'string' ? new URL(scriptURL, location.href).href : scriptURL;
    const blobUrl = wrapAsBlobUrl(resolved);
    return blobUrl ? new OriginalWorker(blobUrl, options) : new OriginalWorker(scriptURL, options);
  }
  PatchedWorker.prototype = OriginalWorker.prototype;
  PatchedWorker.__harvesterPatched = true;
  window.Worker = PatchedWorker;
})();
"""


def worker_stealth_script(*, user_agent: str, webgl_vendor: str, webgl_renderer: str) -> str:
    """Build the page-level init script that re-applies UA/WebGL evasions inside
    every dedicated Worker the page spawns (via ``new Worker(...)``)."""
    patch_js = worker_context_patch(user_agent=user_agent, webgl_vendor=webgl_vendor, webgl_renderer=webgl_renderer)
    return _PATCH_TEMPLATE % {"patch_js": json.dumps(patch_js)}
