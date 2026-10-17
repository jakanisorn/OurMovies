(() => {
  'use strict';

  const STORE_KEY = 'ourmovies.v1';
  const $ = (id) => document.getElementById(id);

  // Adding, editing and deleting only work when the site is opened from your own computer
  // (a file or localhost). The published GitHub Pages site is view-only.
  const CAN_EDIT = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!CAN_EDIT) {
    document.documentElement.classList.add('readonly');
    const f = document.querySelector('.foot p');
    if (f) f.textContent = 'Made for two.';
  }
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NOW = new Date();
  const THIS_YEAR = NOW.getFullYear();

  const state = { movies: [], deleted: [], q: '', year: 'all', genre: 'all', sort: 'watchedDesc', showAll: false, editingId: null, deletingId: null, poster: '' };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const makeId = (m) => `${slug(m.title)}-${m.watched}`;
  const parseDate = (iso) => new Date(`${iso}T00:00:00`);
  const fmtDate = (iso) => parseDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const yearOf = (m) => Number(m.watched.slice(0, 4));
  const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const posterSrc = (p) => (!p ? '' : /^(data:|https?:)/.test(p) ? p : encodeURI(p));
  const hasWord = (s) => (s ?? '').toLowerCase();

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- storage ---------- */
  function load() {
    const seed = (window.MOVIES_SEED || []).map((m) => ({ ...m, id: m.id || makeId(m) }));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* storage blocked or corrupt */ }
    if (!saved || !Array.isArray(saved.movies)) {
      state.movies = seed;
      return;
    }
    state.deleted = saved.deleted || [];
    const have = new Set(saved.movies.map((m) => m.id));
    // movies added to movies-data.js later show up here too
    const fresh = seed.filter((m) => !have.has(m.id) && !state.deleted.includes(m.id));
    state.movies = [...saved.movies, ...fresh];
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ movies: state.movies, deleted: state.deleted }));
    } catch (e) {
      toast('Could not save in this browser. Check that site storage is allowed.');
    }
  }

