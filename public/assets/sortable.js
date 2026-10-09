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
  const all = () => [...container.querySelectorAll(`:scope > ${itemSelector}`)];
  // Reihenfolge nur über CSS `order`: das DOM bleibt unverändert. Umhängen im DOM würde
  // alle CSS-Animationen darin neu starten (Balken, Ringe, Einblenden) – das war das Flackern.
  all().forEach((el, i) => { el.style.order = i; });
  const items = () => all().sort((a, b) => a.style.order - b.style.order);
  const order = () => items().map(el => el.dataset.id);
  const setOrder = list => list.forEach((el, i) => { el.style.order = i; });

  // Layout-Position ohne transform (laufende Animationen verfälschen getBoundingClientRect nicht)
  const box = el => {
    const c = container.getBoundingClientRect();
    const left = c.left + container.clientLeft + el.offsetLeft, top = c.top + container.clientTop + el.offsetTop;
    return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  };

  // FLIP: Positionen merken, Reihenfolge ändern, dann von alt nach neu gleiten
  const flip = (list, except) => {
    const before = new Map(list.map(el => [el, el.getBoundingClientRect()]));
    setOrder(list);
    for (const el of list) {
      if (el === except) continue;
      const a = before.get(el), b = box(el);
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.getAnimations().forEach(x => x.id === 'flip' && x.cancel());
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)', id: 'flip' });
    }
  };
  const move = (el, to) => {
    const list = items().filter(x => x !== el);
    list.splice(to, 0, el);
    return list;
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
    const list = items(), i = list.indexOf(el);
    const to = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : i + 1;
    if (to < 0 || to >= list.length) return;
    flip(move(el, to));
    onChange?.(order());
  });

  container.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip');
    if (!g || e.button > 0) return;
    const el = g.parentElement;
    if (!el?.matches(itemSelector) || el.parentElement !== container) return; // verschachtelte Bereiche trennen
    e.preventDefault();
    e.stopPropagation();
    try { g.setPointerCapture(e.pointerId); } catch { /* ältere Browser */ }

    const start = order().join();
    const b0 = box(el);
    const grabX = e.clientX - b0.left, grabY = e.clientY - b0.top;
    let tx = 0, ty = 0, px = e.clientX, py = e.clientY, lastX = px, lastY = py, dirX = 0, dirY = 0, dirty = true, raf;
    el.getAnimations().forEach(a => a.id === 'flip' && a.cancel());
    el.style.animation = 'none'; // Einblend-Animation (fill: forwards) würde transform überschreiben
    el.style.opacity = '1';
    el.classList.add('dragging');
    container.classList.add('sorting');

    const place = () => {
      const b = box(el);
      tx = px - grabX - b.left;
      ty = py - grabY - b.top;
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    };
    const reorder = () => {
      const list = items(), from = list.indexOf(el);
      for (const other of list) {
        if (other === el) continue;
        const r = box(other);
        if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
        const to = list.indexOf(other), forward = to > from;
        const me = box(el);
        const sameRow = me.top < r.bottom - 1 && me.bottom > r.top + 1;
        // erst über die Mitte des Nachbarn hinaus – und nur in Zugrichtung (verhindert Hin-und-her-Springen)
        const ok = sameRow
          ? (forward ? px > r.left + r.width / 2 && dirX >= 0 : px < r.left + r.width / 2 && dirX <= 0)
          : (forward ? py > r.top + r.height / 2 && dirY >= 0 : py < r.top + r.height / 2 && dirY <= 0);
        if (ok) flip(move(el, to), el);
        return;
      }
    };
    // ein Durchlauf pro Bild: Auto-Scroll am Rand, Position, Umsortieren
    const tick = () => {
      const edge = 70, h = window.innerHeight;
      const v = py < edge ? -Math.ceil((edge - py) / 6) : py > h - edge - 70 ? Math.ceil((py - (h - edge - 70)) / 6) : 0;
      if (v) { window.scrollBy(0, v); dirty = true; }
      if (dirty) { dirty = false; reorder(); place(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onMove = ev => {
      px = ev.clientX; py = ev.clientY;
      if (Math.abs(px - lastX) > 2) { dirX = Math.sign(px - lastX); lastX = px; }
      if (Math.abs(py - lastY) > 2) { dirY = Math.sign(py - lastY); lastY = py; }
      dirty = true;
    };
    const end = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const from = `translate3d(${tx}px, ${ty}px, 0)`;
      el.style.transform = '';
      container.classList.remove('sorting');
      const a = el.animate([{ transform: from }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)', id: 'flip' });
      a.onfinish = a.oncancel = () => el.classList.remove('dragging');
      if (order().join() !== start) onChange?.(order());
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
