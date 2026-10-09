// Drag & Drop zum Umsortieren (Maus, Touch, Tastatur) – ohne Abhängigkeiten.
// Gezogen wird nur am Anfasser (.grip); die Nachbarn rutschen animiert (FLIP) zur Seite.

const GRIP_SVG = '<svg viewBox="0 0 16 10" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="2.5" r="1.3"/><circle cx="8" cy="2.5" r="1.3"/><circle cx="13" cy="2.5" r="1.3"/><circle cx="3" cy="7.5" r="1.3"/><circle cx="8" cy="7.5" r="1.3"/><circle cx="13" cy="7.5" r="1.3"/></g></svg>';

export const grip = (cls = '') => `<button type="button" class="grip ${cls}" aria-label="Verschieben (Pfeiltasten oder ziehen)" title="Ziehen zum Verschieben">${GRIP_SVG}</button>`;

/** Elemente gemäß gespeicherter Reihenfolge anordnen (unbekannte bleiben hinten in Originalreihenfolge). */
export function applyOrder(container, itemSelector, order) {
  if (!Array.isArray(order) || !order.length) return;
  const items = [...container.querySelectorAll(`:scope > ${itemSelector}`)];
  const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length + items.findIndex(x => x.dataset.id === id) : i; };
  items.sort((a, b) => rank(a.dataset.id) - rank(b.dataset.id)).forEach(el => container.append(el));
}

export function makeSortable(container, { itemSelector, onChange }) {
  const items = () => [...container.querySelectorAll(`:scope > ${itemSelector}`)];
  const order = () => items().map(el => el.dataset.id);

  // FLIP: Positionen merken, DOM ändern, dann von alt nach neu animieren
  const flip = (mutate, except) => {
    const before = new Map(items().map(el => [el, el.getBoundingClientRect()]));
    mutate();
    for (const el of items()) {
      if (el === except) continue;
      const a = before.get(el), b = el.getBoundingClientRect();
      if (!a) continue;
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  };

  container.addEventListener('click', e => { if (e.target.closest('.grip')) e.preventDefault(); }, true);

  // Tastatur: Anfasser fokussieren, Pfeile verschieben
  container.addEventListener('keydown', e => {
    const g = e.target.closest('.grip');
    if (!g || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const el = g.parentElement; // der Anfasser gehört direkt zu seinem Element
    if (!el?.matches(itemSelector) || el.parentElement !== container) return;
    e.preventDefault();
    e.stopPropagation();
    const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    const sib = up ? el.previousElementSibling : el.nextElementSibling;
    if (!sib || !sib.matches(itemSelector)) return;
    flip(() => (up ? sib.before(el) : sib.after(el)));
    g.focus();
    onChange?.(order());
  });

  container.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip');
    if (!g || e.button > 0) return;
    const el = g.parentElement; // der Anfasser gehört direkt zu seinem Element
    if (!el?.matches(itemSelector) || el.parentElement !== container) return; // verschachtelte Bereiche trennen
    e.preventDefault();
    e.stopPropagation();

    const start = order().join();
    const r0 = el.getBoundingClientRect();
    const grabX = e.clientX - r0.left, grabY = e.clientY - r0.top;
    let tx = 0, ty = 0, px = e.clientX, py = e.clientY, raf;
    el.style.animation = 'none'; // Einblend-Animation würde transform überschreiben
    el.style.opacity = '1';
    el.classList.add('dragging');
    container.classList.add('sorting');

    const place = () => {
      const r = el.getBoundingClientRect();
      tx = px - grabX - (r.left - tx);
      ty = py - grabY - (r.top - ty);
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    };
    const reorder = () => {
      for (const other of items()) {
        if (other === el) continue;
        const r = other.getBoundingClientRect();
        if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
        const after = el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING;
        // erst umsortieren, wenn der Zeiger über die Mitte des Nachbarn hinaus ist
        const pastMid = after ? (py > r.top + r.height / 2 || px > r.left + r.width / 2) : (py < r.top + r.height / 2 || px < r.left + r.width / 2);
        if (!pastMid) return;
        flip(() => (after ? other.after(el) : other.before(el)), el);
        return;
      }
    };
    // Automatisch scrollen am Bildschirmrand
    const tick = () => {
      const edge = 70, h = window.innerHeight;
      const v = py < edge ? -Math.ceil((edge - py) / 6) : py > h - edge - 70 ? Math.ceil((py - (h - edge - 70)) / 6) : 0;
      if (v) { window.scrollBy(0, v); place(); reorder(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const move = ev => { px = ev.clientX; py = ev.clientY; place(); reorder(); };
    const end = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const from = `translate(${tx}px, ${ty}px)`;
      el.style.transform = '';
      el.classList.remove('dragging');
      container.classList.remove('sorting');
      el.animate([{ transform: from }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.22,1,.36,1)' });
      if (order().join() !== start) onChange?.(order());
    };
    // am Fenster lauschen: beim Umhängen im DOM ginge ein Pointer-Capture verloren
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
