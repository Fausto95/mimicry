import { EngineHost } from '@mimicry/host-web';
import type {
  AppBundle, Appearance, CapabilityLevel, DeviceDescriptor, EngineMessage, EnvironmentSpec, FontSpecRecord,
  InspectorNode, ModuleRecord, Orientation, PlatformName,
} from '@mimicry/protocol';
import { resolveViewport } from '@mimicry/protocol';
import { finishFor, finishesFor, hardwareLabel, shellFamily } from './shell';

/**
 * Mimicry Studio: the page around the simulated device. It owns the device
 * frame, environment controls, the inspector and logs; everything inside the
 * screen is painted by the engine host.
 */
interface Manifest {
  project: { name: string };
  base: string;
  devices: DeviceDescriptor[];
  fonts: FontSpecRecord[];
}

interface BuildResponse {
  bundle: AppBundle;
  errors: Array<{ file?: string; message: string }>;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const icon = (path: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  rotate: icon('<path d="M3 8a5 5 0 0 1 8.5-3.5L13 6"/><path d="M13 2.5V6H9.5"/><path d="M13 8a5 5 0 0 1-8.5 3.5L3 10"/><path d="M3 13.5V10h3.5"/>'),
  reload: icon('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5V5h-2.5"/>'),
  back: icon('<path d="M10 3 5 8l5 5"/>'),
  pick: icon('<path d="M3 3l4.5 10 1.5-4 4-1.5z"/>'),
  camera: icon('<rect x="2" y="4.5" width="12" height="8.5" rx="2"/><circle cx="8" cy="8.7" r="2.3"/><path d="M5.5 4.5 6.5 3h3l1 1.5"/>'),
  slow: icon('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>'),
  panel: icon('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M10 3v10"/>'),
};

type Settings = {
  platform: PlatformName;
  devices: Record<PlatformName, string>;
  finishes: Record<string, string>;
  appearance: Appearance;
  orientation: Orientation;
  zoom: number | 'fit';
  tab: 'inspect' | 'engine' | 'logs';
  panel: boolean;
  slow: boolean;
};

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem('mimicry:studio') ?? '{}');
  } catch {
    return {};
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem('mimicry:studio', JSON.stringify(s));
  } catch {
    // storage unavailable (private window): settings simply don't persist
  }
}

