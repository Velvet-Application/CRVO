(() => {
  const TARGETS = { Expertise:90, "Mécanique":85, DSP:48, Carrosserie:63, "Préparation":90, "Qualité":90, "Sortie usine":92 };
  let latestPayload = null;
  let userChangedRange = false;
  let applying = false;

  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const firstOfMonth = (iso) => `${iso.slice(0,7)}-01`;
  const byDate = (a,b) => String(a.date).localeCompare(String(b.date));

  function setText(el, value) { if (el && el.textContent !== String(value)) el.textContent = String(value); }
  function targetFromColumn(column, name) {
    const small = column?.querySelector('.performance-main small')?.textContent || '';
    const match = small.match(/(\d+)/);
    return match ? Number(match[1]) : (TARGETS[name] || 0);
  }

  function patchProduction(snapshot) {
    const board = document.querySelector('.performance-board:not(.cumulative-board)');
    if (!board) return;
    const ribbon = board.querySelector('.board-ribbon > div:last-child');
    if (ribbon) {
      const icon = ribbon.querySelector('svg');
      ribbon.childNodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE) node.textContent = ''; });
      if (icon) icon.insertAdjacentText('afterend', snapshot.label);
      else setText(ribbon, snapshot.label);
    }
    const prodMap = new Map((snapshot.production || []).map((p) => [p.name, num(p.value)]));
    board.querySelectorAll('.performance-column').forEach((column) => {
      const name = column.querySelector('h3')?.textContent?.trim();
      if (!name || !prodMap.has(name)) return;
      const value = prodMap.get(name);
      const target = targetFromColumn(column, name);
      setText(column.querySelector('.performance-main strong'), value);
      const gap = value - target;
      setText(column.querySelector('.performance-gap strong'), `${gap > 0 ? '+' : ''}${gap}`);
      const gapBox = column.querySelector('.performance-gap');
      gapBox?.classList.toggle('positive', gap >= 0);
      gapBox?.classList.toggle('negative', gap < 0);
      const progress = column.querySelector('.performance-progress i');
      if (progress) progress.style.width = `${Math.min(target ? value / target * 100 : 0, 100)}%`;
    });
  }

  function patchCumulative(snapshots, latest) {
    const board = document.querySelector('.cumulative-board');
    if (!board) return;
    const inputs = board.querySelectorAll('input[type="date"]');
    if (inputs.length < 2) return;
    const startInput = inputs[0];
    const endInput = inputs[1];
    const monthStart = firstOfMonth(latest.date);
    startInput.min = monthStart;
    endInput.max = latest.date;
    if (!userChangedRange) {
      startInput.value = monthStart;
      endInput.value = latest.date;
    }
    const start = startInput.value || monthStart;
    const end = endInput.value || latest.date;
    const period = snapshots.filter((s) => s.date >= start && s.date <= end);
    const title = board.querySelector('.board-ribbon > div:first-child strong');
    setText(title, `${period.length} journée${period.length > 1 ? 's' : ''} importée${period.length > 1 ? 's' : ''}`);
    board.querySelectorAll('.performance-column').forEach((column) => {
      const name = column.querySelector('h3')?.textContent?.trim();
      if (!name) return;
      const actual = period.reduce((sum, day) => sum + num((day.production || []).find((p) => p.name === name)?.value), 0);
      const target = targetFromColumn(column, name) * Math.max(period.length, 1);
      setText(column.querySelector('.performance-main strong'), actual);
      setText(column.querySelector('.performance-main small'), `objectif ${target}`);
      const gap = actual - target;
      setText(column.querySelector('.performance-gap strong'), `${gap > 0 ? '+' : ''}${gap}`);
      const gapBox = column.querySelector('.performance-gap');
      gapBox?.classList.toggle('positive', gap >= 0);
      gapBox?.classList.toggle('negative', gap < 0);
      const progress = column.querySelector('.performance-progress i');
      if (progress) progress.style.width = `${Math.min(target ? actual / target * 100 : 0, 100)}%`;
    });
  }

  function patch(payload) {
    if (applying || !payload?.snapshot) return;
    applying = true;
    try {
      const snapshots = [...(payload.snapshots || [payload.snapshot])].sort(byDate);
      const snapshot = snapshots.at(-1) || payload.snapshot;
      if (!snapshot || String(snapshot.date) < '2026-08-13') return;

      setText(document.querySelector('.topbar-date strong'), snapshot.label);
      const sideBottom = document.querySelector('.sidebar-bottom');
      setText(sideBottom?.querySelector('strong'), 'Données FTP live');
      setText(sideBottom?.querySelector('small'), `Dernière donnée · ${snapshot.label}`);
      sideBottom?.querySelector('span')?.classList.remove('book-dot');
      sideBottom?.querySelector('span')?.classList.add('live-dot');

      const freshness = document.querySelector('.freshness');
      setText(freshness?.querySelector('strong'), 'FTP live connecté');
      setText(freshness?.querySelector('small'), `Factory-j+1 + EtatduParc · données au ${snapshot.label}`);
      freshness?.querySelector('span')?.classList.remove('book-dot');
      freshness?.querySelector('span')?.classList.add('live-dot');
      setText(freshness?.querySelector('.freshness-tag'), 'SOURCE FTP LIVE');

      const heroCopy = document.querySelector('.day-hero-copy p');
      setText(heroCopy, 'Production du jour issue de Factory-j+1, stock issu de la dernière photo EtatduParc.');
      const heroStats = document.querySelectorAll('.day-hero-stats > div');
      setText(heroStats[0]?.querySelector('strong'), snapshot.entries);
      setText(heroStats[1]?.querySelector('strong'), snapshot.exits);
      const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
      const gap = prev ? num(snapshot.stock) - num(prev.stock) : null;
      if (heroStats[2]) {
        setText(heroStats[2].querySelector('strong'), gap == null ? '—' : `${gap > 0 ? '+' : ''}${gap}`);
        setText(heroStats[2].querySelector('small'), gap == null ? '1re journée' : 'vs veille');
        heroStats[2].classList.toggle('good', gap != null && gap <= 0);
        heroStats[2].classList.toggle('bad', gap != null && gap > 0);
      }

      patchProduction(snapshot);
      patchCumulative(snapshots, snapshot);
      document.documentElement.dataset.crvoLive = snapshot.date;
    } finally { applying = false; }
  }

  function bindRange() {
    const board = document.querySelector('.cumulative-board');
    if (!board || board.dataset.liveRangeBound === '1') return;
    board.dataset.liveRangeBound = '1';
    board.querySelectorAll('input[type="date"]').forEach((input) => {
      input.addEventListener('change', () => { userChangedRange = true; if (latestPayload) patch(latestPayload); });
      input.addEventListener('input', () => { userChangedRange = true; if (latestPayload) patch(latestPayload); });
    });
  }

  async function load() {
    try {
      const response = await fetch(`/api/dashboard?history=1&_=${Date.now()}`, { cache:'no-store', headers:{'Cache-Control':'no-cache'} });
      if (!response.ok) throw new Error(`dashboard ${response.status}`);
      const payload = await response.json();
      if (!payload.connected || payload.sourceMode !== 'ftp' || !payload.snapshot?.date || String(payload.snapshot.date) < '2026-08-13') throw new Error('live FTP indisponible');
      latestPayload = payload;
      bindRange();
      patch(payload);
    } catch (error) {
      console.error('[CRVO live bootstrap]', error);
    }
  }

  function start() {
    void load();
    let quickRuns = 0;
    const quick = setInterval(() => {
      quickRuns += 1;
      bindRange();
      if (latestPayload) patch(latestPayload);
      if (quickRuns >= 20) clearInterval(quick);
    }, 1000);
    setInterval(() => void load(), 15000);
    const observer = new MutationObserver(() => { bindRange(); if (latestPayload) patch(latestPayload); });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();