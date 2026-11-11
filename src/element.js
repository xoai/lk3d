// @ts-check
// <lk3d-figure>: a figure as an HTML element, for a page that writes no script of its own (Markdown, a content
// system, any framework). The scene comes from `src` (its address) or from a JSON script inside the element:
//   <lk3d-figure src="generator.json" look="pen" locale="vi"></lk3d-figure>
//   <lk3d-figure><script type="application/json">{ "parts": [ … ] }</script></lk3d-figure>
// Attributes: look, theme, labels (auto, all, none), step (a place from 0, or an id) change the figure as they change;
// src, locale, controls="false", steps="false", info="false" (no line for the part's name and note under it) and
// transparent mount it again. A script reaches the figure's API as `element.figure` (null until mounted; a new one
// each time it is mounted again) and `element.ready` (resolves with the first, once complete); the reader's moves come as events that bubble: lk3d-pick
// ({ id }), lk3d-handle ({ id, value }), lk3d-step ({ index, step }), lk3d-section ({ normal, offset }); a scene that
// cannot be read or drawn, as lk3d-error ({ message }), its words shown in the element.

/** @param {(el: HTMLElement, scene: any, opts?: any) => any} mount */
export function defineElement(mount) {
  if (typeof customElements === 'undefined' || customElements.get('lk3d-figure')) return;
  const LIVE = ['look', 'theme', 'labels', 'step'],
    MOUNTED = ['src', 'locale', 'controls', 'steps', 'info', 'transparent'];
  class Lk3dFigure extends HTMLElement {
    // (a getter, not a static field: the bundle is built for ES2020, which would bring a helper for the field)
    static get observedAttributes() {
      return [...LIVE, ...MOUNTED];
    }
    constructor() {
      super();
      /** @type {any} the figure's API, once mounted */
      this.figure = null;
      /** @type {any} the scene, read once (a JSON script inside is gone once the figure is drawn in its place) */
      this.scene = null;
      this.loads = 0; // (each load counted: one that finishes after a newer one began is dropped)
      /** @type {(figure: any) => void} */
      let resolve = () => {};
      /** @type {Promise<any>} */
      this.ready = new Promise((done) => (resolve = done));
      this.resolveReady = resolve;
    }
    connectedCallback() {
      if (!this.figure) this.load();
    }
    disconnectedCallback() {
      if (this.figure) this.figure.destroy();
      this.figure = null;
    }
    /** @param {string} name @param {string | null} before @param {string | null} now */
    attributeChangedCallback(name, before, now) {
      if (!this.figure || before === now) return;
      if (name === 'src') this.scene = null;
      if (!LIVE.includes(name)) return void this.load();
      if (name === 'step') this.figure.step(/^-?\d+$/.test(now || '') ? +(now || 0) : now);
      else this.figure.set({ [name === 'look' ? 'style' : name]: now || (name === 'labels' ? 'auto' : null) });
    }
    /** @param {string} type @param {object} detail */
    say(type, detail) {
      this.dispatchEvent(new CustomEvent('lk3d-' + type, { detail, bubbles: true }));
    }
    async load() {
      const load = ++this.loads,
        attribute = (/** @type {string} */ name) => this.getAttribute(name),
        off = (/** @type {string} */ name) => attribute(name) === 'false';
      try {
        if (!this.scene) {
          const inside = this.querySelector('script[type="application/json"]'),
            src = attribute('src');
          if (src) {
            // (a page opened from a file may not fetch others: said so, with what to do, not as "Failed to fetch")
            const response = await fetch(src).catch((/** @type {Error} */ error) => {
              throw new Error(
                `lk3d: ${src} could not be fetched (${error.message})` +
                  (location.protocol === 'file:' ? ': a page opened from a file cannot fetch; serve it over http' : ''),
              );
            });
            if (!response.ok) throw new Error(`lk3d: ${src}: ${response.status} ${response.statusText}`);
            this.scene = await response.json();
          } else if (inside) this.scene = JSON.parse(inside.textContent || '');
          else throw new Error('lk3d: <lk3d-figure> needs a scene: src="scene.json", or a JSON script inside');
        }
        if (load !== this.loads || !this.isConnected) return;
        if (this.figure) this.figure.destroy();
        const info = off('info') ? null : document.createElement('p'),
          step = attribute('step');
        if (info) info.className = 'lk3d-info';
        this.figure = mount(this, this.scene, {
          style: attribute('look') || undefined,
          theme: attribute('theme') || undefined,
          labels: attribute('labels') || undefined,
          locale: attribute('locale') || undefined,
          controls: !off('controls'),
          steps: attribute('steps') == null ? undefined : !off('steps'),
          step: step == null ? undefined : /^-?\d+$/.test(step) ? +step : step,
          transparent: this.hasAttribute('transparent') && !off('transparent'),
          info,
          onPick: (/** @type {any} */ part) => this.say('pick', { id: part ? part.id : null }),
          onHandle: (/** @type {string} */ id, /** @type {number} */ value) => this.say('handle', { id, value }),
          onStep: (/** @type {number} */ index, /** @type {any} */ stepShown) =>
            this.say('step', { index, step: stepShown }),
          onSection: (/** @type {any} */ section) => this.say('section', section),
        });
        // (the name and note of the part pointed at, under the figure and its steps' words)
        if (info) (this.querySelector('.lk3d-steps') || this.querySelector('.lk3d-stage'))?.after(info);
        const figure = this.figure;
        figure.ready.then(() => this.figure === figure && this.resolveReady(figure));
      } catch (error) {
        const message = String(/** @type {Error} */ (error).message || error);
        this.figure = null;
        this.textContent = message;
        console.error(message);
        this.say('error', { message });
      }
    }
  }
  customElements.define('lk3d-figure', Lk3dFigure);
}