async function main(): Promise<void> {
  const manifest: Manifest = await (await fetch('/__mimicry/manifest')).json();
  document.title = `${manifest.project.name} · Mimicry`;
  const byId = new Map(manifest.devices.map((d) => [d.id, d]));
  const saved = loadSettings();
  const settings: Settings = {
    platform: saved.platform ?? 'ios',
    devices: { ios: 'iphone-18-pro', android: 'pixel-11-pro', ...(saved.devices ?? {}) },
    finishes: saved.finishes ?? {},
    appearance: saved.appearance ?? 'light',
    orientation: 'portrait',
    zoom: saved.zoom ?? 'fit',
    tab: saved.tab ?? 'inspect',
    panel: saved.panel ?? true,
    slow: false,
  };
  const device = () => byId.get(settings.devices[settings.platform]) ?? manifest.devices.find((d) => d.platform === settings.platform)!;
  const environment = (): EnvironmentSpec => ({ device: device(), orientation: settings.orientation, appearance: settings.appearance });

  document.body.innerHTML = `
  <div class="studio${settings.panel ? '' : ' panel-hidden'}">
    <header class="bar">
      <div class="project"><span class="mark" aria-hidden="true"></span><strong></strong></div>
      <div class="seg" id="platform" role="group" aria-label="Platform">
        <button data-value="ios">iOS</button><button data-value="android">Android</button>
      </div>
      <select id="device" aria-label="Device model"></select>
      <select id="finish" aria-label="Device finish" title="Hardware finish"></select>
      <div class="seg" id="appearance" role="group" aria-label="Appearance">
        <button data-value="light">Light</button><button data-value="dark">Dark</button>
      </div>
      <button class="tool" id="rotate" title="Rotate">${ICONS.rotate}</button>
      <button class="tool" id="back" title="Android back">${ICONS.back}</button>
      <span class="spacer"></span>
      <span class="status" id="status"><i></i><span>Starting</span></span>
      <button class="tool" id="slow" title="Slow animations (10×)">${ICONS.slow}</button>
      <button class="tool" id="shot" title="Save screenshot">${ICONS.camera}</button>
      <button class="tool" id="reload" title="Reload app (⌘R)">${ICONS.reload}</button>
      <button class="tool" id="zoom-out" title="Zoom out">−</button>
      <span class="zoom" id="zoom-label"></span>
      <button class="tool" id="zoom-in" title="Zoom in">+</button>
      <button class="tool" id="toggle-panel" title="Toggle panel">${ICONS.panel}</button>
    </header>
    <main class="stage" id="stage">
      <div class="device" id="frame">
        <span class="frame-button action" aria-hidden="true"></span>
        <span class="frame-button volume-up" aria-hidden="true"></span>
        <span class="frame-button volume-down" aria-hidden="true"></span>
        <span class="frame-button power" aria-hidden="true"></span>
        <div class="screen" id="screen"><div class="highlight" id="highlight"></div><div class="picker" id="picker"></div></div>
      </div>
      <div class="caption" id="caption"></div>
    </main>
    <aside class="panel">
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="inspect">Inspect</button>
        <button role="tab" data-tab="engine">Engine</button>
        <button role="tab" data-tab="logs">Logs<span class="count" id="error-count" hidden>0</span></button>
      </div>
      <section class="pane" data-pane="inspect">
        <div class="pane-tools">
          <button class="tool" id="pick" title="Select an element on the device">${ICONS.pick} Select</button>
          <span class="hint">Hover a row to outline it on the device.</span>
        </div>
        <div class="tree" id="tree"></div>
        <pre class="details" id="details" hidden></pre>
      </section>
      <section class="pane" data-pane="engine">
        <div class="metrics" id="metrics"></div>
        <p class="explain">Chunks are cached rasters keyed by a hash of their draw commands. Scrolling and transform or opacity animations only re-composite cached chunks; a hit rate near 100% means frames cost compositing, not painting.</p>
        <div class="section-title">React Native surface</div>
        <div class="caps" id="caps"></div>
      </section>
      <section class="pane" data-pane="logs"><div class="logs" id="logs"></div></section>
    </aside>
  </div>`;
  $('.project strong').textContent = manifest.project.name;

  const screen = $<HTMLDivElement>('#screen');
  const host = new EngineHost({
    container: screen,
    workerUrl: manifest.base,
    fonts: manifest.fonts,
    fontMode: 'system',
    storageKey: `mimicry:storage:${manifest.project.name}`,
    onMessage: handleEngineMessage,
    onFrame: (stats) => {
      latestStats = stats;
      scheduleStats();
      scheduleInspect();
    },
  });
  // the canvas must sit under the highlight/picker layers
  screen.prepend(host.canvas, host.overlayRoot);

  let latestStats: Parameters<NonNullable<ConstructorParameters<typeof EngineHost>[0]['onFrame']>>[0] | null = null;
  let errors = 0;
  let booted = 0;

  // ── logging ───────────────────────────────────────────────────────────
  function log(text: string, kind: 'info' | 'warn' | 'error' | 'build' = 'info'): void {
    const logs = $('#logs');
    const row = document.createElement('div');
    row.className = `log ${kind}`;
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString([], { hour12: false });
    row.append(time, document.createTextNode(text));
    logs.append(row);
    while (logs.childElementCount > 400) logs.firstElementChild?.remove();
    if (settings.tab === 'logs') row.scrollIntoView({ block: 'end' });
    if (kind === 'error') {
      errors++;
      const badge = $('#error-count');
      badge.hidden = false;
      badge.textContent = String(errors);
    }
  }

  function status(text: string, state: 'live' | 'error' | 'busy'): void {
    const el = $('#status');
    el.className = `status ${state === 'busy' ? '' : state}`;
    el.querySelector('span')!.textContent = text;
  }

  function handleEngineMessage(message: EngineMessage): void {
    switch (message.type) {
      case 'ready':
        status(`${message.platform === 'ios' ? 'iOS' : 'Android'} engine running`, 'live');
        renderCapabilities(message.capabilities);
        log(`Engine ready in ${Math.round(performance.now() - booted)} ms`);
        break;
      case 'log':
        log(message.message, message.level === 'error' ? 'error' : message.level === 'warn' ? 'warn' : 'info');
        break;
      case 'error':
        log(`${message.error.kind} error: ${message.error.message}${message.error.componentStack ? `\n${message.error.componentStack.trim()}` : ''}`, 'error');
        status('Error — see Logs', 'error');
        break;
      case 'reloadRequested':
        void boot();
        break;
    }
  }

  // ── device & environment ──────────────────────────────────────────────
  async function fetchBuild(platform: PlatformName): Promise<BuildResponse> {
    const res = await fetch(`/__mimicry/app?platform=${platform}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function boot(): Promise<void> {
    status('Compiling', 'busy');
    const t0 = performance.now();
    try {
      const build = await fetchBuild(settings.platform);
      log(`Compiled ${build.bundle.modules.length} modules for ${settings.platform} in ${Math.round(performance.now() - t0)} ms`, 'build');
      for (const e of build.errors) log(`${e.file ? e.file + ': ' : ''}${e.message}`, 'error');
      booted = performance.now();
      status('Booting engine', 'busy');
      await host.boot(environment(), build.bundle);
      host.setAnimationScale(settings.slow ? 10 : 1);
    } catch (error) {
      log(String((error as Error).message ?? error), 'error');
      status('Build failed', 'error');
    }
    layoutFrame();
  }

  function applyEnvironment(): void {
    host.setEnvironment({ device: device(), orientation: settings.orientation, appearance: settings.appearance }, environment());
    layoutFrame();
  }

  function fitZoom(): number {
    const stage = $('#stage').getBoundingClientRect();
    const v = resolveViewport(device(), settings.orientation);
    const bezel = dBezel(device());
    const z = Math.min((stage.width - 64) / (v.width + bezel * 2), (stage.height - 72) / (v.height + bezel * 2), 1.25);
    return Math.max(0.25, Math.floor(z * 100) / 100);
  }

  function dBezel(d: DeviceDescriptor): number {
    return d.idiom === 'tablet' ? 13 : d.platform === 'ios' ? 12 : 10;
  }

  function layoutFrame(): void {
    const d = device();
    const v = resolveViewport(d, settings.orientation);
    const zoom = settings.zoom === 'fit' ? fitZoom() : settings.zoom;
    host.setZoom(zoom);
    const frame = $('#frame');
    const shell = finishFor(d, settings.finishes[d.id]);
    frame.className = `device ${d.platform} ${d.idiom} ${settings.orientation} shell-${shellFamily(d)}`;
    frame.dataset.device = d.id;
    frame.dataset.finish = shell.id;
    frame.style.setProperty('--radius', `${d.cornerRadius * zoom}px`);
    frame.style.setProperty('--bezel', `${Math.max(5, dBezel(d) * zoom)}px`);
    frame.style.setProperty('--rail', shell.rail);
    frame.style.setProperty('--rail-light', shell.light);
    frame.style.setProperty('--rail-dark', shell.dark);
    screen.style.width = `${v.width * zoom}px`;
    screen.style.height = `${v.height * zoom}px`;
    screen.querySelectorAll('.notch, .home-indicator').forEach((n) => n.remove());
    // A notch is hardware and the home indicator is drawn over the app by the
    // system; neither is in a simulator screenshot, so the frame draws them.
    // (The Dynamic Island is, and the engine paints it.)
    if (settings.orientation === 'portrait' && d.cutout.kind === 'notch') {
      const cut = document.createElement('div');
      cut.className = 'notch';
      cut.style.width = `${d.cutout.width * zoom}px`;
      cut.style.height = `${d.cutout.height * zoom}px`;
      cut.style.top = `${d.cutout.top * zoom}px`;
      cut.style.left = `${((v.width - d.cutout.width) / 2) * zoom}px`;
      screen.appendChild(cut);
    }
    if (d.platform === 'ios' && d.homeIndicator) {
      const indicatorWidth = d.idiom === 'tablet' ? 315 : settings.orientation === 'landscape' ? 216 : 139;
      const bar = document.createElement('div');
      bar.className = 'home-indicator';
      bar.style.width = `${indicatorWidth * zoom}px`;
      bar.style.height = `${5 * zoom}px`;
      bar.style.left = `${((v.width - indicatorWidth) / 2) * zoom}px`;
      bar.style.bottom = `${8 * zoom}px`;
      bar.style.background = settings.appearance === 'dark' ? '#fff' : '#000';
      screen.appendChild(bar);
    }
    $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
    const os = d.platform === 'ios' ? (d.idiom === 'tablet' ? 'iPadOS' : 'iOS') : 'Android';
    $('#caption').textContent = `${d.name}  ·  ${os} ${d.osVersion}  ·  ${v.width}×${v.height} @${d.scale}×  ·  ${hardwareLabel(d)}${d.approximate ? '  ·  estimated geometry' : ''}`;
    $('#back').hidden = d.platform !== 'android';
    syncControls();
  }

  function syncControls(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#platform button')) b.setAttribute('aria-pressed', String(b.dataset.value === settings.platform));
    for (const b of document.querySelectorAll<HTMLButtonElement>('#appearance button')) b.setAttribute('aria-pressed', String(b.dataset.value === settings.appearance));
    const select = $<HTMLSelectElement>('#device');
    select.innerHTML = '';
    // Group devices by family without making the catalog dependent on an OS implementation.
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const d of manifest.devices.filter((x) => x.platform === settings.platform)) {
      const family = d.idiom === 'tablet' ? 'Tablets' : d.platform === 'ios'
        ? d.id.match(/^iphone-(\d+)/)?.[1] ?? 'Other'
        : d.id.startsWith('pixel') ? 'Google Pixel' : d.id.startsWith('galaxy') ? 'Samsung Galaxy' : 'Other';
      const label = /^\d+$/.test(family) ? `iPhone ${family}` : family;
      let group = groups.get(label);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = label;
        groups.set(label, group);
        select.appendChild(group);
      }
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = d.name;
      option.selected = d.id === device().id;
      group.append(option);
    }
    const finishes = $<HTMLSelectElement>('#finish');
    finishes.innerHTML = '';
    for (const f of finishesFor(device())) {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = f.name;
      option.selected = f.id === finishFor(device(), settings.finishes[device().id]).id;
      finishes.append(option);
    }
    $('#slow').setAttribute('aria-pressed', String(settings.slow));
    for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === settings.tab));
    for (const p of document.querySelectorAll<HTMLElement>('.pane')) p.classList.toggle('active', p.dataset.pane === settings.tab);
    saveSettings(settings);
  }

  // ── controls ──────────────────────────────────────────────────────────
  $('#platform').addEventListener('click', (e) => {
    const value = (e.target as HTMLElement).closest('button')?.dataset.value as PlatformName | undefined;
    if (!value || value === settings.platform) return;
    settings.platform = value;
    settings.orientation = 'portrait';
    syncControls();
    void boot(); // a different platform is a different module graph (*.ios.tsx vs *.android.tsx)
  });
  $<HTMLSelectElement>('#device').addEventListener('change', (e) => {
    settings.devices[settings.platform] = (e.target as HTMLSelectElement).value;
    applyEnvironment();
  });
  $<HTMLSelectElement>('#finish').addEventListener('change', (e) => {
    settings.finishes[device().id] = (e.target as HTMLSelectElement).value;
    // Hardware paint only: do not reboot or disturb React state.
    layoutFrame();
  });
  $('#appearance').addEventListener('click', (e) => {
    const value = (e.target as HTMLElement).closest('button')?.dataset.value as Appearance | undefined;
    if (!value) return;
    settings.appearance = value;
    applyEnvironment();
  });
  $('#rotate').addEventListener('click', () => {
    settings.orientation = settings.orientation === 'portrait' ? 'landscape' : 'portrait';
    applyEnvironment();
  });
  $('#back').addEventListener('click', () => host.back());
  $('#reload').addEventListener('click', () => void boot());
  $('#slow').addEventListener('click', () => {
    settings.slow = !settings.slow;
    host.setAnimationScale(settings.slow ? 10 : 1);
    syncControls();
  });
  $('#shot').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = host.snapshot();
    a.download = `${manifest.project.name}-${device().id}-${settings.appearance}.png`;
    a.click();
  });
  const stepZoom = (dir: number) => {
    const current = settings.zoom === 'fit' ? fitZoom() : settings.zoom;
    settings.zoom = Math.min(2, Math.max(0.25, Math.round((current + dir * 0.1) * 10) / 10));
    layoutFrame();
  };
  $('#zoom-in').addEventListener('click', () => stepZoom(1));
  $('#zoom-out').addEventListener('click', () => stepZoom(-1));
  $('#zoom-label').addEventListener('dblclick', () => {
    settings.zoom = 'fit';
    layoutFrame();
  });
  $('#toggle-panel').addEventListener('click', () => {
    settings.panel = !settings.panel;
    $('.studio').classList.toggle('panel-hidden', !settings.panel);
    layoutFrame();
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
    b.addEventListener('click', () => {
      settings.tab = b.dataset.tab as Settings['tab'];
      syncControls();
      if (settings.tab === 'inspect') void refreshTree();
      if (settings.tab === 'engine') renderStats();
    });
  }
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      void boot();
    }
  });
  new ResizeObserver(() => settings.zoom === 'fit' && layoutFrame()).observe($('#stage'));

  // ── engine stats ──────────────────────────────────────────────────────
  let statsTimer = 0;
  function scheduleStats(): void {
    if (statsTimer || settings.tab !== 'engine') return;
    statsTimer = window.setTimeout(() => {
      statsTimer = 0;
      renderStats();
    }, 200);
  }

  function renderStats(): void {
    if (!latestStats) return;
    const { engine, host: h } = latestStats;
    const total = h.hits + h.misses;
    const metric = (value: string, label: string) => `<div class="metric"><b>${value}</b><span>${label}</span></div>`;
    $('#metrics').innerHTML = [
      metric(String(engine.frame), 'frames painted'),
      metric(`${engine.layoutMs.toFixed(1)} ms`, 'layout (Yoga)'),
      metric(`${engine.paintMs.toFixed(1)} ms`, 'encode draw commands'),
      metric(`${h.rasterMs.toFixed(1)} ms`, 'rasterize new chunks'),
      metric(`${total ? Math.round((h.hits / total) * 100) : 100}%`, `chunk cache hits (${h.hits}/${total})`),
      metric(String(engine.layers), 'composited layers'),
      metric(`${(engine.bytes / 1024).toFixed(1)} KB`, 'frame stream'),
      metric(`${(h.cachedBytes / 1048576).toFixed(1)} MB`, `rasters cached (${h.cachedChunks})`),
      metric(String(engine.nodes), 'host nodes'),
      metric(String(engine.live), 'live animations'),
    ].join('');
  }

  function renderCapabilities(caps: Record<string, CapabilityLevel>): void {
    $('#caps').innerHTML = Object.entries(caps)
      .map(([name, level]) => `<span class="cap ${level}" title="${level}">${name}</span>`)
      .join('');
  }

  // ── inspector ─────────────────────────────────────────────────────────
  let inspectTimer = 0;
  let selected: number | null = null;
  let tree: InspectorNode | null = null;
  const byNode = new Map<number, InspectorNode>();

  function scheduleInspect(): void {
    if (inspectTimer || settings.tab !== 'inspect') return;
    inspectTimer = window.setTimeout(() => {
      inspectTimer = 0;
      void refreshTree();
    }, 500);
  }

  async function refreshTree(): Promise<void> {
    tree = await host.inspect();
    byNode.clear();
    const container = $('#tree');
    container.innerHTML = '';
    if (!tree) return;
    const rows: HTMLElement[] = [];
    const walk = (node: InspectorNode, depth: number, parentComponent?: string) => {
      byNode.set(node.id, node);
      const interesting = node.type !== 'm-root';
      if (interesting) {
        const row = document.createElement('div');
        row.className = `node${node.id === selected ? ' selected' : ''}`;
        row.style.paddingLeft = `${10 + depth * 12}px`;
        row.dataset.id = String(node.id);
        const name = document.createElement('span');
        name.className = 'name';
        const showComponent = node.component && node.component !== parentComponent;
        name.textContent = showComponent ? node.component! : '';
        const hostType = document.createElement('span');
        hostType.className = 'host';
        hostType.textContent = node.type === '#text' ? '' : node.type.replace(/^m-/, '');
        row.append(name, hostType);
        if (node.type === '#text') {
          const text = document.createElement('span');
          text.className = 'text';
          text.textContent = JSON.stringify(node.props.text ?? '');
          row.append(text);
        } else if (node.props.testID) {
          const id = document.createElement('span');
          id.className = 'text';
          id.textContent = `#${node.props.testID}`;
          row.append(id);
        }
        rows.push(row);
      }
      for (const child of node.children) walk(child, interesting ? depth + 1 : depth, node.component);
    };
    walk(tree, 0);
    container.append(...rows);
    if (selected != null) showDetails(selected);
  }

  function highlight(id: number | null): void {
    const box = $('#highlight');
    const node = id != null ? byNode.get(id) : null;
    if (!node) {
      box.style.display = 'none';
      return;
    }
    const zoom = settings.zoom === 'fit' ? fitZoom() : settings.zoom;
    box.style.display = 'block';
    box.style.left = `${node.rect.x * zoom}px`;
    box.style.top = `${node.rect.y * zoom}px`;
    box.style.width = `${node.rect.w * zoom}px`;
    box.style.height = `${node.rect.h * zoom}px`;
  }

  function showDetails(id: number): void {
    const node = byNode.get(id);
    const details = $('#details');
    if (!node) {
      details.hidden = true;
      return;
    }
    details.hidden = false;
    const r = node.rect;
    details.textContent = `${node.component ?? ''} <${node.type}> #${node.id}\nframe  x ${r.x.toFixed(1)}  y ${r.y.toFixed(1)}  w ${r.w.toFixed(1)}  h ${r.h.toFixed(1)}\n\n${JSON.stringify(node.props, null, 2)}`;
  }

  $('#tree').addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.node');
    highlight(row ? Number(row.dataset.id) : null);
  });
  $('#tree').addEventListener('mouseleave', () => highlight(selected));
  $('#tree').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.node');
    if (!row) return;
    selected = Number(row.dataset.id);
    document.querySelectorAll('.node.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    showDetails(selected);
    highlight(selected);
  });
  $('#pick').addEventListener('click', () => {
    const on = !$('.stage').classList.contains('picking');
    $('.stage').classList.toggle('picking', on);
    $('#pick').setAttribute('aria-pressed', String(on));
  });
  const picker = $('#picker');
  picker.addEventListener('pointermove', async (e) => {
    const p = host.toLogical(e.clientX, e.clientY);
    const hit = await host.hitTest(p.x, p.y);
    if (hit.nodeId != null) highlight(hit.nodeId);
  });
  picker.addEventListener('click', async (e) => {
    const p = host.toLogical(e.clientX, e.clientY);
    const hit = await host.hitTest(p.x, p.y);
    $('.stage').classList.remove('picking');
    $('#pick').setAttribute('aria-pressed', 'false');
    if (hit.nodeId == null) return;
    selected = hit.nodeId;
    await refreshTree();
    const row = $('#tree').querySelector<HTMLElement>(`[data-id="${selected}"]`);
    row?.scrollIntoView({ block: 'center' });
    highlight(selected);
  });

  // ── hot updates ───────────────────────────────────────────────────────
  const events = new EventSource('/__mimicry/events');
  events.addEventListener('update', (e) => {
    const update = JSON.parse((e as MessageEvent).data) as { platform: PlatformName; modules: ModuleRecord[]; errors: Array<{ file?: string; message: string }> };
    if (update.platform !== settings.platform) return;
    for (const err of update.errors) log(`${err.file ? err.file + ': ' : ''}${err.message}`, 'error');
    if (update.modules.length) {
      log(`Hot update: ${update.modules.map((m) => m.id).join(', ')}`, 'build');
      host.hotUpdate(update.modules);
      status(`${settings.platform === 'ios' ? 'iOS' : 'Android'} engine running`, 'live');
    }
  });
  events.addEventListener('log', (e) => log(JSON.parse((e as MessageEvent).data).message, 'build'));

  syncControls();
  layoutFrame();
  await boot();
}

main().catch((error) => {
  document.body.textContent = `Mimicry Studio failed to start: ${error?.message ?? error}`;
});
