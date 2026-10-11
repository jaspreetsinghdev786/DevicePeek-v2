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
    const minimizedHeight = () => Math.ceil(titlebar.getBoundingClientRect().height) + 2;

    // The host's inline style is rebuilt from scratch every time. (Setting `all: initial` on
    // top of the previous inline style does not clear longhands that were already set with
    // !important, so the floating left/height used to leak into docked mode.)
    // cssText is CSSOM, so a page's CSP can't block it.
    function placeHost() {
      const decl = { all: 'initial', position: 'fixed', 'z-index': '2147483647', display: 'block' };
      // A page that sets CSS zoom on <html> would also shrink/enlarge the preview viewport.
      // Cancel it so 1 viewport px stays 1 CSS px.
      const pageZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      if (Math.abs(pageZoom - 1) > 0.001) decl.zoom = String(1 / pageZoom);
      if (isFloating()) {
        const r = liveRect || floatRect();
        Object.assign(decl, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${minimized ? minimizedHeight() : r.h}px` });
      } else {
        Object.assign(decl, { top: '0', right: '0', bottom: '0', width: `${width}px` });
      }
      const css = Object.entries(decl)
        .map(([k, v]) => `${k}: ${v} !important;`)
        .join(' ');
      if (css !== lastHostCss || !host.style.length) {
        lastHostCss = css;
        host.style.cssText = css;
      }
    }
    let lastHostCss = '';
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
    const group = (cls, ...kids) => h('div', { class: `dp-group${cls ? ' ' + cls : ''}` }, ...kids);

    // ------------------------------------------------------------------ toolbar
    // Row 1: device picker · size + rotate · window controls
    // Row 2: navigation · follow/sync/frame toggles · zoom stepper · screenshot
    const deviceSelect = h('select', { class: 'dp-select', 'aria-label': 'Device', title: 'Device' });
    devices.fillSelect(deviceSelect);
    const deviceGlyph = h('span', { class: 'dp-field-ico', 'aria-hidden': 'true' });
    const deviceField = h('label', { class: 'dp-field dp-device-field' }, deviceGlyph, deviceSelect, h('span', { class: 'dp-caret', 'aria-hidden': 'true' }, icon('chevron', 14)));
    const inW = h('input', { class: 'dp-num', type: 'number', min: P.LIMITS.dimMin, max: P.LIMITS.dimMax, 'aria-label': 'Viewport width', title: 'Width (CSS px)' });
    const inH = h('input', { class: 'dp-num', type: 'number', min: P.LIMITS.dimMin, max: P.LIMITS.dimMax, 'aria-label': 'Viewport height', title: 'Height (CSS px)' });
    const btnRotate = iconBtn('rotate', 'Rotate (portrait / landscape)', () => P.save({ landscape: !prefs.landscape }), 'dp-toggle');
    const btnShot = h('button', { class: 'dp-btn dp-shot', type: 'button', title: 'Save a PNG of the preview screen', 'aria-label': 'Screenshot of the preview', onclick: () => screenshot() }, icon('camera'));
    const btnClose = iconBtn('close', 'Close DevicePeek', () => onRequestClose(), 'dp-close');
    const btnMode = iconBtn('float', 'Pop out as floating window', () => P.save({ mode: isFloating() ? 'side' : 'floating' }));
    const btnMin = iconBtn('minimize', 'Minimize', () => setMinimized(!minimized), 'dp-float-only');
    const btnMax = iconBtn('maximize', 'Maximize', () => setMaximized(!maximized), 'dp-float-only');
    const btnBack = iconBtn('back', 'Back', () => preview.back());
    const btnFwd = iconBtn('forward', 'Forward', () => preview.forward());
    const btnReload = iconBtn('reload', 'Reload preview', () => preview.reload());
    const btnFollow = iconBtn('follow', 'Follow desktop page', () => P.save({ followPage: !prefs.followPage }), 'dp-toggle');
    const btnSync = iconBtn('sync', 'Sync scroll', () => P.save({ syncScroll: !prefs.syncScroll }), 'dp-toggle');
    const btnFrame = iconBtn('frame', 'Device frame', () => P.save({ showFrame: !prefs.showFrame }), 'dp-toggle');
    const btnZoomOut = iconBtn('zoomOut', 'Zoom out', () => stepZoom(-1));
    const btnZoomIn = iconBtn('zoomIn', 'Zoom in', () => stepZoom(1));
    const zoomSelect = h(
      'select',
      { class: 'dp-select dp-zoom', 'aria-label': 'Zoom', title: 'Zoom (only changes how big the preview looks)' },
      h('option', { value: 'fit', text: 'Fit' }),
      ...P.ZOOM_PRESETS.filter((z) => z !== 'fit').map((z) => h('option', { value: String(z), text: `${Math.round(z * 100)}%` }))
    );
    // A zoom that isn't a preset (from − / + or typed in) is shown as its own entry.
    const zoomCurrent = h('option', { value: 'current' });
    const zoomCustom = h('option', { value: 'custom', text: 'Custom…' });
    zoomSelect.append(zoomCurrent, zoomCustom);
    // Typing a zoom swaps the menu for a number field in the same spot (the bar never reflows).
    const zoomInput = h('input', { class: 'dp-num dp-zoom-custom', type: 'number', min: 10, max: 300, step: 5, 'aria-label': 'Custom zoom in percent', title: 'Zoom % (Enter to apply)', hidden: true });

    // Window controls live in row 1 when docked and move to the title bar when floating.
    const winControls = h('div', { class: 'dp-win' }, btnMin, btnMax, btnMode, btnClose);
    const row1 = h(
      'div',
      { class: 'dp-row' },
      deviceField,
      group('dp-dims', inW, h('span', { class: 'dp-x', text: '×', 'aria-hidden': 'true' }), inH, h('span', { class: 'dp-vsep', 'aria-hidden': 'true' }), btnRotate),
      winControls
    );
    const row2 = h(
      'div',
      { class: 'dp-row' },
      group('dp-nav', btnBack, btnFwd, btnReload),
      group('dp-toggles', btnFollow, btnSync, btnFrame),
      group('dp-zoom-group', btnZoomOut, zoomSelect, zoomInput, btnZoomIn),
      btnShot
    );
    const toolbar = h('div', { class: 'dp-toolbar', role: 'toolbar', 'aria-label': 'DevicePeek' }, h('div', { class: 'dp-bar' }, row1, row2));

    // Floating window title bar: drag to move, double-click to maximize.
    const titleHost = h('span', { class: 'dp-title-host' });
    const titlebar = h(
      'div',
      { class: 'dp-titlebar' },
      h('span', { class: 'dp-grip', 'aria-hidden': 'true' }, icon('grip')),
      h('span', { class: 'dp-title-brand', text: 'DevicePeek' }),
      titleHost
    );

    // ------------------------------------------------------------------ stage
    // .dp-bezel is the optional device frame. It carries the zoom transform; the viewport
    // (.dp-device) inside it is always exactly W×H CSS px and never covered by the frame.
    const progress = h('div', { class: 'dp-progress', hidden: true });
    const device = h('div', { class: 'dp-device' });
    const bezel = h(
      'div',
      { class: 'dp-bezel' },
      device,
      h('span', { class: 'dp-bz dp-bz-cam', 'aria-hidden': 'true' }),
      h('span', { class: 'dp-bz dp-bz-speaker', 'aria-hidden': 'true' }),
      h('span', { class: 'dp-bz dp-bz-home', 'aria-hidden': 'true' }),
      h('span', { class: 'dp-bz dp-bz-power', 'aria-hidden': 'true' }),
      h('span', { class: 'dp-bz dp-bz-vol', 'aria-hidden': 'true' })
    );
    const sizer = h('div', { class: 'dp-sizer' }, bezel);
    const msgIcon = h('div', { class: 'dp-msg-icon' }, icon('warning', 22));
    const msgTitle = h('div', { class: 'dp-msg-title' });
    const msgBody = h('div', { class: 'dp-msg-body' });
    const msgActions = h('div', { class: 'dp-msg-actions' });
    const message = h('div', { class: 'dp-msg', hidden: true, role: 'alert' }, msgIcon, msgTitle, msgBody, msgActions);
    const stage = h('div', { class: 'dp-stage' }, sizer, message);
    const hud = h('pre', { class: 'dp-hud', hidden: true, 'aria-live': 'polite' });
    const stageWrap = h('div', { class: 'dp-stage-wrap' }, progress, stage, hud);

    // ------------------------------------------------------------------ status bar
    const address = h('input', { class: 'dp-address', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Preview address', placeholder: 'Type a URL or /path' });
    const addressIcon = h('span', { class: 'dp-addr-ico', 'aria-hidden': 'true' });
    const addressField = h('label', { class: 'dp-addr' }, addressIcon, address);
    const engineBadge = h('span', { class: 'dp-badge', hidden: true, title: "Compatibility mode: the preview runs inside an extension page because this site's security policy blocks frames.", text: 'compat' });
    const meta = h('button', { class: 'dp-meta', type: 'button', onclick: () => P.save({ debugHud: !prefs.debugHud }) });
    const statusbar = h('div', { class: 'dp-status' }, addressField, engineBadge, meta);

    const resizer = h('div', {
      class: 'dp-resizer',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize preview panel',
      'aria-valuemin': String(P.LIMITS.panelMin),
      title: 'Drag to resize · double-click to reset',
      tabindex: '0'
    });
    const toastIcon = h('span', { class: 'dp-toast-ico', 'aria-hidden': 'true' });
    const toastText = h('span');
    const toast = h('div', { class: 'dp-toast', role: 'status' }, toastIcon, toastText);
    const shade = h('div', { class: 'dp-shade', hidden: true });
    const resizeHandles = ['e', 'w', 's', 'se', 'sw'].map((dir) => h('div', { class: `dp-rz dp-rz-${dir}`, 'data-dir': dir }));
    const panel = h('div', { class: 'dp' }, resizer, titlebar, toolbar, stageWrap, statusbar, ...resizeHandles, toast, shade);
    panel.dataset.theme = prefs.theme;
    root.appendChild(panel);
    placeHost();

    // Keys typed in the panel shouldn't trigger the page's keyboard shortcuts.
    // Shortcuts while the panel has focus (outside text fields): + / − zoom, 0 = Fit.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      root.addEventListener(type, (e) => {
        const t = e.target;
        const field = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT');
        if (type === 'keydown' && !field && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key === 'Escape') onRequestClose();
          else if (e.key === '+' || e.key === '=') stepZoom(1);
          else if (e.key === '-' || e.key === '_') stepZoom(-1);
          else if (e.key === '0') P.save({ zoom: 'fit' });
        }
        e.stopPropagation();
      });
    }

    // ------------------------------------------------------------------ toast + messages
    let toastTimer = 0;
    function showToast(text, ms, kind) {
      toastText.textContent = text;
      toastIcon.replaceChildren(icon(kind === 'ok' ? 'check' : 'info', 15));
      toast.classList.toggle('dp-ok', kind === 'ok');
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
        const secure = /^https:/i.test(href);
        addressIcon.replaceChildren(icon(secure ? 'lock' : 'globe', 13));
        addressField.classList.toggle('dp-secure', secure);
        let hostLabel = '';
        try {
          const u = new URL(href);
          hostLabel = u.host || (u.protocol === 'file:' ? 'local file' : '');
        } catch (e) {}
        titleHost.textContent = hostLabel;
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
    const NO_FRAME = { pad: [0, 0, 0, 0], outer: 10, screen: 10 };
    function layout() {
      if (bezel.classList.contains('dp-capturing')) return; // screenshot in progress
      const g = prefs.showFrame ? devices.frameGeometry(vp.frame, vp.landscape) : NO_FRAME;
      const [pt, pr, pb, pl] = g.pad;
      const fw = vp.W + pl + pr; // device footprint incl. bezel, unscaled
      const fh = vp.H + pt + pb;
      const availW = stage.clientWidth - STAGE_PAD * 2;
      const availH = stage.clientHeight - STAGE_PAD * 2;
      if (prefs.zoom === 'fit') scale = clamp(Math.min(1, availW / fw, availH / fh), 0.1, 1);
      else scale = prefs.zoom;
      // The sizer reserves the scaled footprint; the viewport itself is always exactly W×H CSS px
      // (locked with min/max in CSS) and only scaled visually with a transform on the bezel.
      sizer.style.width = `${Math.round(fw * scale)}px`;
      sizer.style.height = `${Math.round(fh * scale)}px`;
      const bs = bezel.style;
      bs.setProperty('--dp-vw', `${vp.W}px`);
      bs.setProperty('--dp-vh', `${vp.H}px`);
      bs.setProperty('--dp-pt', `${pt}px`);
      bs.setProperty('--dp-pr', `${pr}px`);
      bs.setProperty('--dp-pb', `${pb}px`);
      bs.setProperty('--dp-pl', `${pl}px`);
      bs.setProperty('--dp-or', `${g.outer}px`);
      bs.setProperty('--dp-sr', `${g.screen}px`);
      bs.transform = `scale(${scale})`;
      bezel.className = `dp-bezel dp-f-${vp.frame}${vp.landscape ? ' dp-land' : ''}${prefs.showFrame ? ' dp-framed' : ''}`;
      renderMeta();
    }

    // Zoom in/out through a fixed ladder of steps, starting from the current (maybe Fit) scale.
    const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    function stepZoom(dir) {
      const cur = scale;
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.005) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.005);
      if (next != null) P.save({ zoom: next });
    }

    // Status bar + debug readout. "actual" comes from inside the preview frame.
    let actual = null;
    function renderMeta() {
      const pct = Math.round(scale * 100);
      const mismatch = !!actual && (actual.w !== vp.W || actual.h !== vp.H);
      meta.textContent = '';
      meta.append(
        h('b', { text: `${vp.W} × ${vp.H}` }),
        h('span', { class: 'dp-meta-dim', text: ` · ${vp.dpr}x · ${pct}%` }),
        mismatch ? h('span', { class: 'dp-meta-warn', text: ` · actual ${actual.w} × ${actual.h}` }) : ''
      );
      meta.classList.toggle('dp-warn', mismatch);
      engineBadge.hidden = preview.engine !== 'compat';
      meta.title =
        `${vp.device.id === 'custom' ? 'Custom size' : vp.device.name} – viewport ${vp.W}×${vp.H} CSS px, pixel ratio ${vp.dpr}, shown at ${pct}%.` +
        (mismatch ? ` The page reports ${actual.w}×${actual.h}.` : '') +
        ' Click for the viewport readout.';
      btnZoomOut.disabled = !ZOOM_STEPS.some((z) => z < scale - 0.005);
      btnZoomIn.disabled = !ZOOM_STEPS.some((z) => z > scale + 0.005);
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

    const setToggle = (btn, on, label) => {
      btn.setAttribute('aria-pressed', String(on));
      btn.title = `${label}: ${on ? 'on' : 'off'}`;
    };
    function syncControls() {
      panel.dataset.theme = prefs.theme;
      deviceSelect.value = prefs.deviceId;
      deviceGlyph.replaceChildren(icon(vp.frame === 'tablet' ? 'tablet' : 'phone', 16));
      deviceField.title = `${vp.device.id === 'custom' ? 'Custom size' : vp.device.name} · ${vp.os === 'android' ? 'Android' : vp.os === 'ipados' ? 'iPadOS' : 'iOS'} · ${vp.dpr}x`;
      if (root.activeElement !== inW) inW.value = String(vp.W);
      if (root.activeElement !== inH) inH.value = String(vp.H);
      btnRotate.setAttribute('aria-pressed', String(prefs.landscape));
      btnRotate.title = prefs.landscape ? 'Rotate to portrait' : 'Rotate to landscape';
      setToggle(btnFollow, prefs.followPage, 'Follow desktop page');
      setToggle(btnSync, prefs.syncScroll, prefs.syncScrollTwoWay ? 'Sync scroll (two-way)' : 'Sync scroll');
      setToggle(btnFrame, prefs.showFrame, 'Device frame');
      const preset = P.ZOOM_PRESETS.find((z) => String(z) === String(prefs.zoom));
      zoomCurrent.hidden = preset !== undefined;
      zoomCurrent.textContent = preset === undefined ? `${Math.round(prefs.zoom * 100)}%` : '';
      if (root.activeElement !== zoomInput) {
        zoomSelect.value = preset === undefined ? 'current' : String(prefs.zoom);
        zoomInput.hidden = true;
        zoomSelect.hidden = false;
      }
      const floating = isFloating();
      panel.classList.toggle('dp-floating', floating);
      panel.classList.toggle('dp-minimized', floating && minimized);
      panel.classList.toggle('dp-maximized', floating && maximized);
      const winHome = floating ? titlebar : row1;
      if (winControls.parentNode !== winHome) {
        // Moving a focused button blurs it; keep keyboard focus inside the panel.
        const focused = winControls.contains(root.activeElement) ? root.activeElement : null;
        winHome.appendChild(winControls);
        if (focused) focused.focus();
      }
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
      if (!liveRect) {
        placeHost(); // nothing moved; make sure the host matches the current state
        return;
      }
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

    // Move: drag the title bar or any empty part of the toolbar.
    function startMove(e) {
      if (!isFloating() || e.button !== 0 || e.target.closest('button, select, input, label')) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let start = floatRect();
      // A maximized window is only pulled out once the pointer really moves, so a click or a
      // double-click (restore) on the title bar leaves it alone.
      let pulled = !maximized;
      pointerOp(
        e,
        'grabbing',
        (ev) => {
          if (!pulled) {
            if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
            pulled = true;
            maximized = false;
            syncControls();
            const r = floatRect();
            start = { x: clamp(sx - r.w / 2, 0, Math.max(0, window.innerWidth - r.w)), y: 0, w: r.w, h: r.h };
          }
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
    }
    const toggleMaxOnDblClick = (e) => {
      if (isFloating() && !e.target.closest('button, select, input, label')) setMaximized(!maximized);
    };
    for (const el of [titlebar, toolbar]) {
      el.addEventListener('pointerdown', startMove);
      el.addEventListener('dblclick', toggleMaxOnDblClick);
    }

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
      if (v === 'current') return;
      if (v === 'custom') {
        zoomSelect.hidden = true;
        zoomInput.hidden = false;
        zoomInput.value = String(Math.round(scale * 100));
        zoomInput.focus();
        zoomInput.select();
        return;
      }
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
      else if (e.key === 'Escape') {
        zoomInput.value = '';
        zoomInput.blur();
      }
    });
    // Leaving the field without a valid value: show the zoom that is really in use again
    // (otherwise the menu could stay on "Custom…" while a preset is active).
    zoomInput.addEventListener('blur', () => setTimeout(syncControls, 0));

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
            // Screen only: the bezel collapses to the bare viewport while the tab is captured.
            const s = Math.min(1, (window.innerWidth - 16) / vp.W, (window.innerHeight - 16) / vp.H);
            shade.hidden = false;
            panel.classList.remove('dp-minimized'); // the viewport must be rendered to be captured
            bezel.classList.add('dp-capturing');
            bezel.style.transform = `scale(${s})`;
            return device;
          },
          exitCapture() {
            shade.hidden = true;
            bezel.classList.remove('dp-capturing');
            panel.classList.toggle('dp-minimized', isFloating() && minimized);
            layout();
          }
        });
        showToast(`Saved ${res.name}`, 2800, 'ok');
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
      },
      // For the automated tests only. Lives in the extension's isolated world, so page
      // scripts still can't reach the closed shadow root.
      get _testRoot() {
        return root;
      }
    };
  }

  NS.createPanel = createPanel;
  NS.PANEL_HOST_TAG = HOST_TAG;
})(globalThis);