/* ---------- save to your folder (Chrome and Edge) ---------- */
  const canSync = 'showDirectoryPicker' in window;
  let folder = null;

  // The chosen folder is remembered in the browser so you only pick it once.
  const idb = (mode, fn) => new Promise((resolve) => {
    try {
      const open = indexedDB.open('ourmovies', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('kv', mode);
          const req = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(req && req.result !== undefined ? req.result : null);
          tx.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
    } catch (e) { resolve(null); }
  });
  const rememberFolder = (h) => idb('readwrite', (s) => s.put(h, 'folder'));
  const recallFolder = () => idb('readonly', (s) => s.get('folder'));

  function setSyncNote() {
    const el = $('syncNote');
    if (!canSync) el.textContent = "This browser can't save to your folder. Use Chrome or Edge to save automatically.";
    else if (folder) el.textContent = `Saves to your folder: ${folder.name}`;
    else el.textContent = 'The first save asks you to pick your OurMovies folder, the one with index.html.';
  }

  async function connectFolder() {
    if (!canSync) return null;
    try {
      let h = folder || await recallFolder();
      if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
      if (!h) {
        h = await window.showDirectoryPicker({ id: 'our-movies', mode: 'readwrite' });
        try { await h.getFileHandle('movies-data.js'); } catch (e) { toast("That folder has no movies-data.js. Pick your OurMovies folder."); return null; }
        await rememberFolder(h);
      }
      folder = h;
      setSyncNote();
      return h;
    } catch (e) {
      if (e && e.name === 'SecurityError') toast("This browser blocked folder access for this page. Open the site from GitHub Pages or a local server.");
      return null; // picker closed or permission refused
    }
  }

  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  async function freeName(dir, base) {
    let name = `${base}.jpg`;
    for (let n = 2; n < 100; n++) {
      try { await dir.getFileHandle(name); name = `${base}-${n}.jpg`; } catch (e) { return name; }
    }
    return name;
  }

  function serialize() {
    const clean = state.movies.map(({ id, ...m }) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))));
    clean.sort((a, b) => a.watched.localeCompare(b.watched));
    return '// Our Movies data. The site updates this file when you add, edit or delete a movie.\nwindow.MOVIES_SEED = ' + JSON.stringify(clean, null, 1) + ';\n';
  }

  // Poster files are copied into movie_poster/, then movies-data.js is rewritten.
  async function syncToFolder(h) {
    for (const m of state.movies) {
      if (m.poster && m.poster.startsWith('data:')) {
        const dir = await h.getDirectoryHandle('movie_poster', { create: true });
        const name = await freeName(dir, slug(m.title) || 'poster');
        await writeFile(dir, name, await (await fetch(m.poster)).blob());
        m.poster = `movie_poster/${name}`;
      }
    }
    await writeFile(h, 'movies-data.js', serialize());
  }

  // Saves the change to the browser and, when a folder is connected, to the folder too.
  // Deletes a poster file from movie_poster/, unless another movie still uses it.
  async function removePoster(h, path) {
    if (!path || !path.startsWith('movie_poster/')) return 'none';
    if (state.movies.some((m) => m.poster === path)) return 'shared';
    try {
      const dir = await h.getDirectoryHandle('movie_poster');
      await dir.removeEntry(path.slice('movie_poster/'.length));
      return 'deleted';
    } catch (e) {
      return 'failed';
    }
  }

  async function persist(h, doneText, after) {
    if (h) {
      try {
        await syncToFolder(h);
        save();
        const extra = after ? await after() : '';
        toast(`${doneText}. Folder updated${extra}.`);
        return;
      } catch (e) {
        save();
        toast(`${doneText} in this browser, but writing to your folder failed.`);
        return;
      }
    }
    save();
    toast(canSync ? `${doneText} in this browser only.` : `${doneText}.`);
  }

  /* ---------- dashboard ---------- */
  function countUp(el, to) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (reduce || from === to) { el.textContent = to; return; }
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function topOf(counts) {
    const arr = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return arr[0];
  }

  function renderDashboard() {
    const all = state.movies;
    const thisYear = all.filter((m) => yearOf(m) === THIS_YEAR);

    countUp($('statTotal'), all.length);
    countUp($('statYear'), thisYear.length);
    $('yearLabel').textContent = `Watched in ${THIS_YEAR}`;
    $('monthTitle').textContent = `Movies per month in ${THIS_YEAR}`;

    const dates = all.map((m) => m.watched).sort();
    $('statSince').textContent = dates.length ? `Since ${fmtDate(dates[0])}` : 'Add your first movie to get started.';

    // months this year
    const perMonth = Array(12).fill(0);
    thisYear.forEach((m) => { perMonth[Number(m.watched.slice(5, 7)) - 1]++; });
    const max = Math.max(1, ...perMonth);
    $('months').innerHTML = perMonth.map((n, i) => `
      <div class="month${i === NOW.getMonth() ? ' now' : ''}" title="${MONTH_NAMES[i]}: ${n}">
        <span class="month-n" aria-hidden="true">${n || ''}</span>
        <div class="month-bar" style="height:0" data-h="${n ? Math.max(4, Math.round((n / max) * 100)) : 2}%"></div>
        <span class="month-l" aria-hidden="true">${MONTH_NAMES[i].slice(0, 3)}</span>
      </div>`).join('');
    $('months').setAttribute('aria-label', 'Movies per month in ' + THIS_YEAR + ': ' + perMonth.map((n, i) => `${MONTH_NAMES[i]} ${n}`).join(', '));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('.month-bar').forEach((b) => { b.style.height = b.dataset.h; });
    }));

    const places = new Map();
    all.forEach((m) => { if (m.location) places.set(m.location, (places.get(m.location) || 0) + 1); });
    drawBars('chartPlaces', places);

    const genres = new Map();
    all.forEach((m) => (m.genres || []).forEach((g) => genres.set(g, (genres.get(g) || 0) + 1)));
    drawBars('chartGenres', genres);
  }

  function drawBars(id, counts) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 5);
    const max = Math.max(1, ...top.map((t) => t[1]));
    $(id).innerHTML = top.length ? top.map(([name, n]) => `
      <li class="bar-row">
        <span class="bar-label" title="${esc(name)}">${esc(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:0" data-w="${Math.round((n / max) * 100)}%"></span></span>
        <span class="bar-n">${n}</span>
      </li>`).join('') : '<li class="bar-empty">Nothing to show yet.</li>';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $(id).querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.w; });
    }));
  }

  /* ---------- filters ---------- */
  function renderFilters() {
    const years = [...new Set(state.movies.map(yearOf))].sort((a, b) => b - a);
    if (state.year !== 'all' && !years.includes(Number(state.year))) state.year = 'all';
    $('yearChips').innerHTML = ['all', ...years].map((y) =>
      `<button type="button" class="chip" data-year="${y}" aria-pressed="${String(y) === String(state.year)}">${y === 'all' ? 'All years' : y}</button>`).join('');

    const genres = new Set();
    state.movies.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
    const list = [...genres].sort((a, b) => a.localeCompare(b));
    if (state.genre !== 'all' && !genres.has(state.genre)) state.genre = 'all';
    $('genreSel').innerHTML = '<option value="all">All genres</option>' + list.map((g) => `<option${g === state.genre ? ' selected' : ''}>${esc(g)}</option>`).join('');

    const fill = (id, vals) => { $(id).innerHTML = [...new Set(vals.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join(''); };
    fill('locList', state.movies.map((m) => m.location));
    fill('langList', state.movies.map((m) => m.language));
  }

  function visibleMovies() {
    const q = hasWord(state.q).trim();
    let list = state.movies.filter((m) => {
      if (state.year !== 'all' && yearOf(m) !== Number(state.year)) return false;
      if (state.genre !== 'all' && !(m.genres || []).includes(state.genre)) return false;
      if (!q) return true;
      const hay = [m.title, m.altTitle, m.director, m.studios, m.location, m.language, (m.genres || []).join(' '), (m.cast || []).join(' '), m.note].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    const by = {
      watchedDesc: (a, b) => b.watched.localeCompare(a.watched),
      watchedAsc: (a, b) => a.watched.localeCompare(b.watched),
      title: (a, b) => a.title.localeCompare(b.title),
      yearDesc: (a, b) => (b.year || 0) - (a.year || 0),
      runtimeDesc: (a, b) => (b.runtime || 0) - (a.runtime || 0),
    }[state.sort];
    return list.sort(by);
  }

  /* ---------- cards ---------- */
  const metaOf = (m) => [m.year, m.runtime ? `${m.runtime} min` : '', m.language].filter(Boolean).join(', ');
  const ratingHTML = (m) => (m.rating ? `<span class="rating" aria-label="Our rating ${m.rating} out of 5">${'★'.repeat(m.rating)}${'☆'.repeat(5 - m.rating)}</span>` : '');
  const posterHTML = (m) => {
    const src = posterSrc(m.poster);
    return `<div class="poster-fallback" aria-hidden="true">${esc(m.title)}</div>${src ? `<img src="${esc(src)}" alt="Poster of ${esc(m.title)}" loading="lazy" onerror="this.remove()">` : ''}`;
  };

  function cardHTML(m) {
    return `
      <article class="card" data-y="${yearOf(m)}" data-id="${esc(m.id)}">
        <div class="poster">${posterHTML(m)}${ratingHTML(m)}</div>
        <div class="card-body">
          <h3 class="card-title"><button type="button" class="open" aria-haspopup="dialog">${esc(m.title)}</button></h3>
          <p class="meta">${esc([m.year, m.runtime ? `${m.runtime} min` : ''].filter(Boolean).join(', '))}</p>
        </div>
        <div class="stub">
          <span class="stub-date">${esc(fmtDate(m.watched))}</span>
          <span class="stub-loc">${esc(m.location || '')}</span>
        </div>
      </article>`;
  }

  /* ---------- details dialog ---------- */
  function openDetail(m) {
    state.detailId = m.id;
    const dlg = $('detailDlg');
    dlg.dataset.y = yearOf(m);
    $('dPoster').innerHTML = posterHTML(m).replace('loading="lazy"', 'loading="eager"') + ratingHTML(m);
    $('dTitle').textContent = m.title;
    $('dAlt').textContent = m.altTitle || '';
    $('dAlt').hidden = !m.altTitle;
    $('dMeta').textContent = metaOf(m);
    $('dTags').innerHTML = (m.genres || []).map((g) => `<li>${esc(g)}</li>`).join('');
    const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    $('dCredits').innerHTML = row('Director', m.director) + row('Cast', (m.cast || []).join(', ')) + row('Studio', m.studios) + row('Language', m.language);
    $('dNote').textContent = m.note || '';
    $('dNote').hidden = !m.note;
    $('dStub').innerHTML = `<span class="stub-date">${esc(fmtDate(m.watched))}</span><span class="stub-loc">${esc(m.location || '')}</span>`;
    dlg.showModal();
  }
  const currentDetail = () => state.movies.find((x) => x.id === state.detailId);
  $('dClose').addEventListener('click', () => $('detailDlg').close());
  $('detailDlg').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  $('dEdit').addEventListener('click', () => { if (!CAN_EDIT) return; const m = currentDetail(); $('detailDlg').close(); if (m) openForm(m); });
  $('dDelete').addEventListener('click', () => {
    const m = currentDetail();
    $('detailDlg').close();
    if (!m) return;
    state.deletingId = m.id;
    const fileNote = canSync && m.poster && m.poster.startsWith('movie_poster/')
      ? ' Its poster file is also deleted from your movie_poster folder.'
      : '';
    $('delText').textContent = `${m.title}, watched ${fmtDate(m.watched)}, will be removed from the site.${fileNote} This can't be undone.`;
    $('delDlg').showModal();
  });

  function renderGrid() {
    const list = visibleMovies();
    const groups = [];
    list.forEach((m) => {
      const key = m.watched.slice(0, 7);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(m); else groups.push({ key, items: [m] });
    });
    // Show the latest 12 months; older months wait behind "See more".
    // Any search or filter shows every match, so nothing is hidden from results.
    const filtered = Boolean(state.q.trim()) || state.year !== 'all' || state.genre !== 'all';
    const cut = new Date(THIS_YEAR, NOW.getMonth() - 11, 1);
    const cutoff = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}`;
    const limited = !filtered && !state.showAll;
    const shown = limited ? groups.filter((g) => g.key >= cutoff) : groups;
    const hiddenCount = limited ? groups.filter((g) => g.key < cutoff).reduce((s, g) => s + g.items.length, 0) : 0;
    const olderExist = !filtered && groups.some((g) => g.key < cutoff);

    const sections = shown.map((g) => {
      const [y, mo] = g.key.split('-');
      const label = `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
      const n = g.items.length;
      return `<section class="month-group" aria-labelledby="mg-${g.key}">
        <h2 class="month-head" id="mg-${g.key}"><span>${label}</span><span class="month-count">${n} ${n === 1 ? 'movie' : 'movies'}</span></h2>
        <div class="cards">${g.items.map(cardHTML).join('')}</div>
      </section>`;
    }).join('');
    let more = '';
    if (limited && hiddenCount) more = `<div class="more-wrap"><button type="button" class="btn ghost" data-more="show">See more (${hiddenCount} older ${hiddenCount === 1 ? 'movie' : 'movies'})</button></div>`;
    else if (state.showAll && olderExist) more = '<div class="more-wrap"><button type="button" class="btn ghost" data-more="hide">Show only the latest 12 months</button></div>';
    $('grid').innerHTML = sections + more;
    $('empty').hidden = list.length > 0;
    const total = state.movies.length;
    $('resultCount').textContent = list.length === total ? `${total} movies` : `${list.length} of ${total} movies`;
  }

  function renderAll() { renderDashboard(); renderFilters(); renderGrid(); }

  /* ---------- add / edit dialog ---------- */
  const F = {
    title: $('fTitle'), watched: $('fWatched'), year: $('fYear'), location: $('fLocation'), language: $('fLanguage'),
    runtime: $('fRuntime'), genres: $('fGenres'), director: $('fDirector'), cast: $('fCast'),
    studios: $('fStudios'), file: $('fPosterFile'),
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function setPreview(src) {
    const img = $('posterPreview');
    state.poster = src || '';
    if (src) { img.src = posterSrc(src); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    $('posterHint').hidden = Boolean(src);
    $('posterChange').hidden = !src;
  }

  function openForm(movie) {
    state.editingId = movie ? movie.id : null;
    $('dlgTitle').textContent = movie ? 'Edit movie' : 'Add movie';
    $('saveBtn').textContent = movie ? 'Save changes' : 'Save movie';
    $('formError').hidden = true;
    const m = movie || {};
    F.title.value = m.title || '';
    F.watched.value = m.watched || todayISO();
    F.year.value = m.year || '';
    F.location.value = m.location || '';
    F.language.value = m.language || '';
    F.runtime.value = m.runtime || '';
    F.genres.value = (m.genres || []).join(', ');
    F.director.value = m.director || '';
    F.cast.value = (m.cast || []).join(', ');
    F.studios.value = m.studios || '';
    F.file.value = '';
    setPreview(m.poster || '');
    setSyncNote();
    $('movieDlg').showModal();
    F.title.focus();
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const w = Math.min(600, img.width);
          const h = Math.round(img.height * (w / img.width));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  F.file.addEventListener('change', async () => {
    const f = F.file.files[0];
    if (!f) return;
    try {
      setPreview(await resizeImage(f));
    } catch (e) {
      showError('That file could not be read as an image. Try a JPG or PNG.');
    }
  });

  function showError(msg) { const e = $('formError'); e.textContent = msg; e.hidden = false; }

  $('movieForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = F.title.value.trim();
    if (!title) { showError('Add a title.'); F.title.focus(); return; }
    if (!F.watched.value) { showError('Pick the date you watched it.'); F.watched.focus(); return; }

    // Asking for the folder needs this click, so it comes before anything slow.
    $('saveBtn').disabled = true;
    const h = await connectFolder();

    const data = {
      title,
      year: F.year.value ? Number(F.year.value) : undefined,
      watched: F.watched.value,
      language: F.language.value.trim() || undefined,
      genres: splitList(F.genres.value),
      runtime: F.runtime.value ? Number(F.runtime.value) : undefined,
      studios: F.studios.value.trim() || undefined,
      director: F.director.value.trim() || undefined,
      cast: splitList(F.cast.value),
      location: F.location.value.trim() || undefined,
      poster: state.poster || undefined,
    };

    if (state.editingId) {
      const i = state.movies.findIndex((m) => m.id === state.editingId);
      const old = state.movies[i];
      // keep details the form no longer edits
      state.movies[i] = { altTitle: old.altTitle, rating: old.rating, note: old.note, ...data, id: state.editingId };
    } else {
      let id = makeId(data);
      while (state.movies.some((m) => m.id === id)) id += '-2';
      state.movies.push({ ...data, id });
      state.deleted = state.deleted.filter((d) => d !== id);
      state.year = 'all'; state.genre = 'all'; state.q = ''; $('q').value = '';
    }
    const wasEdit = Boolean(state.editingId);
    $('movieDlg').close();
    await persist(h, wasEdit ? 'Movie updated' : 'Movie added');
    $('saveBtn').disabled = false;
    renderAll();
  });

  $('cancelBtn').addEventListener('click', () => $('movieDlg').close());
  $('addBtn').addEventListener('click', () => { if (CAN_EDIT) openForm(null); });

  /* ---------- open a card ---------- */
  $('grid').addEventListener('click', (ev) => {
    const more = ev.target.closest('[data-more]');
    if (more) {
      state.showAll = more.dataset.more === 'show';
      renderGrid();
      if (!state.showAll) window.scrollTo({ top: $('grid').offsetTop - 120 });
      return;
    }
    const card = ev.target.closest('.card');
    if (!card) return;
    const m = state.movies.find((x) => x.id === card.dataset.id);
    if (m) openDetail(m);
  });
  $('delDlg').addEventListener('close', async () => {
    const id = state.deletingId;
    const confirmed = $('delDlg').returnValue === 'delete' && id;
    state.deletingId = null;
    $('delDlg').returnValue = '';
    if (!confirmed) return;
    const h = await connectFolder();
    const gone = state.movies.find((m) => m.id === id);
    state.movies = state.movies.filter((m) => m.id !== id);
    if (!state.deleted.includes(id)) state.deleted.push(id);
    renderAll();
    await persist(h, 'Movie deleted', async () => {
      const result = await removePoster(h, gone && gone.poster);
      return { deleted: ' and poster file deleted', shared: ' (poster kept, another movie uses it)', failed: ' (poster file could not be deleted)', none: '' }[result];
    });
  });

  /* ---------- filters events ---------- */
  let qTimer;
  $('q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 120); });
  $('genreSel').addEventListener('change', (e) => { state.genre = e.target.value; renderGrid(); });
  $('yearChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    state.year = b.dataset.year;
    document.querySelectorAll('#yearChips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    renderGrid();
  });

  /* ---------- export to Excel (.xlsx), no add-ons needed ---------- */
  const enc = new TextEncoder();
  const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => String.fromCharCode(65 + i);

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  // An .xlsx file is a zip of small XML files. This writes an uncompressed zip.
  function zipStore(files) {
    const chunks = []; const central = []; let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach(({ name, data }) => {
      const nameBytes = enc.encode(name); const crc = crc32(data);
      const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes]);
      chunks.push(head, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
      offset += head.length + data.length;
    });
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
    return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const excelDate = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);

  function buildXlsx() {
    const headers = ['Title', 'Thai / alternate title', 'Year', 'Date watched', 'Language', 'Genres', 'Runtime (min)', 'Production companies', 'Director', 'Cast', 'Watched at'];
    const widths = [34, 24, 8, 14, 12, 30, 14, 40, 26, 50, 28];
    const rows = [...state.movies].sort((a, b) => a.watched.localeCompare(b.watched)).map((m) => [
      m.title, m.altTitle, m.year, m.watched ? { date: excelDate(m.watched) } : '', m.language, (m.genres || []).join(', '),
      m.runtime, m.studios, m.director, (m.cast || []).join(', '), m.location,
    ]);
    const cell = (v, r, c, style) => {
      const ref = `${colName(c)}${r}`;
      if (v === undefined || v === null || v === '') return '';
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'object') return `<c r="${ref}" s="2"><v>${v.date}</v></c>`;
      return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    const sheetRows = [`<row r="1">${headers.map((h, c) => cell(h, 1, c, 1)).join('')}</row>`]
      .concat(rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join('')}</row>`)).join('');
    const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const files = [
      ['[Content_Types].xml', `${x}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ['_rels/.rels', `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `${x}<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Movies" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', `${x}<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ['xl/worksheets/sheet1.xml', `${x}<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData></worksheet>`],
    ].map(([name, text]) => ({ name, data: enc.encode(text) }));
    return zipStore(files);
  }

  $('exportXlsx').addEventListener('click', () => {
    const url = URL.createObjectURL(buildXlsx());
    const a = document.createElement('a');
    a.href = url; a.download = 'our_movies.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${state.movies.length} movies to our_movies.xlsx`);
  });

  load();
  renderAll();
  recallFolder().then((h) => { if (h) folder = h; });
})();
