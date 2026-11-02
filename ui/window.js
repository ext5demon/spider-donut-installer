'use strict';
(() => {
  const desktop = document.querySelector('#desktop');
  const installer = document.querySelector('#installer-window');
  const dock = document.querySelector('#dock');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let topZ = 30, minimized = false, animating = false, snapshot = null, effect = 'genie';
  function focus(win) {
    document.querySelectorAll('.aqua-window').forEach(w => w.classList.toggle('inactive', w !== win));
    win.style.zIndex = ++topZ;
  }
  function fit(win) {
    const maxX = Math.max(0, desktop.clientWidth - win.offsetWidth);
    const maxY = Math.max(0, desktop.clientHeight - win.offsetHeight - 72);
    win.style.left = Math.max(0, Math.min(win.offsetLeft, maxX)) + 'px';
    win.style.top = Math.max(6, Math.min(win.offsetTop, maxY)) + 'px';
  }
  for (const win of document.querySelectorAll('.aqua-window')) {
    win.addEventListener('pointerdown', () => focus(win));
    const bar = win.querySelector('[data-drag]');
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button !== 0) return;
      focus(win); bar.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, left: win.offsetLeft, top: win.offsetTop };
      const move = event => {
        win.style.left = Math.max(0, Math.min(desktop.clientWidth - 120, start.left + event.clientX - start.x)) + 'px';
        win.style.top = Math.max(0, Math.min(desktop.clientHeight - 100, start.top + event.clientY - start.y)) + 'px';
      };
      const stop = () => { bar.removeEventListener('pointermove', move); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', stop, { once: true });
      bar.addEventListener('lostpointercapture', stop, { once: true });
    });
    const grip = win.querySelector('.resize-grip');
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, w: win.offsetWidth, h: win.offsetHeight };
      const move = event => {
        win.style.width = Math.min(desktop.clientWidth - win.offsetLeft - 5, start.w + event.clientX - start.x) + 'px';
        win.style.height = Math.min(desktop.clientHeight - win.offsetTop - 72, start.h + event.clientY - start.y) + 'px';
      };
      const stop = () => grip.removeEventListener('pointermove', move);
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', stop, { once: true });
      grip.addEventListener('lostpointercapture', stop, { once: true });
    });
    grip.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); win.style.width = win.offsetWidth + (e.key === 'ArrowRight' ? 10 : e.key === 'ArrowLeft' ? -10 : 0) + 'px';
      win.style.height = win.offsetHeight + (e.key === 'ArrowDown' ? 10 : e.key === 'ArrowUp' ? -10 : 0) + 'px'; fit(win);
    });
    win.querySelector('.zoom')?.addEventListener('click', () => zoom(win));
    bar.addEventListener('dblclick', e => { if (!e.target.closest('button')) zoom(win); });
  }
  function zoom(win = installer) {
    if (win.dataset.zoomed) {
      const previous = JSON.parse(win.dataset.zoomed); Object.assign(win.style, previous); delete win.dataset.zoomed;
    } else {
      win.dataset.zoomed = JSON.stringify({ left: win.style.left || win.offsetLeft + 'px', top: win.style.top || win.offsetTop + 'px', width: win.style.width || win.offsetWidth + 'px', height: win.style.height || win.offsetHeight + 'px' });
      const width = Math.min(980, desktop.clientWidth - 48), height = Math.min(680, desktop.clientHeight - 105);
      Object.assign(win.style, { width: width + 'px', height: height + 'px', left: (desktop.clientWidth - width) / 2 + 'px', top: '18px' });
    }
  }
  const smooth = t => t * t * (3 - 2 * t);
  async function genie(restore) {
    if (animating || restore !== minimized) return;
    animating = true;
    const destination = document.querySelector('[data-dock=restore]');
    destination.hidden = false;
    const rect = installer.getBoundingClientRect();
    const original = { x: installer.offsetLeft, y: installer.offsetTop + 25, width: installer.offsetWidth, height: installer.offsetHeight };
    try {
      if (!restore) {
        snapshot = await window.installer.capture({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        document.querySelector('#minimized-preview').src = snapshot;
      }
      const image = new Image(); image.src = snapshot; await image.decode();
      installer.style.visibility = 'hidden';
      const target = destination.getBoundingClientRect();
      const end = { x: target.x + target.width / 2, y: target.y + target.height * .6, width: 36 };
      const canvas = document.querySelector('#genie-canvas'), ratio = devicePixelRatio || 1;
      canvas.width = innerWidth * ratio; canvas.height = innerHeight * ratio; canvas.hidden = false;
      const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
      const duration = reduced() ? 0 : 580;
      await new Promise(resolve => {
        let start;
        const frame = now => {
          start ??= now; const time = duration ? Math.min(1, (now - start) / duration) : 1;
          const p = smooth(restore ? 1 - time : time);
          ctx.clearRect(0, 0, innerWidth, innerHeight);
          if (effect === 'scale') {
            const w = original.width * (1 - p) + end.width * p, h = original.height * (1 - p) + 26 * p;
            ctx.drawImage(image, original.x * (1 - p) + (end.x - w / 2) * p, original.y * (1 - p) + (end.y - h / 2) * p, w, h);
          } else {
            // Each texture row follows its own curved path. Lower rows are pulled first;
            // the changing row widths deform the captured content along with the frame.
            const rows = Math.ceil(original.height / 2);
            for (let row = 0; row < rows; row++) {
              const v = row / rows, v2 = (row + 1) / rows;
              const q = smooth(Math.max(0, Math.min(1, p * 1.45 - (1 - v) * .45)));
              const q2 = smooth(Math.max(0, Math.min(1, p * 1.45 - (1 - v2) * .45)));
              const y = (original.y + v * original.height) * (1 - q) + end.y * q;
              const y2 = (original.y + v2 * original.height) * (1 - q2) + end.y * q2;
              const width = original.width * Math.pow(1 - q, 1.35) + end.width * q;
              const center = (original.x + original.width / 2) * (1 - q) + end.x * q;
              ctx.drawImage(image, 0, v * image.height, image.width, image.height / rows + 1, center - width / 2, y, width, Math.max(.6, y2 - y + 1));
            }
          }
          if (time < 1) requestAnimationFrame(frame); else resolve();
        }; requestAnimationFrame(frame);
      });
      canvas.hidden = true;
      minimized = !restore;
      if (restore) { installer.style.visibility = ''; destination.hidden = true; focus(installer); }
    } catch (error) {
      installer.style.visibility = restore ? '' : 'hidden'; minimized = !restore; destination.hidden = restore;
    } finally { animating = false; }
  }
  installer.querySelector('.minimize').addEventListener('click', () => genie(false));
  for (const button of document.querySelectorAll('[data-dock=restore],[data-dock=installer]')) button.addEventListener('click', () => minimized ? genie(true) : focus(installer));
  let dockX = null;
  dock.addEventListener('pointermove', e => { dockX = e.clientX; }); dock.addEventListener('pointerleave', () => { dockX = null; });
  function magnify() {
    const items = [...dock.querySelectorAll('.dock-item:not([hidden])')], base = 54;
    const totalBase = items.length * (base + 8) + 25;
    const start = innerWidth / 2 - totalBase / 2;
    items.forEach((item, index) => {
      const distance = dockX === null ? 1000 : Math.abs(dockX - (start + index * (base + 8) + base / 2));
      const target = base + 25 * Math.exp(-(distance * distance) / (2 * 65 * 65));
      const current = parseFloat(item.style.width) || base;
      const width = current + (target - current) * (reduced() ? 1 : .2);
      item.style.width = width + 'px'; item.style.height = width + 7 + 'px';
    }); requestAnimationFrame(magnify);
  } magnify();
  for (const icon of document.querySelectorAll('.desktop-icon')) {
    icon.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      document.querySelectorAll('.desktop-icon').forEach(i => i.classList.toggle('selected', i === icon));
      icon.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY, left: icon.offsetLeft, top: icon.offsetTop };
      const move = event => {
        if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 4) return;
        icon.style.right = 'auto'; icon.style.left = Math.max(0, Math.min(desktop.clientWidth - 86, start.left + event.clientX - start.x)) + 'px';
        icon.style.top = Math.max(0, Math.min(desktop.clientHeight - 160, start.top + event.clientY - start.y)) + 'px';
      };
      const stop = () => icon.removeEventListener('pointermove', move);
      icon.addEventListener('pointermove', move); icon.addEventListener('pointerup', stop, { once: true }); icon.addEventListener('lostpointercapture', stop, { once: true });
    });
    icon.addEventListener('dblclick', () => dispatchEvent(new CustomEvent('desktop-open', { detail: icon.dataset.desktopAction })));
    icon.addEventListener('keydown', e => { if (e.key === 'Enter') dispatchEvent(new CustomEvent('desktop-open', { detail: icon.dataset.desktopAction })); });
    icon.addEventListener('contextmenu', e => { e.preventDefault(); dispatchEvent(new CustomEvent('desktop-context', { detail: { action: icon.dataset.desktopAction, x: e.clientX, y: e.clientY } })); });
  }
  addEventListener('resize', () => document.querySelectorAll('.aqua-window').forEach(fit));
  window.aqua = { focus, zoom, minimize: () => genie(false), restore: () => genie(true), isMinimized: () => minimized,
    effect: value => { if (value) effect = value; return effect; }, bounce: element => { element.classList.remove('bounce'); void element.offsetWidth; element.classList.add('bounce'); } };
  focus(installer); setTimeout(() => aqua.bounce(document.querySelector('[data-dock=installer]')), 100);
})();
