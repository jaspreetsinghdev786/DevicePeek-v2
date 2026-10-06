// DevicePeek – the preview panel (UI + per-session controller), docked or floating.
// Lives in a closed Shadow DOM so page CSS can't reach it and its CSS can't leak out.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});
  const { h, clamp, debounce, rafThrottle, throttle, send, errorText } = NS.util;
  const { devices, icon } = NS;
  const P = NS.prefs;

  const HOST_TAG = 'devicepeek-root';
  const STAGE_PAD = 16;
  const ANIM_MS = 140;

  function createPanel({ prefs: initialPrefs, initialUrl, cssText, onRequestClose }) {
    let prefs = initialPrefs;
    let vp = devices.resolve(prefs);
    let scale = 1;
    let width = P.clampPanelWidth(prefs.panelWidth, window.innerWidth);
    let dragging = false;
    let mounted = false;
    let desktopScroll = null;
    // Floating window state. Position/size live in prefs; these are per-session.
    let maximized = false;
    let minimized = false;
    let liveRect = null; // rect while the window is being moved/resized
    const cleanups = [];
    const isFloating = () => prefs.mode === 'floating';

    // ------------------------------------------------------------------ host
    const host = document.createElement(HOST_TAG);
    host.setAttribute('data-devicepeek', 'panel');

    // Floating window rect, kept inside the browser viewport.
    function floatRect() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (maximized) return { x: 0, y: 0, w: vw, h: vh };
      const w = clamp(prefs.floatW == null ? 420 : prefs.floatW, Math.min(P.LIMITS.floatMinW, vw), vw);
      const hh = clamp(prefs.floatH == null ? Math.min(vh - 32, 900) : prefs.floatH, Math.min(P.LIMITS.floatMinH, vh), vh);
      const x = clamp(prefs.floatX == null ? vw - w - 16 : prefs.floatX, 0, Math.max(0, vw - w));
      const y = clamp(prefs.floatY == null ? 16 : prefs.floatY, 0, Math.max(0, vh - hh));
      return { x, y, w, h: hh };
    }
    const minimizedHeight = () => Math.ceil(toolbar.getBoundingClientRect().height) + 2;

    function placeHost() {
      const s = host.style;
      const set = (k, v) => s.setProperty(k, v, 'important');
      set('all', 'initial');
      set('position', 'fixed');
      set('z-index', '2147483647');
      set('display', 'block');
      // A page that sets CSS zoom on <html> would also shrink/enlarge the preview viewport.
      // Cancel it so 1 viewport px stays 1 CSS px.
      const pageZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      if (Math.abs(pageZoom - 1) > 0.001) set('zoom', String(1 / pageZoom));
      if (isFloating()) {
        const r = liveRect || floatRect();
        set('left', `${r.x}px`);
        set('top', `${r.y}px`);
        set('width', `${r.w}px`);
        set('height', `${minimized ? minimizedHeight() : r.h}px`);
      } else {
        set('top', '0');
        set('right', '0');
        set('bottom', '0');
        set('width', `${width}px`);
      }
    }
    const root = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      const st = document.createElement('style');
      st.textContent = cssText;
      root.appendChild(st);
    }

    // ------------------------------------------------------------------ helpers
    const iconBtn = (name, label, onclick, cls) =>
      h('button', { class: `dp-btn dp-icon${cls ? ' ' + cls : ''}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));

    // ------------------------------------------------------------------ toolbar
    const deviceSelect = h('select', { class: 'dp-select dp-device-select', 'aria-label': 'Device', title: 'Device' });
    devices.fillSelect(deviceSelect);
    const inW = h('input', { class: 'dp-num', type: 'number', min: P.LIMITS.dimMin, max: P.LIMITS.dimMax, 'aria-label': 'Viewport width', title: 'Width (CSS px)' });
    const inH = h('input', { class: 'dp-num', type: 'number', min: P.LIMITS.dimMin, max: P.LIMITS.dimMax, 'aria-label': 'Viewport height', title: 'Height (CSS px)' });
    const btnRotate = iconBtn('rotate', 'Rotate (portrait / landscape)', () => P.save({ landscape: !prefs.landscape }));
    const btnShot = iconBtn('camera', 'Screenshot of the preview', () => screenshot());
    const btnClose = iconBtn('close', 'Close DevicePeek', () => onRequestClose());
    const btnMode = iconBtn('float', 'Pop out as floating window', () => P.save({ mode: isFloating() ? 'side' : 'floating' }));
    const btnMin = iconBtn('minimize', 'Minimize', () => setMinimized(!minimized), 'dp-float-only');
    const btnMax = iconBtn('maximize', 'Maximize', () => setMaximized(!maximized), 'dp-float-only');
    const btnBack = iconBtn('back', 'Back', () => preview.back());
    const btnFwd = iconBtn('forward', 'Forward', () => preview.forward());
    const btnReload = iconBtn('reload', 'Reload preview', () => preview.reload());
    const btnFollow = iconBtn('follow', 'Follow desktop page', () => P.save({ followPage: !prefs.followPage }), 'dp-toggle');
    const btnSync = iconBtn('sync', 'Sync scroll', () => P.save({ syncScroll: !prefs.syncScroll }), 'dp-toggle');
    const zoomSelect = h(
      'select',
      { class: 'dp-select dp-zoom', 'aria-label': 'Zoom', title: 'Zoom' },
      h('option', { value: 'fit', text: 'Fit' }),
      h('option', { value: '0.5', text: '50%' }),
      h('option', { value: '0.75', text: '75%' }),
      h('option', { value: '1', text: '100%' }),
      h('option', { value: '1.25', text: '125%' }),
      h('option', { value: 'custom', text: 'Custom…' })
    );
    const zoomInput = h('input', { class: 'dp-num dp-zoom-custom', type: 'number', min: 10, max: 300, step: 5, 'aria-label': 'Custom zoom in percent', title: 'Zoom %', hidden: true });

    const toolbar = h(
      'div',
      { class: 'dp-toolbar', role: 'toolbar', 'aria-label': 'DevicePeek' },
      h('div', { class: 'dp-row' }, deviceSelect, h('div', { class: 'dp-dims' }, inW, h('span', { class: 'dp-x', text: '×' }), inH), btnRotate, h('span', { class: 'dp-win' }, btnMode, btnMin, btnMax, btnClose)),
      h(
        'div',
        { class: 'dp-row' },
        btnBack,
        btnFwd,
        btnReload,
        h('span', { class: 'dp-sep' }),
        btnFollow,
        btnSync,
        h('span', { class: 'dp-flex' }),
        zoomSelect,
        zoomInput,
        btnShot
      )
    );

    // ------------------------------------------------------------------ stage
    const progress = h('div', { class: 'dp-progress', hidden: true });
    const device = h('div', { class: 'dp-device' });
    const sizer = h('div', { class: 'dp-sizer' }, device);
    const msgTitle = h('div', { class: 'dp-msg-title' });
    const msgBody = h('div', { class: 'dp-msg-body' });
    const msgActions = h('div', { class: 'dp-msg-actions' });
    const message = h('div', { class: 'dp-msg', hidden: true, role: 'alert' }, h('div', { class: 'dp-msg-icon' }, icon('warning', 22)), msgTitle, msgBody, msgActions);
    const stage = h('div', { class: 'dp-stage' }, sizer, message);
    const hud = h('pre', { class: 'dp-hud', hidden: true, 'aria-live': 'polite' });
    const stageWrap = h('div', { class: 'dp-stage-wrap' }, progress, stage, hud);

    // ------------------------------------------------------------------ status bar
    const address = h('input', { class: 'dp-address', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Preview address' });
    const meta = h('button', { class: 'dp-meta', type: 'button', onclick: () => P.save({ debugHud: !prefs.debugHud }) });
    const statusbar = h('div', { class: 'dp-status' }, address, meta);

    const resizer = h('div', {
      class: 'dp-resizer',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize preview panel',
      title: 'Drag to resize · double-click to reset',
      tabindex: '0'
    });
    const toast = h('div', { class: 'dp-toast', role: 'status' });
    const shade = h('div', { class: 'dp-shade', hidden: true });
    const resizeHandles = ['e', 'w', 's', 'se', 'sw'].map((dir) => h('div', { class: `dp-rz dp-rz-${dir}`, 'data-dir': dir }));
    const panel = h('div', { class: 'dp' }, resizer, toolbar, stageWrap, statusbar, ...resizeHandles, toast, shade);
    root.appendChild(panel);
    placeHost();

    // Keys typed in the panel shouldn't trigger the page's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(type, (e) => {
        const t = e.target;
        const field = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT');
        if (type === 'keydown' && e.key === 'Escape' && !field) onRequestClose();
        e.stopPropagation();
      });
    }

    // ------------------------------------------------------------------ toast + messages
    let toastTimer = 0;
    function showToast(text, ms) {
      toast.textContent = text;
      toast.classList.add('dp-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('dp-show'), ms || 2400);
    }

    function showMessage(title, body, actions) {
      msgTitle.textContent = title;
      msgBody.textContent = body;
      msgActions.textContent = '';
      for (const a of actions || []) {
        msgActions.appendChild(h('button', { class: `dp-btn dp-text${a.primary ? ' dp-primary' : ''}`, type: 'button', onclick: a.run }, a.label));
      }
      message.hidden = false;
      sizer.classList.add('dp-dim');
    }
    function hideMessage() {
      message.hidden = true;
      sizer.classList.remove('dp-dim');
    }

    function handleSendError(e, what) {
      if (errorText(e) === 'context-invalidated' || /context invalidated/i.test(errorText(e))) {
        showMessage('DevicePeek was updated', 'Reload this page to keep using the preview.', [{ label: 'Reload page', primary: true, run: () => location.reload() }]);
      } else {
        showToast(`${what}: ${errorText(e)}`, 4000);
      }
    }

    // ------------------------------------------------------------------ preview
    const persistUrl = debounce((url) => {
      send({ type: 'dp:previewUrl', url }).catch(() => {});
    }, 400);

    const preview = NS.createPreview(device, {
      onState(state) {
        if (state === 'loading') actual = null;
        progress.hidden = state !== 'loading';
        if (mounted) layoutSoon(); // engine label in the status bar
        if (state === 'blocked') {
          const actions = [{ label: 'Retry', primary: true, run: () => (hideMessage(), preview.reload()) }];
          if (preview.engine === 'direct') actions.push({ label: 'Compatibility mode', run: () => (hideMessage(), preview.setEngine('compat')) });
          actions.push({ label: 'Open device window', run: openDeviceWindow });
          showMessage(
            'This website prevents embedded previews.',
            "The page refused to load inside a frame (X-Frame-Options or CSP frame-ancestors) and the header couldn't be removed – often because a service worker served it. It can also mean the address isn't reachable.",
            actions
          );
        } else if (state === 'ready' || state === 'loading') {
          hideMessage();
        }
        if (state === 'ready' && desktopScroll) {
          setTimeout(() => desktopScroll && preview.setScroll(desktopScroll.ratio()), 300);
        }
      },
      onLocation(href) {
        if (root.activeElement !== address) address.value = href;
        address.title = href;
        btnBack.disabled = !preview.canBack();
        btnFwd.disabled = !preview.canForward();
        persistUrl(href);
      },
      onMetrics(m) {
        actual = m;
        renderMeta();
      },
      onScroll(r) {
        if (desktopScroll && prefs.syncScroll && prefs.syncScrollTwoWay) desktopScroll.set(r);
      }
    });

    // Pages whose own CSP forbids frames: switch to the compatibility engine automatically.
    const onCspViolation = (e) => {
      if (!mounted || preview.engine !== 'direct') return;
      const dir = String(e.effectiveDirective || e.violatedDirective || '');
      if (!/^(frame-src|child-src|default-src)/.test(dir)) return;
      const blocked = String(e.blockedURI || '');
      const target = preview.url || initialUrl;
      let sameOrigin = false;
      try {
        sameOrigin = new URL(blocked, location.href).origin === new URL(target).origin;
      } catch (err) {}
      if (blocked === 'self' || sameOrigin || blocked === target) {
        preview.setEngine('compat');
        showToast("Compatibility mode: this page's security policy blocks frames.", 4000);
      }
    };

    function openDeviceWindow() {
      send({ type: 'dp:openWindow', url: preview.url || location.href, width: vp.W, height: vp.H, os: vp.os }).then(
        (r) => {
          if (r && r.ok === false) showToast(r.message || 'Could not open the window.', 4000);
        },
        (e) => handleSendError(e, 'Could not open the window')
      );
    }

    // ------------------------------------------------------------------ layout
    function layout() {
      const availW = stage.clientWidth - STAGE_PAD * 2;
      const availH = stage.clientHeight - STAGE_PAD * 2;
      if (prefs.zoom === 'fit') scale = clamp(Math.min(1, availW / vp.W, availH / vp.H), 0.1, 1);
      else scale = prefs.zoom;
      // The sizer reserves the scaled footprint; the viewport itself is always exactly W×H CSS px
      // (locked with min/max in CSS) and only scaled visually with a transform.
      sizer.style.width = `${Math.round(vp.W * scale)}px`;
      sizer.style.height = `${Math.round(vp.H * scale)}px`;
      device.style.setProperty('--dp-vw', `${vp.W}px`);
      device.style.setProperty('--dp-vh', `${vp.H}px`);
      device.style.transform = `scale(${scale})`;
      renderMeta();
    }

    // Status bar + debug readout. "actual" comes from inside the preview frame.
    let actual = null;
    function renderMeta() {
      const pct = Math.round(scale * 100);
      const mismatch = !!actual && (actual.w !== vp.W || actual.h !== vp.H);
      meta.textContent =
        `${vp.W} × ${vp.H} · ${vp.dpr}x${pct !== 100 ? ` · ${pct}%` : ''}${preview.engine === 'compat' ? ' · compat' : ''}` +
        (mismatch ? ` · actual ${actual.w} × ${actual.h}` : '');
      meta.classList.toggle('dp-warn', mismatch);
      meta.title =
        `${vp.device.id === 'custom' ? 'Custom size' : vp.device.name} – viewport ${vp.W}×${vp.H} CSS px, pixel ratio ${vp.dpr}, shown at ${pct}%.` +
        (mismatch ? ` The page reports ${actual.w}×${actual.h}.` : '') +
        ' Click for the viewport readout.';
      hud.hidden = !prefs.debugHud;
      if (!prefs.debugHud) return;
      const rect = preview.element ? preview.element.getBoundingClientRect() : null;
      hud.textContent = [
        `Configured     ${vp.W} × ${vp.H}`,
        `Frame element  ${preview.element ? `${preview.element.offsetWidth} × ${preview.element.offsetHeight}` : '–'}`,
        `innerWidth     ${actual ? actual.w : '–'}`,
        `innerHeight    ${actual ? actual.h : '–'}`,
        `Pixel ratio    ${vp.dpr} (reported to page scripts)`,
        `Scale          ${scale.toFixed(2)}${rect ? `  (on screen ${Math.round(rect.width)} × ${Math.round(rect.height)})` : ''}`,
        actual ? (mismatch ? 'MISMATCH – viewport differs from the device' : 'OK – viewport matches the device') : 'Waiting for the page…'
      ].join('\n');
      hud.classList.toggle('dp-warn', mismatch);
    }
    const layoutSoon = rafThrottle(layout);

    function syncControls() {
      deviceSelect.value = prefs.deviceId;
      if (root.activeElement !== inW) inW.value = String(vp.W);
      if (root.activeElement !== inH) inH.value = String(vp.H);
      btnRotate.setAttribute('aria-pressed', String(prefs.landscape));
      btnFollow.setAttribute('aria-pressed', String(prefs.followPage));
      btnFollow.title = prefs.followPage ? 'Follow desktop page: on' : 'Follow desktop page: off';
      btnSync.setAttribute('aria-pressed', String(prefs.syncScroll));
      btnSync.title = prefs.syncScroll ? `Sync scroll: on${prefs.syncScrollTwoWay ? ' (two-way)' : ''}` : 'Sync scroll: off';
      const preset = P.ZOOM_PRESETS.find((z) => String(z) === String(prefs.zoom));
      const customZoom = preset === undefined;
      zoomSelect.value = customZoom ? 'custom' : String(prefs.zoom);
      zoomInput.hidden = !customZoom && zoomSelect.value !== 'custom';
      if (root.activeElement !== zoomInput && prefs.zoom !== 'fit') zoomInput.value = String(Math.round(prefs.zoom * 100));
      const floating = isFloating();
      panel.classList.toggle('dp-floating', floating);
      panel.classList.toggle('dp-minimized', floating && minimized);
      btnMode.replaceChildren(icon(floating ? 'dock' : 'float'));
      btnMode.title = floating ? 'Dock to the right (side-by-side)' : 'Pop out as floating window';
      btnMode.setAttribute('aria-label', btnMode.title);
      btnMax.replaceChildren(icon(maximized ? 'restore' : 'maximize'));
      btnMax.title = maximized ? 'Restore size' : 'Maximize';
      btnMax.setAttribute('aria-label', btnMax.title);
      btnMin.title = minimized ? 'Expand' : 'Minimize';
      btnMin.setAttribute('aria-label', btnMin.title);
      btnMin.setAttribute('aria-pressed', String(minimized));
    }

    // ------------------------------------------------------------------ width / docking
    const dock = NS.createDock(() => host);
    const applyDockLive = throttle((w) => dock.apply(w), 80);

    function setWidth(w, { live } = {}) {
      width = P.clampPanelWidth(w, window.innerWidth);
      resizer.setAttribute('aria-valuenow', String(width));
      if (!isFloating()) {
        placeHost();
        if (live) applyDockLive(width);
        else {
          dock.apply(width);
          dock.rescan();
        }
      }
      layoutSoon();
    }

    function applyMode() {
      if (!isFloating()) {
        maximized = false;
        minimized = false;
      }
      syncControls();
      placeHost();
      if (!isFloating()) {
        dock.apply(width);
        dock.start();
      } else {
        dock.stop();
        dock.apply(0);
      }
      NS.notifyPageResize();
    }

    // ------------------------------------------------------------------ floating window
    // Shared pointer handling for move/resize: iframes stop eating events, one update per frame.
    function pointerOp(e, cursor, onMove, onEnd) {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      panel.classList.add('dp-busy');
      panel.style.cursor = cursor;
      const move = rafThrottle(onMove);
      const onPointerMove = (ev) => move(ev);
      const finish = () => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', finish);
        target.removeEventListener('pointercancel', finish);
        move.cancel();
        panel.classList.remove('dp-busy');
        panel.style.cursor = '';
        onEnd();
      };
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', finish);
      target.addEventListener('pointercancel', finish);
    }

    function commitRect() {
      if (!liveRect) return;
      const r = liveRect;
      liveRect = null;
      prefs = Object.assign({}, prefs, { floatX: r.x, floatY: r.y, floatW: r.w, floatH: r.h });
      placeHost();
      P.save({ floatX: r.x, floatY: r.y, floatW: r.w, floatH: r.h });
    }

    function setMaximized(on) {
      if (!isFloating()) return;
      maximized = on;
      if (on) minimized = false;
      syncControls();
      placeHost();
    }
    function setMinimized(on) {
      if (!isFloating()) return;
      minimized = on;
      if (on) maximized = false;
      syncControls();
      placeHost();
    }

    // Move: drag any empty part of the toolbar.
    toolbar.addEventListener('pointerdown', (e) => {
      if (!isFloating() || e.button !== 0 || e.target.closest('button, select, input')) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let start = floatRect();
      if (maximized) {
        // Pull the window out of the maximized state under the pointer.
        maximized = false;
        syncControls();
        const r = floatRect();
        start = { x: clamp(e.clientX - r.w / 2, 0, Math.max(0, window.innerWidth - r.w)), y: 0, w: r.w, h: r.h };
      }
      pointerOp(
        e,
        'move',
        (ev) => {
          const hh = minimized ? minimizedHeight() : start.h;
          liveRect = {
            x: Math.round(clamp(start.x + ev.clientX - sx, 0, Math.max(0, window.innerWidth - start.w))),
            y: Math.round(clamp(start.y + ev.clientY - sy, 0, Math.max(0, window.innerHeight - hh))),
            w: start.w,
            h: start.h
          };
          placeHost();
        },
        commitRect
      );
    });
    toolbar.addEventListener('dblclick', (e) => {
      if (isFloating() && !e.target.closest('button, select, input')) setMaximized(!maximized);
    });

    // Resize: side edges, bottom edge and bottom corners.
    for (const handle of resizeHandles) {
      const dir = handle.dataset.dir;
      handle.addEventListener('pointerdown', (e) => {
        if (!isFloating() || maximized || minimized || e.button !== 0) return;
        e.preventDefault();
        const sx = e.clientX;
        const sy = e.clientY;
        const r = floatRect();
        const minW = P.LIMITS.floatMinW;
        const minH = P.LIMITS.floatMinH;
        const cursor = { e: 'ew-resize', w: 'ew-resize', s: 'ns-resize', se: 'nwse-resize', sw: 'nesw-resize' }[dir];
        pointerOp(
          e,
          cursor,
          (ev) => {
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            let { x, y, w, h: hh } = r;
            if (dir.includes('e')) w = clamp(r.w + dx, minW, window.innerWidth - r.x);
            if (dir.includes('w')) {
              w = clamp(r.w - dx, minW, r.x + r.w);
              x = r.x + r.w - w;
            }
            if (dir.includes('s')) hh = clamp(r.h + dy, minH, window.innerHeight - r.y);
            liveRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
            placeHost();
          },
          commitRect
        );
      });
    }

    // Divider drag
    resizer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      dragging = true;
      panel.classList.add('dp-dragging');
      const startX = e.clientX;
      const startW = width;
      const move = rafThrottle((x) => setWidth(startW + (startX - x), { live: true }));
      const onMove = (ev) => move(ev.clientX);
      const onUp = () => {
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        resizer.removeEventListener('pointercancel', onUp);
        move.cancel();
        applyDockLive.cancel();
        dragging = false;
        panel.classList.remove('dp-dragging');
        setWidth(width);
        dock.rescan();
        NS.notifyPageResize();
        P.save({ panelWidth: width });
      };
      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
      resizer.addEventListener('pointercancel', onUp);
    });
    resizer.addEventListener('dblclick', () => {
      setWidth(P.DEFAULTS.panelWidth);
      dock.rescan();
      NS.notifyPageResize();
      P.save({ panelWidth: width });
    });
    const saveWidthSoon = debounce(() => {
      dock.rescan();
      NS.notifyPageResize();
      P.save({ panelWidth: width });
    }, 400);
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setWidth(width + (e.key === 'ArrowLeft' ? 16 : -16));
      saveWidthSoon();
    });

    // ------------------------------------------------------------------ controls
    deviceSelect.addEventListener('change', () => P.save({ deviceId: deviceSelect.value }));
    const onDims = () => {
      const w = Math.round(Number(inW.value));
      const hh = Math.round(Number(inH.value));
      if (!Number.isFinite(w) || !Number.isFinite(hh) || w <= 0 || hh <= 0) {
        inW.value = String(vp.W);
        inH.value = String(vp.H);
        showToast(`Enter a size between ${P.LIMITS.dimMin} and ${P.LIMITS.dimMax} px.`);
        return;
      }
      if (w === vp.W && hh === vp.H) return;
      const [cw, ch] = prefs.landscape ? [hh, w] : [w, hh];
      P.save({ deviceId: 'custom', customW: cw, customH: ch });
    };
    for (const input of [inW, inH]) {
      input.addEventListener('change', onDims);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }
    zoomSelect.addEventListener('change', () => {
      const v = zoomSelect.value;
      if (v === 'custom') {
        zoomInput.hidden = false;
        zoomInput.value = String(Math.round(scale * 100));
        zoomInput.focus();
        zoomInput.select();
        return;
      }
      zoomInput.hidden = true;
      P.save({ zoom: v === 'fit' ? 'fit' : Number(v) });
    });
    zoomInput.addEventListener('change', () => {
      const pct = Number(zoomInput.value);
      if (!Number.isFinite(pct) || pct < 10 || pct > 300) {
        showToast('Zoom must be between 10% and 300%.');
        return;
      }
      P.save({ zoom: pct / 100 });
    });
    zoomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') zoomInput.blur();
    });

    address.addEventListener('focus', () => address.select());
    address.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        address.value = preview.url;
        address.blur();
      } else if (e.key === 'Enter') {
        const url = NS.urls.parseTyped(address.value, preview.url || location.href);
        if (!url) {
          showToast('Enter a valid web address (http:// or https://).');
          return;
        }
        address.blur();
        hideMessage();
        preview.navigate(url);
      }
    });
    address.addEventListener('blur', () => {
      address.value = preview.url;
    });

    // ------------------------------------------------------------------ screenshot
    let capturing = false;
    async function screenshot() {
      if (capturing) return;
      capturing = true;
      btnShot.disabled = true;
      toast.classList.remove('dp-show');
      try {
        const res = await NS.captureViewport({
          vp,
          pageUrl: preview.url || location.href,
          downloadRoot: root,
          enterCapture() {
            const s = Math.min(1, (window.innerWidth - 16) / vp.W, (window.innerHeight - 16) / vp.H);
            shade.hidden = false;
            panel.classList.remove('dp-minimized'); // the viewport must be rendered to be captured
            device.classList.add('dp-capturing');
            device.style.transform = `scale(${s})`;
            return device;
          },
          exitCapture() {
            shade.hidden = true;
            device.classList.remove('dp-capturing');
            panel.classList.toggle('dp-minimized', isFloating() && minimized);
            layout();
          }
        });
        showToast(`Saved ${res.name}`);
      } catch (e) {
        handleSendError(e, 'Screenshot failed');
      } finally {
        capturing = false;
        btnShot.disabled = false;
      }
    }

    // ------------------------------------------------------------------ scroll sync
    function applySync() {
      if (prefs.syncScroll && !desktopScroll) {
        desktopScroll = NS.createDesktopScroll((r) => preview.setScroll(r), () => host);
      } else if (!prefs.syncScroll && desktopScroll) {
        desktopScroll.stop();
        desktopScroll = null;
      }
    }

    // ------------------------------------------------------------------ prefs
    async function applyPrefs(next) {
      const prev = prefs;
      prefs = next;
      const prevVp = vp;
      vp = devices.resolve(prefs);
      syncControls();
      if (prev.panelWidth !== prefs.panelWidth && !dragging) setWidth(prefs.panelWidth);
      if (prev.mode !== prefs.mode) applyMode();
      else if (isFloating() && !liveRect && ['floatX', 'floatY', 'floatW', 'floatH'].some((k) => prev[k] !== prefs[k])) placeHost();
      if (prev.syncScroll !== prefs.syncScroll) applySync();
      if (!prev.followPage && prefs.followPage) followDesktop(location.href);
      layout();
      if (prevVp.os !== vp.os || prevVp.dpr !== vp.dpr) {
        try {
          if (prevVp.os !== vp.os) await send({ type: 'dp:setOs', os: vp.os }); // header rule first, then reload
        } catch (e) {
          handleSendError(e, 'Could not switch device');
        }
        if (mounted) preview.setDevice(vp.os, vp.dpr);
      }
    }

    function followDesktop(href) {
      if (!prefs.followPage || !mounted) return;
      if (href === preview.url) return;
      hideMessage();
      preview.navigate(href);
    }

    // ------------------------------------------------------------------ lifecycle
    // Re-attach if a framework re-renders <html> and drops our node or its style.
    const keepAttached = new MutationObserver(() => {
      if (!mounted) return;
      if (!host.isConnected) document.documentElement.appendChild(host);
      if (!isFloating()) dock.ensure();
    });

    const resizeSoon = debounce(() => {
      if (isFloating()) placeHost(); // keep the window inside the viewport
      else setWidth(prefs.panelWidth);
      layout();
    }, 120);
    const onWindowResize = (e) => {
      if (e.isTrusted) resizeSoon(); // ignore our own synthetic resize events
    };

    function mount() {
      if (mounted) return;
      mounted = true;
      document.documentElement.appendChild(host);
      panel.classList.add('dp-enter');
      setTimeout(() => panel.classList.remove('dp-enter'), ANIM_MS + 40);
      syncControls();
      applyMode();
      preview.setDevice(vp.os, vp.dpr, { reload: false });
      preview.load(initialUrl);
      applySync();
      layout();

      const ro = new ResizeObserver(layoutSoon);
      ro.observe(stage);
      keepAttached.observe(document.documentElement, { childList: true, attributes: true, attributeFilter: ['style'] });
      window.addEventListener('resize', onWindowResize);
      document.addEventListener('securitypolicyviolation', onCspViolation);
      cleanups.push(() => {
        ro.disconnect();
        keepAttached.disconnect();
        window.removeEventListener('resize', onWindowResize);
        resizeSoon.cancel();
        document.removeEventListener('securitypolicyviolation', onCspViolation);
      });
    }

    function unmount({ animate = true } = {}) {
      if (!mounted) return Promise.resolve();
      mounted = false;
      cleanups.splice(0).forEach((f) => f());
      if (desktopScroll) desktopScroll.stop();
      desktopScroll = null;
      persistUrl.cancel();
      const finish = () => {
        preview.destroy();
        host.remove();
        dock.stop();
        dock.apply(0);
        NS.notifyPageResize();
      };
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!animate || reduce) {
        finish();
        return Promise.resolve();
      }
      panel.classList.add('dp-leave');
      return new Promise((resolve) =>
        setTimeout(() => {
          finish();
          resolve();
        }, ANIM_MS)
      );
    }

    return {
      mount,
      unmount,
      applyPrefs,
      onDesktopNavigate: followDesktop,
      get mounted() {
        return mounted;
      },
      get host() {
        return host;
      }
    };
  }

  NS.createPanel = createPanel;
  NS.PANEL_HOST_TAG = HOST_TAG;
})(globalThis);
