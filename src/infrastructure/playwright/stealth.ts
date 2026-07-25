/**
 * Browser-side hardening applied before any page script runs.
 *
 * The renderer-worker's remit includes probing how far a real Chrome session
 * can go against anti-bot defences (see CLAUDE.md). Automation frameworks leave
 * a handful of tells behind — a `webdriver` flag, a stripped `window.chrome`,
 * an empty plugin list, a SwiftShader WebGL vendor — that fingerprinting scripts
 * read to separate a driven browser from a human one. This module removes those
 * tells so a render reflects the site's behaviour toward an ordinary visitor
 * rather than toward Playwright.
 *
 * Two layers:
 *  - {@link STEALTH_LAUNCH_ARGS} / {@link STEALTH_IGNORED_ARGS} shape how Chrome
 *    is launched (dropping the automation banner that sets `navigator.webdriver`).
 *  - {@link STEALTH_INIT_SCRIPT} runs in every new document before page scripts,
 *    normalising the JS surface the rest of the fingerprint reads from.
 */

/** Launch flags that make Chrome present as a normal desktop session. */
export const STEALTH_LAUNCH_ARGS: string[] = [
    // The single biggest tell: without this, Blink exposes
    // `navigator.webdriver === true`.
    "--disable-blink-features=AutomationControlled",
    // Under Xvfb there is no GPU, so Chrome would otherwise refuse to hand out
    // a WebGL context at all ("Canvas has no webgl context"). Allow the
    // SwiftShader software renderer so WebGL works and can be relabelled below.
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist"
];

/**
 * Default Playwright args to suppress. `--enable-automation` sets the
 * "Chrome is being controlled by automated test software" state, which is what
 * surfaces `navigator.webdriver` and trips several headless heuristics.
 */
export const STEALTH_IGNORED_ARGS: string[] = ["--enable-automation"];

/**
 * Runs before every page's own scripts. Kept dependency-free and defensive:
 * each patch guards against a real Chrome that already has the property, so
 * headful and headless sessions converge on the same surface.
 */
/**
 * Reports a plausible discrete GPU in place of the SwiftShader software
 * renderer a GPU-less (Xvfb) host falls back to. Written as a string so the
 * exact same patch can run in the main thread *and* be injected into blob Web
 * Workers — deviceandbrowserinfo compares the two and flags any mismatch, so
 * both realms must agree. getParameter is wrapped in a Proxy so its
 * \`toString()\` still reports native code.
 */
const WEBGL_SPOOF = `(() => {
  const patch = (proto) => {
    if (!proto || !proto.getParameter) return;
    proto.getParameter = new Proxy(proto.getParameter, {
      apply(target, thisArg, args) {
        // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
        if (args[0] === 37445) return "Google Inc. (NVIDIA Corporation)";
        if (args[0] === 37446) {
          return "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)";
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  };
  patch(typeof WebGLRenderingContext !== "undefined" && WebGLRenderingContext.prototype);
  patch(typeof WebGL2RenderingContext !== "undefined" && WebGL2RenderingContext.prototype);
})();`;

export const STEALTH_INIT_SCRIPT = `(() => {
  const redefine = (target, prop, get) => {
    try {
      Object.defineProperty(target, prop, { get, configurable: true });
    } catch {
      /* property is locked down already — nothing to hide */
    }
  };

  // navigator.webdriver is left to the launch layer: with
  // --disable-blink-features=AutomationControlled Blink already reports false
  // through the *native* getter. Redefining it here would only swap that for a
  // script-defined getter, which reads as a weak automation signal.

  // window.chrome: present on real desktop Chrome, stripped under headless.
  if (!window.chrome) {
    Object.defineProperty(window, "chrome", {
      value: { runtime: {} },
      configurable: true,
      writable: true
    });
  }

  // A plausible plugin/mimeType set. Headless Chrome reports none, which is a
  // strong bot signal; desktop Chrome ships the PDF viewer entries below.
  const pluginData = [
    { name: "PDF Viewer", filename: "internal-pdf-viewer", desc: "Portable Document Format" },
    { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", desc: "Portable Document Format" },
    { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", desc: "Portable Document Format" },
    { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", desc: "Portable Document Format" },
    { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", desc: "Portable Document Format" }
  ];

  if (!navigator.plugins || navigator.plugins.length === 0) {
    const mimeTypes = [
      { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
      { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format" }
    ];

    const makePlugin = (info) => {
      const plugin = Object.create(Plugin.prototype);
      redefine(plugin, "name", () => info.name);
      redefine(plugin, "filename", () => info.filename);
      redefine(plugin, "description", () => info.desc);
      redefine(plugin, "length", () => mimeTypes.length);
      return plugin;
    };

    const plugins = pluginData.map(makePlugin);
    const pluginArray = Object.create(PluginArray.prototype);
    plugins.forEach((plugin, index) => { pluginArray[index] = plugin; });
    redefine(pluginArray, "length", () => plugins.length);
    pluginArray.item = (index) => plugins[index] ?? null;
    pluginArray.namedItem = (name) =>
      plugins.find((plugin) => plugin.name === name) ?? null;

    const mimeArray = Object.create(MimeTypeArray.prototype);
    mimeTypes.forEach((info, index) => {
      const mime = Object.create(MimeType.prototype);
      redefine(mime, "type", () => info.type);
      redefine(mime, "suffixes", () => info.suffixes);
      redefine(mime, "description", () => info.description);
      redefine(mime, "enabledPlugin", () => plugins[0]);
      mimeArray[index] = mime;
    });
    redefine(mimeArray, "length", () => mimeTypes.length);

    redefine(Navigator.prototype, "plugins", () => pluginArray);
    redefine(Navigator.prototype, "mimeTypes", () => mimeArray);
  }

  // WebGL: relabel the SwiftShader renderer in the main thread...
  const webglSpoof = ${JSON.stringify(WEBGL_SPOOF)};
  try {
    (0, eval)(webglSpoof);
  } catch {
    /* WebGL unavailable — nothing to relabel */
  }

  // ...and inject the identical patch into blob-URL Web Workers so a worker
  // reports the same GPU as the page. deviceandbrowserinfo builds a worker from
  // a Blob and compares its webGLRenderer to the window's; any drift is flagged.
  if (typeof Worker !== "undefined") {
    window.Worker = new Proxy(Worker, {
      construct(target, args) {
        try {
          const url = args[0];
          if (typeof url === "string" && url.startsWith("blob:")) {
            const request = new XMLHttpRequest();
            request.open("GET", url, false);
            request.send();
            const patched = webglSpoof + "\\n" + request.responseText;
            const blob = new Blob([patched], { type: "application/javascript" });
            args = [URL.createObjectURL(blob), ...args.slice(1)];
          }
        } catch {
          /* fall back to the original worker source */
        }
        return Reflect.construct(target, args);
      }
    });
  }

  // Playwright wraps every init script in a guard that records itself on
  // globalThis.__pwInitScripts. That global is a direct automation tell (the
  // rebrowser detector reads it). This stealth script is registered last, so by
  // the time it runs the earlier init scripts have already consumed the marker
  // and it is safe to remove. A fresh document re-injects the whole set.
  try {
    delete globalThis.__pwInitScripts;
  } catch {
    /* non-configurable — leave it */
  }
})();`;
