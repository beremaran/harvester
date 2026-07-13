// Supplemental stealth hardening injected on every page after playwright-stealth.
//
// playwright-stealth 1.0.6's evasions for these surfaces silently fail on modern
// Chromium (v131), leaving strong headless tells that fingerprinting sites flag:
//   * navigator.plugins / mimeTypes are empty
//   * WebGL UNMASKED_RENDERER reports "SwiftShader" (software GL == headless)
//   * Notification.permission='denied' contradicts permissions.query 'prompt'
// This script presents the values a real, permission-undecided desktop Chrome
// on Windows would report. Kept in plain JS (not a Python string) so it stays
// readable and lintable.
(() => {
  // ---------- WebGL vendor/renderer spoof (headless reports SwiftShader) ----
  const VENDOR = 'Google Inc. (Intel)';
  const RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const patchGL = (proto) => {
    if (!proto || proto.__glPatched) return;
    const orig = proto.getParameter;
    const patched = function (p) {
      if (p === 37445) return VENDOR;    // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return RENDERER;  // UNMASKED_RENDERER_WEBGL
      return orig.apply(this, arguments);
    };
    try {
      Object.defineProperty(patched, 'toString', {
        value: () => 'function getParameter() { [native code] }',
      });
    } catch (e) {}
    proto.getParameter = patched;
    Object.defineProperty(proto, '__glPatched', { value: true });
  };
  patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  // ---------- navigator.plugins / mimeTypes (headless returns empty) --------
  try {
    const mimes = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    const pluginNames = [
      'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer',
      'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
    ];
    const makeMime = (m) => Object.create(MimeType.prototype, {
      type: { value: m.type, enumerable: true },
      suffixes: { value: m.suffixes, enumerable: true },
      description: { value: m.description, enumerable: true },
    });
    const mimeObjs = mimes.map(makeMime);
    const makePlugin = (name) => {
      const p = Object.create(Plugin.prototype, {
        name: { value: name, enumerable: true },
        filename: { value: 'internal-pdf-viewer', enumerable: true },
        description: { value: 'Portable Document Format', enumerable: true },
        length: { value: mimeObjs.length, enumerable: true },
      });
      mimeObjs.forEach((m, i) => {
        Object.defineProperty(p, i, { value: m, enumerable: true });
      });
      Object.defineProperty(p, 'item', { value: (i) => mimeObjs[i] || null });
      Object.defineProperty(p, 'namedItem', { value: (t) => mimeObjs.find((m) => m.type === t) || null });
      return p;
    };
    const pluginObjs = pluginNames.map(makePlugin);

    const arr = Object.create(PluginArray.prototype);
    pluginObjs.forEach((p, i) => {
      Object.defineProperty(arr, i, { value: p, enumerable: true });
      Object.defineProperty(arr, p.name, { value: p });
    });
    Object.defineProperty(arr, 'length', { value: pluginObjs.length });
    Object.defineProperty(arr, 'item', { value: (i) => pluginObjs[i] || null });
    Object.defineProperty(arr, 'namedItem', { value: (n) => pluginObjs.find((p) => p.name === n) || null });
    Object.defineProperty(arr, 'refresh', { value: () => undefined });

    const mimeArr = Object.create(MimeTypeArray.prototype);
    mimeObjs.forEach((m, i) => {
      Object.defineProperty(mimeArr, i, { value: m, enumerable: true });
      Object.defineProperty(mimeArr, m.type, { value: m });
    });
    Object.defineProperty(mimeArr, 'length', { value: mimeObjs.length });
    Object.defineProperty(mimeArr, 'item', { value: (i) => mimeObjs[i] || null });
    Object.defineProperty(mimeArr, 'namedItem', { value: (t) => mimeObjs.find((m) => m.type === t) || null });

    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => arr, configurable: true });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => mimeArr, configurable: true });
  } catch (e) { /* leave defaults on failure */ }

  // ---------- Notification / permissions consistency -----------------------
  // Headless forces Notification.permission='denied' while permissions.query
  // reports 'prompt' — an inconsistency detectors flag. Present the pristine
  // real-browser state instead: both undecided ('default' / 'prompt').
  try {
    if (window.Notification) {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default', configurable: true,
      });
    }
  } catch (e) {}
  try {
    const prevQuery = navigator.permissions.query.bind(navigator.permissions);
    const query = function (params) {
      if (params && params.name === 'notifications') {
        const status = Object.create(PermissionStatus.prototype);
        Object.defineProperty(status, 'state', { get: () => 'prompt', enumerable: true });
        Object.defineProperty(status, 'onchange', { value: null, enumerable: true });
        return Promise.resolve(status);
      }
      return prevQuery(params);
    };
    try {
      Object.defineProperty(query, 'toString', {
        value: () => 'function query() { [native code] }',
      });
    } catch (e) {}
    navigator.permissions.query = query;
  } catch (e) {}
})();
