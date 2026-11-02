'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const api = window.installer;
  const state = { page: 'welcome', channel: 'latest', release: '', catalog: null, catalogError: null, game: null, chapters: [], key: null, keyFile: null,
    output: '', busy: false, phase: 'dependencies', message: '', progress: null, result: null, error: '', logs: [], drawer: false, startedAt: null };
  const phaseNames = { dependencies: 'Prepare build tools', source: 'Download selected source', compile: 'Compile and package the PKG', assets: 'Prepare chapter textures & videos', archive: 'Create and verify the USB ZIP' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const sequence = () => ['welcome', 'version', ...(state.channel === 'dev' ? ['key'] : []), 'game', 'review', 'progress', 'finish'];
  const label = page => ({ welcome: 'Introduction', version: 'Select a Version', key: 'Developer Access', game: 'Choose Your Chapters', review: 'Ready to Build', progress: 'Building', finish: 'Summary' }[page]);
  function announce(text) { $('#announcer').textContent = text; }
  function selectedName() { return state.channel === 'dev' ? 'Dev Beta' : state.channel === 'latest' ? state.catalog?.releases[0]?.name || 'Latest Beta' : state.catalog?.releases.find(r => r.tag === state.release)?.name || state.release; }
  function setPage(page) { state.page = page; closeMenu(); render(); $('#page').scrollTop = 0; $('#page').focus(); announce(label(page)); }
  function render() {
    const pages = sequence(), index = pages.indexOf(state.page);
    $('#steps').innerHTML = pages.map((p, i) => `<li class="${p === state.page ? 'current' : i < index ? 'done' : ''}" ${p === state.page ? 'aria-current="step"' : ''}>${label(p)}</li>`).join('');
    $('#back').hidden = ['welcome', 'progress', 'finish'].includes(state.page);
    $('#back').disabled = state.busy;
    $('#next').textContent = state.page === 'review' ? 'Build' : state.page === 'progress' ? 'Cancel' : state.page === 'finish' ? 'Done' : 'Continue';
    $('#next').classList.toggle('default', state.page !== 'progress'); $('#next').disabled = false;
    $('#footer-note').textContent = state.page === 'welcome' ? 'Welcome to Spider Donut' : state.page === 'progress' ? 'Please keep this app open.' : '';
    const page = $('#page');
    if (state.page === 'welcome') page.innerHTML = `
      <img class="intro-image" src="../assets/logo.png" alt=""><h1>Welcome to the<br>Spider Donut Installer</h1>
      <p class="welcome-lead">Your DELTARUNE chapters.<br>Ready for your PlayStation 3.</p><hr class="welcome-rule">
      <p>This assistant will guide you through building Spider Donut and preparing your own game files for PS3.</p>
      <ul class="feature-list"><li>Choose a beta or development version.</li><li>Select the chapters from your DELTARUNE copy.</li><li>Let the assistant compile and prepare everything.</li><li>Get a ZIP ready to copy to your USB drive.</li></ul>
      <p class="small subtle">You’ll need an internet connection and space for the build tools and your chapter files. First-time setup may require a Windows restart.</p><div class="version-stamp">Spider Donut · A Butterscotch-based runner for PS3</div>`;
    if (state.page === 'version') {
      const olderReleases = state.catalog?.releases.slice(1) || [];
      if (state.channel === 'older' && olderReleases.length && !olderReleases.some(r => r.tag === state.release)) state.release = olderReleases[0].tag;
      page.innerHTML = `<h1>Select a Version</h1><p>Which version of Spider Donut would you like to build?</p>
      <div class="choice-list">${[
        ['latest', 'Latest Beta', 'The newest public beta. Recommended for most players.'],
        ['dev', 'Dev Beta', 'The latest development build. An encrypted developer file and password are required.'],
        ['older', 'Older Versions', 'Choose an earlier public beta release.']
      ].map(([value, title, description]) => `<label class="choice-row"><input type="radio" name="channel" value="${value}" ${state.channel === value ? 'checked' : ''}><div><strong>${title}</strong><span>${description}</span>${value === 'older' && state.channel === 'older' && state.catalog ? olderReleases.length ? `<div class="release-picker select-wrap"><select id="release-select" aria-label="Beta release">${olderReleases.map(r => `<option value="${esc(r.tag)}" ${state.release === r.tag ? 'selected' : ''}>${esc(r.name)} (${esc(r.tag)})</option>`).join('')}</select></div>` : '<span>No earlier beta releases are available.</span>' : ''}</div></label>`).join('')}</div>
      <div class="status-line ${state.catalogError ? 'error' : ''}" id="catalog-status">${state.catalog ? `${state.catalog.cached ? 'Offline catalog · ' : ''}Latest release: ${esc(state.catalog.releases[0].tag)} · ${date(state.catalog.releases[0].date)}` : state.catalogError ? esc(state.catalogError) : '<span class="spinner"></span> Checking GitHub releases…'}</div>
      ${state.catalogError || state.catalog?.cached ? '<p><button class="link-button" id="refresh-releases">Check Again</button></p>' : ''}<p class="small subtle" style="margin-top:15px">Each build uses the source code from your selected version.</p>`;
      page.querySelectorAll('input[name=channel]').forEach(r => r.addEventListener('change', () => { state.channel = r.value; render(); page.querySelector(`input[value=${r.value}]`).focus(); }));
      $('#release-select')?.addEventListener('change', e => { state.release = e.target.value; });
      $('#refresh-releases')?.addEventListener('click', () => loadCatalog(true));
      $('#next').disabled = state.channel !== 'dev' && (!state.catalog || state.channel === 'older' && !olderReleases.length);
    }
    if (state.page === 'key') {
      page.innerHTML = `<h1>Developer Access</h1><p>Choose your encrypted developer file and enter the password supplied separately by the project owner.</p>
      <div class="key-card"><img src="../assets/document.svg" alt=""><div><strong>${state.key ? 'Developer key accepted' : state.keyFile ? 'Encrypted file selected' : 'A key file is required'}</strong><p>${state.key ? `${esc(state.key.subject)}<br>Expires ${date(state.key.expiresAt)}<br>${esc(state.key.filename)}` : state.keyFile ? esc(state.keyFile.filename) : 'Choose your .spiderkey file to continue.<br>The issuer signature is checked before unlocking.'}</p><button class="aqua-button" id="choose-key">${state.key || state.keyFile ? 'Choose Another…' : 'Choose Key File…'}</button></div></div>
      ${state.keyFile && !state.key ? '<form id="unlock-form"><label class="form-label" for="key-password">Key-file password</label><div class="password-row"><input class="password-field" type="password" id="key-password" required maxlength="1024" autocomplete="current-password" spellcheck="false"><button class="aqua-button default" type="submit">Unlock Key</button></div><div id="unlock-status" class="status-line" role="status"></div></form>' : ''}
      <div class="note-box">Development builds may contain unfinished changes. Use the public beta if you want the latest released version.</div><p class="small subtle">Need access? Ask the owner for an encrypted key file and its password.</p>`;
      $('#choose-key').addEventListener('click', async () => { try { const file = await api.chooseKey(); if (file) { state.key = null; state.keyFile = file; render(); $('#key-password')?.focus(); } } catch (e) { state.key = null; state.keyFile = null; render(); showError('This key could not be used', e); } });
      $('#unlock-form')?.addEventListener('submit', async e => {
        e.preventDefault(); const button = e.target.querySelector('button'), field = $('#key-password');
        if (button.disabled) return;
        button.disabled = true; $('#unlock-status').textContent = 'Unlocking the encrypted file…';
        const password = field.value; field.value = '';
        try { state.key = await api.unlockKey(password); render(); announce('Developer key accepted.'); }
        catch (error) { $('#unlock-status').textContent = error.message; $('#unlock-status').classList.add('error'); field.focus(); }
        finally { button.disabled = false; }
      });
      $('#next').disabled = !state.key;
    }
    if (state.page === 'game') {
      page.innerHTML = `<h1>Choose Your Chapters</h1><p>Locate your DELTARUNE copy, then choose which chapters to prepare.</p><div class="path-row"><input type="text" aria-label="DELTARUNE folder" readonly value="${esc(state.game?.selectedPath || '')}" placeholder="Choose your DELTARUNE folder…"><button class="aqua-button" id="choose-game">Browse…</button></div>
      ${state.game ? `<div class="status-line">${state.game.chapters.length} chapter${state.game.chapters.length === 1 ? '' : 's'} found in your game folder.</div><table class="chapter-table"><thead><tr><th></th><th>Chapter</th><th>Current status</th></tr></thead><tbody>${state.game.chapters.map(c => `<tr><td><input type="checkbox" id="chapter-${c.number}" value="${c.number}" ${state.chapters.includes(c.number) ? 'checked' : ''} aria-label="Include Chapter ${c.number}"></td><td><label for="chapter-${c.number}">Chapter ${c.number}</label></td><td>${esc(c.status)}</td></tr>`).join('')}</tbody></table><p class="small subtle" style="margin-top:12px">Each chapter gets its own texture bundle. Video files are converted automatically when supported by the selected version.</p>` : `<div class="note-box">Look for a folder with <code>chapter1_windows</code>, <code>chapter2_windows</code>, and so on. You can also choose one chapter folder directly.</div><p class="small subtle">For Steam copies, use Manage → Browse local files to find your DELTARUNE folder.</p>`}`;
      $('#choose-game').addEventListener('click', async () => { try { const game = await api.chooseGame(); if (game) { state.game = game; state.chapters = game.defaultChapters; render(); announce(`${game.chapters.length} chapters found.`); } } catch (e) { showError('No chapters were found', e); } });
      page.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', () => { state.chapters = [...page.querySelectorAll('input[type=checkbox]:checked')].map(n => Number(n.value)); $('#next').disabled = !state.chapters.length; }));
      $('#next').disabled = !state.game || !state.chapters.length;
    }
    if (state.page === 'review') {
      page.innerHTML = `<h1>Ready to Build</h1><p>The assistant will download the build tools, compile the PKG, and prepare your selected chapters.</p><dl class="summary-list"><div><dt>Version</dt><dd>${esc(selectedName())}</dd></div><div><dt>Chapters</dt><dd>${state.chapters.map(n => 'Chapter ' + n).join(', ')}</dd></div><div><dt>Game folder</dt><dd>${esc(state.game.selectedPath)}</dd></div></dl><h2>Save the finished ZIP in:</h2><div class="path-row"><input type="text" readonly aria-label="Output folder" value="${esc(state.output)}"><button class="aqua-button" id="choose-output">Change…</button></div><p class="small subtle">First-time setup takes longer. Later builds reuse downloaded tools. The ZIP will include the PKG, chapter files and a short setup guide.</p><p class="small subtle">Click Build to begin.</p>`;
      $('#choose-output').addEventListener('click', async () => { try { const output = await api.chooseOutput(); if (output) { state.output = output; render(); } } catch (e) { showError('Could not choose this folder', e); } });
    }
    if (state.page === 'progress') {
      page.innerHTML = `<h1>${state.error ? 'The Build Stopped' : 'Building Spider Donut'}</h1><p>${state.error ? 'Your original game files are safe. Review the log for details, then go back to try again.' : 'Preparing a complete USB-ready package from your selected version and chapters.'}</p>
      <ul class="build-phase-list" id="build-phases">${Object.entries(phaseNames).map(([phase, title]) => `<li data-phase="${phase}">${title}</li>`).join('')}</ul><div class="progress-track" id="progress-track" role="progressbar" aria-label="Current task"><div class="progress-fill" id="progress-fill"></div></div><div class="progress-message" id="progress-message"></div><div class="progress-details"><span id="build-elapsed"></span><button class="link-button" id="show-log">Show Build Log</button></div>${state.error ? `<div class="error-details">${esc(state.error)}</div>` : ''}`;
      $('#show-log').addEventListener('click', () => drawer(true));
      $('#next').textContent = state.error ? 'Go Back' : 'Cancel'; $('#next').classList.toggle('default', Boolean(state.error)); $('#next').disabled = !state.busy && !state.error;
      updateProgress();
    }
    if (state.page === 'finish') {
      const r = state.result;
      page.innerHTML = `<img class="finish-icon" src="../assets/folder.svg" alt=""><h1 class="success-heading">Your USB Build Is Ready</h1><p>Spider Donut was compiled successfully. Your chapter files are prepared and the ZIP has been checked.</p><h2>Finished archive</h2><div class="result-name">${esc(r.archive.split(/[\\/]/).pop())}</div><div class="inline-actions"><button class="aqua-button default" id="show-archive">Show in Folder</button><button class="aqua-button" id="build-another">Build Another…</button></div><h2>Next, on your USB drive</h2><p class="small">Extract the ZIP to the root of a <strong>FAT32 USB drive</strong>. Keep the PKG and the DELTARUNE folder at the root. Install the PKG through your PS3’s Package Manager, then launch Spider Donut.</p><p class="small subtle">${r.chapters.map(n => 'Chapter ' + n).join(', ')} · ${r.files} files<br>Includes ${esc(r.package)}</p><h2>Archive SHA-256</h2><div class="hash">${esc(r.sha256)}</div>`;
      $('#show-archive').classList.remove('default');
      $('#show-archive').addEventListener('click', () => safe(api.reveal())); $('#build-another').addEventListener('click', () => { state.result = null; setPage('version'); });
    }
  }
  async function loadCatalog(refresh = false) {
    state.catalogError = null;
    try { state.catalog = await api.catalog(refresh); if (!state.release) state.release = state.catalog.releases[0].tag; }
    catch (e) { state.catalogError = e.message; }
    if (state.page === 'version') render();
  }
  let sheetPending = null;
  function sheet({ title, text, primary = 'OK', secondary = null }) {
    if (sheetPending) return Promise.resolve(false);
    closeMenu(); if (aqua.isMinimized()) aqua.restore();
    const previous = document.activeElement;
    $('#sheet-host').innerHTML = `<div class="sheet-overlay"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-top"><img src="../assets/logo.png" alt=""><div><h2 id="sheet-title">${esc(title)}</h2><p>${esc(text)}</p></div></div><div class="sheet-actions">${secondary ? `<button class="aqua-button" id="sheet-secondary">${esc(secondary)}</button>` : ''}<button class="aqua-button default" id="sheet-primary">${esc(primary)}</button></div></section></div>`;
    $('.installer-body').inert = true;
    return new Promise(resolve => {
      let closing = false;
      const finish = async value => { if (closing) return; closing = true; $('.sheet').classList.add('retract'); await new Promise(r => setTimeout(r, 190)); $('#sheet-host').replaceChildren(); $('.installer-body').inert = false; sheetPending = null; previous?.focus(); resolve(value); };
      sheetPending = { finish };
      $('#sheet-primary').addEventListener('click', () => finish(true)); $('#sheet-secondary')?.addEventListener('click', () => finish(false));
      $('#sheet-primary').focus();
    });
  }
  function showError(title, error) { return sheet({ title, text: error.message || String(error) }); }
  async function safe(promise) { try { return await promise; } catch (e) { return showError('The action could not be completed', e); } }
  async function begin() {
    if (state.busy) return;
    state.busy = true; state.error = ''; state.progress = null; state.phase = 'dependencies'; state.message = 'Preparing your build…'; state.startedAt = Date.now(); state.logs = [];
    $('#build-log').textContent = 'Starting build…\n'; setPage('progress'); $('#menu-status').textContent = 'Building…';
    try {
      const result = await api.start({ channel: state.channel, release: state.release, gamePath: state.game.selectedPath, chapters: state.chapters, outputPath: state.output });
      if (result.requiresRuntime) {
        state.busy = false; setPage('review'); $('#menu-status').textContent = 'Setup required';
        const accepted = await sheet({ title: 'Prepare Windows for building', text: 'Spider Donut uses a separate Linux build environment. Windows Subsystem for Linux is not ready on this PC.\n\nChoose Install to let Windows set it up. Windows will request administrator access. You may need to restart your PC, then reopen this app and start your build again.', primary: 'Install', secondary: 'Not Now' });
        if (accepted) {
          $('#next').disabled = true; $('#footer-note').textContent = 'Installing Windows components…';
          try { await api.installRuntime(); await sheet({ title: 'Windows setup finished', text: 'If Windows requested a restart, restart your PC before continuing. Your selection has been saved. Reopen the installer afterwards to start the build.', primary: 'OK' }); }
          catch (e) { await showError('Windows setup could not finish', e); }
          finally { render(); }
        }
      }
    } catch (e) { handleEvent({ type: 'error', message: e.message }); }
  }
  async function cancel() {
    if (!state.busy) return;
    const yes = await sheet({ title: 'Cancel this build?', text: 'The current build will stop. Downloads that have already finished will be kept for your next attempt.', primary: 'Stop Build', secondary: 'Keep Building' });
    if (yes) { $('#next').disabled = true; state.message = 'Stopping the build…'; updateProgress(); await safe(api.cancel()); }
  }
  async function next() {
    if ($('#next').disabled || sheetPending) return;
    if (state.page === 'review') return begin();
    if (state.page === 'progress') return state.error ? setPage('review') : cancel();
    if (state.page === 'finish') return safe(api.quit());
    const pages = sequence(); setPage(pages[pages.indexOf(state.page) + 1]);
  }
  $('#next').addEventListener('click', next);
  $('#back').addEventListener('click', () => { const pages = sequence(); setPage(pages[pages.indexOf(state.page) - 1]); });
  function updateProgress() {
    if (state.page !== 'progress') return;
    const phases = Object.keys(phaseNames), index = phases.indexOf(state.phase);
    document.querySelectorAll('[data-phase]').forEach((item, i) => { item.className = i < index ? 'complete' : i === index && state.busy ? 'active' : ''; });
    $('#progress-track').classList.toggle('indeterminate', state.progress === null && state.busy);
    $('#progress-fill').style.width = (state.progress === null ? 0 : Math.max(0, Math.min(1, state.progress)) * 100) + '%';
    if (state.progress !== null) $('#progress-track').setAttribute('aria-valuenow', Math.round(state.progress * 100)); else $('#progress-track').removeAttribute('aria-valuenow');
    $('#progress-message').textContent = state.message;
    if (state.startedAt) { const seconds = Math.floor((Date.now() - state.startedAt) / 1000); $('#build-elapsed').textContent = `Elapsed: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  }
  function handleEvent(event) {
    if (event.type === 'progress') { state.phase = event.phase; state.message = event.message; state.progress = event.progress; updateProgress(); }
    if (event.type === 'log') { state.logs.push(event.line); if (state.logs.length > 1600) state.logs.splice(0, 400); const log = $('#build-log'); const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 25; log.textContent = state.logs.join('\n'); if (atEnd) log.scrollTop = log.scrollHeight; }
    if (event.type === 'complete') { state.busy = false; state.result = event; $('#menu-status').textContent = 'Build complete'; setPage('finish'); aqua.bounce($('[data-dock=installer]')); }
    if (event.type === 'error' || event.type === 'cancelled') { state.busy = false; state.error = event.message || 'Build cancelled.'; state.message = event.type === 'cancelled' ? 'Build cancelled.' : 'The build could not be completed.'; $('#menu-status').textContent = event.type === 'cancelled' ? 'Cancelled' : 'Build stopped'; render(); announce(state.message); }
    if (event.type === 'confirm-close') cancel();
  }
  api.onEvent(handleEvent);
  function drawer(open = !state.drawer) {
    state.drawer = open;
    const win = $('#installer-window');
    if (open) {
      const rect = win.getBoundingClientRect();
      state.drawerPrevious = { left: win.style.left, width: win.style.width };
      if (rect.left < 300 && innerWidth - rect.right < 300) {
        win.style.left = '12px'; win.style.width = Math.min(rect.width, innerWidth - 314) + 'px'; win.classList.remove('drawer-left');
      } else win.classList.toggle('drawer-left', innerWidth - rect.right < 300);
    }
    const el = $('#log-drawer');
    if (open) { el.hidden = false; requestAnimationFrame(() => el.classList.add('open')); }
    else { el.classList.remove('open'); setTimeout(() => { if (!state.drawer) { el.hidden = true; if (state.drawerPrevious) Object.assign(win.style, state.drawerPrevious); } }, 240); }
    $('#toggle-log').setAttribute('aria-label', open ? 'Hide build log' : 'Show build log');
  }
  $('#toggle-log').addEventListener('click', () => drawer()); $('#clear-log').addEventListener('click', () => { state.logs = []; $('#build-log').textContent = ''; });
  function help() { $('#help-window').hidden = false; aqua.focus($('#help-window')); aqua.bounce($('[data-dock=help]')); }
  $('#help-button').addEventListener('click', help); $('[data-dock=help]').addEventListener('click', help);
  $('#help-window .close').addEventListener('click', () => { $('#help-window').hidden = true; aqua.focus($('#installer-window')); });
  $('#owner-window .close').addEventListener('click', () => { $('#developer-password').value = ''; $('#developer-password').type = 'password'; $('#show-license-password').checked = false; $('#owner-window').hidden = true; aqua.focus($('#installer-window')); });
  $('#backup-window .close').addEventListener('click', () => { $('#backup-password').value = ''; $('#backup-window').hidden = true; aqua.focus($('#owner-window')); });
  $('#owner-backup').addEventListener('click', () => { $('#backup-window').hidden = false; aqua.focus($('#backup-window')); $('#backup-password').focus(); });
  for (const [generate, field, show] of [['generate-license-password', 'developer-password', 'show-license-password'], ['generate-backup-password', 'backup-password', 'show-backup-password']]) {
    $('#' + generate).addEventListener('click', async () => { try { $('#' + field).value = await api.generatePassword(); } catch (error) { showError('Could not generate a password', error); } });
    $('#' + show).addEventListener('change', e => { $('#' + field).type = e.target.checked ? 'text' : 'password'; });
  }
  $('#backup-form').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.target.querySelector('button[type=submit]'); if (button.disabled) return; button.disabled = true;
    try { const result = await api.backupIssuer($('#backup-password').value); if (result) $('#backup-result').textContent = 'Saved ' + result.filename; }
    catch (error) { $('#backup-result').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#key-form').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
    try {
      const result = await api.issueKey({ subject: $('#developer-name').value, expires: $('#developer-expiry').value, ref: $('#developer-ref').value, password: $('#developer-password').value });
      if (result) { $('#key-result').style.color = '#4c6f48'; $('#key-result').textContent = 'Saved ' + result.filename; }
    } catch (error) { $('#key-result').style.color = '#a32e20'; $('#key-result').textContent = error.message; }
    finally { button.disabled = false; }
  });
  async function quit() { closeMenu(); if (state.busy) return cancel(); const yes = await sheet({ title: 'Close Spider Donut Installer?', text: 'You can reopen the assistant whenever you want to build another version.', primary: 'Quit', secondary: 'Cancel' }); if (yes) safe(api.quit()); }
  $('#installer-window .close').addEventListener('click', quit);
  $('[data-dock=output]').addEventListener('click', () => safe(api.openOutput()));
  $('#project-link').addEventListener('click', () => safe(api.openLink('https://github.com/ext5demon/donut-spider')));
  $('#wsl-link').addEventListener('click', () => safe(api.openLink('https://learn.microsoft.com/en-us/windows/wsl/install')));
  addEventListener('desktop-open', e => e.detail === 'help' ? help() : safe(api.openOutput()));
  const action = {
    about: () => sheet({ title: 'Spider Donut Installer', text: 'Version ' + $('#app-version').textContent + '\nBuild Spider Donut and prepare your own DELTARUNE files for PS3.\n\nClassic Aqua interface recreation. Built for Spider Donut.' }),
    keys: () => { $('#owner-window').hidden = false; aqua.focus($('#owner-window')); $('#developer-name').focus(); },
    help, quit, output: () => safe(api.openOutput()), log: () => drawer(), minimize: () => aqua.minimize(), zoom: () => aqua.zoom(),
    show: () => { if (aqua.isMinimized()) aqua.restore(); else aqua.focus($('#installer-window')); },
    new: async () => { if (state.busy) return cancel(); state.error = ''; setPage('version'); },
    refresh: () => loadCatalog(true), copy: () => safe(api.edit('copy')), cut: () => safe(api.edit('cut')), paste: () => safe(api.edit('paste')), selectAll: () => safe(api.edit('selectAll')),
    undo: () => safe(api.edit('undo')), redo: () => safe(api.edit('redo')), genie: () => aqua.effect('genie'), scale: () => aqua.effect('scale'), project: () => safe(api.openLink('https://github.com/ext5demon/donut-spider'))
  };
  const item = (text, command, shortcut = '', checked = false) => ({ text, command, shortcut, checked });
  const menus = {
    application: () => [item('About Spider Donut Installer', 'about'), ...(state.owner ? [null, item('Developer Keys…', 'keys')] : []), null, item('Quit Installer', 'quit', 'Ctrl+Q')],
    file: () => [item('New Build…', 'new', 'Ctrl+N'), item('Open USB Builds', 'output'), null, item('Check for Releases', 'refresh'), null, item('Close', 'quit', 'Ctrl+W')],
    edit: () => [item('Undo', 'undo', 'Ctrl+Z'), item('Redo', 'redo', 'Ctrl+Y'), null, item('Cut', 'cut', 'Ctrl+X'), item('Copy', 'copy', 'Ctrl+C'), item('Paste', 'paste', 'Ctrl+V'), item('Select All', 'selectAll', 'Ctrl+A')],
    view: () => [item(state.drawer ? 'Hide Build Log' : 'Show Build Log', 'log', 'Ctrl+L'), null, { text: 'Minimize Using', children: [item('Genie Effect', 'genie', '', aqua.effect() === 'genie'), item('Scale Effect', 'scale', '', aqua.effect() === 'scale')] }],
    window: () => [item('Minimize', 'minimize', 'Ctrl+M'), item('Zoom', 'zoom'), null, item('Spider Donut Installer', 'show', '', true), item('Installer Help', 'help')],
    help: () => [item('Installer Help', 'help', 'F1'), item('Spider Donut on GitHub', 'project')]
  };
  function menuHTML(items) { return items.map(i => !i ? '<div class="menu-separator" role="separator"></div>' : i.children ? `<div class="menu-parent"><button class="menu-item submenu-trigger" role="menuitem" aria-haspopup="menu">${esc(i.text)}</button><div class="dropdown submenu" role="menu">${menuHTML(i.children)}</div></div>` : `<button class="menu-item ${i.checked ? 'checked' : ''}" role="menuitem" data-command="${i.command}">${esc(i.text)}<span class="shortcut">${esc(i.shortcut)}</span></button>`).join(''); }
  let openTrigger = null;
  function closeMenu() { $('#menus').replaceChildren(); openTrigger?.setAttribute('aria-expanded', 'false'); openTrigger = null; }
  function bindMenu() { $('#menus').querySelectorAll('[data-command]').forEach(b => b.addEventListener('click', () => { const command = b.dataset.command; closeMenu(); action[command]?.(); })); }
  function openMenu(button) {
    if (sheetPending) return;
    const same = openTrigger === button; closeMenu(); if (same) return;
    const rect = button.getBoundingClientRect(); openTrigger = button; button.setAttribute('aria-expanded', 'true');
    $('#menus').innerHTML = `<div class="dropdown" role="menu" style="left:${rect.x}px;top:${rect.bottom}px">${menuHTML(menus[button.dataset.menu]())}</div>`; bindMenu();
  }
  document.querySelectorAll('.menu-trigger').forEach(b => { b.addEventListener('click', () => openMenu(b)); b.addEventListener('pointerenter', () => { if (openTrigger && openTrigger !== b) openMenu(b); }); });
  addEventListener('pointerdown', e => { if (!e.target.closest('#menubar,#menus')) closeMenu(); });
  addEventListener('desktop-context', e => { closeMenu(); $('#menus').innerHTML = `<div class="dropdown" role="menu" style="left:${Math.min(e.detail.x, innerWidth - 240)}px;top:${Math.min(e.detail.y, innerHeight - 100)}px">${menuHTML([item(e.detail.action === 'help' ? 'Open Read Me' : 'Open USB Builds', e.detail.action)])}</div>`; bindMenu(); });
  addEventListener('keydown', e => {
    if (sheetPending) {
      if (e.key === 'Escape') { e.preventDefault(); sheetPending.finish(false); }
      if (e.key === 'Tab') { const buttons = [...$('#sheet-host').querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Escape') { closeMenu(); return; }
    if (openTrigger && e.key === 'ArrowRight') {
      const submenu = document.activeElement.closest('.menu-parent')?.querySelector('.submenu');
      if (submenu) submenu.querySelector('button')?.focus();
      else { const triggers = [...document.querySelectorAll('.menu-trigger')]; openMenu(triggers[(triggers.indexOf(openTrigger) + 1) % triggers.length]); }
      e.preventDefault(); return;
    }
    if (openTrigger && e.key === 'ArrowLeft') {
      const parent = document.activeElement.closest('.submenu')?.closest('.menu-parent');
      if (parent) parent.querySelector('button').focus();
      else { const triggers = [...document.querySelectorAll('.menu-trigger')]; openMenu(triggers[(triggers.indexOf(openTrigger) + triggers.length - 1) % triggers.length]); }
      e.preventDefault(); return;
    }
    if (openTrigger && ['ArrowDown', 'ArrowUp'].includes(e.key)) { const container = document.activeElement.closest('.submenu') || $('#menus > .dropdown'); const buttons = [...container.querySelectorAll(':scope > button,:scope > .menu-parent > button')]; const index = buttons.indexOf(document.activeElement); buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus(); e.preventDefault(); return; }
    if (e.key === 'F1') { help(); e.preventDefault(); }
    if (e.ctrlKey) { const commands = { q: 'quit', w: 'quit', n: 'new', l: 'log', m: 'minimize' }; const command = commands[e.key.toLowerCase()]; if (command) { e.preventDefault(); action[command](); } }
    if (e.key === 'Enter' && !e.target.closest('button,select,a,input,form,textarea') && $('#help-window').hidden && $('#owner-window').hidden && $('#backup-window').hidden) { e.preventDefault(); next(); }
  });
  function clock() { $('#clock').textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); updateProgress(); }
  setInterval(clock, 1000); clock();
  (async () => {
    try {
      const info = await api.init(); state.output = info.outputPath; state.owner = info.owner; $('#app-version').textContent = info.version;
      render(); loadCatalog();
      if (info.ownerError) await showError('Your owner signing key could not be opened', new Error(info.ownerError));
      if (info.pending && info.pendingGame) {
        const resume = await sheet({ title: 'Continue your saved setup?', text: 'A previous build selection was saved. You can use it again to start a fresh build.', primary: 'Continue', secondary: 'Start Fresh' });
        if (resume) { state.channel = info.pending.channel; state.release = info.pending.release; state.game = info.pendingGame; state.chapters = info.pending.chapters; state.output = info.pending.outputPath; setPage(state.channel === 'dev' ? 'key' : 'review'); }
      }
    } catch (e) { render(); showError('The installer could not start', e); }
  })();
})();
