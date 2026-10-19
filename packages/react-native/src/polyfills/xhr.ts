/**
 * XMLHttpRequest on top of fetch, for hosts that lack it (Node, headless).
 * React Native apps and their networking libraries (axios, apisauce, devtools
 * interceptors) expect it as a global, as it is on device.
 */
type Listener = (event: { type: string; target: unknown }) => void;

export class FetchXMLHttpRequest {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;
  readyState = 0;
  status = 0;
  statusText = '';
  responseText = '';
  response: unknown = '';
  responseType: '' | 'text' | 'json' | 'arraybuffer' | 'blob' = '';
  responseURL = '';
  timeout = 0;
  withCredentials = false;
  onreadystatechange: (() => void) | null = null;
  onload: Listener | null = null;
  onerror: Listener | null = null;
  ontimeout: Listener | null = null;
  onabort: Listener | null = null;
  onloadend: Listener | null = null;
  upload = { addEventListener() {}, removeEventListener() {} };
  private method = 'GET';
  private url = '';
  private headers: Record<string, string> = {};
  private responseHeaders = new Headers();
  private controller: AbortController | null = null;
  private listeners = new Map<string, Set<Listener>>();

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.setState(1);
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name);
  }

  getAllResponseHeaders(): string {
    let out = '';
    this.responseHeaders.forEach((v, k) => (out += `${k}: ${v}\r\n`));
    return out;
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  abort(): void {
    this.controller?.abort();
    this.fire('abort');
  }

  send(body?: unknown): void {
    this.controller = new AbortController();
    const timer = this.timeout ? setTimeout(() => {
      this.controller?.abort();
      this.fire('timeout');
    }, this.timeout) : null;
    fetch(this.url, { method: this.method, headers: this.headers, body: body as BodyInit | undefined, signal: this.controller.signal })
      .then(async (res) => {
        this.status = res.status;
        this.statusText = res.statusText;
        this.responseURL = res.url;
        this.responseHeaders = res.headers;
        this.setState(2);
        if (this.responseType === 'arraybuffer') this.response = await res.arrayBuffer();
        else if (this.responseType === 'blob') this.response = await res.blob();
        else {
          this.responseText = await res.text();
          this.response = this.responseType === 'json' ? JSON.parse(this.responseText || 'null') : this.responseText;
        }
        this.setState(4);
        this.fire('load');
      })
      .catch(() => {
        this.setState(4);
        this.fire('error');
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.fire('loadend');
      });
  }

  private setState(state: number): void {
    this.readyState = state;
    this.onreadystatechange?.();
    this.fire('readystatechange');
  }

  private fire(type: string): void {
    const event = { type, target: this };
    (this as any)['on' + type]?.(event);
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}
