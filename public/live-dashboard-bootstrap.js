(() => {
  const FALLBACK_TARGETS = { Expertise:90, "Mécanique":85, DSP:48, Carrosserie:63, "Préparation":90, "Qualité":90, "Sortie usine":92 };
  let latestPayload = null;
  let latestStatus = null;
  let userChangedRange = false;
  let applying = false;

  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const firstOfMonth = (iso) => `${iso.slice(0,7)}-01`;
  const byDate = (a,b) => String(a.date).localeCompare(String(b.date));
  const setText = (el, value) => { if (el && el.textContent !== String(value)) el.textContent = String(value); };
  const parisTime = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", { hour:"2-digit", minute:"2-digit", second:"2-digit", timeZone:"Europe/Paris" }).format(date);
  };

  function dailyTarget(name) {
    const dailyBoard = document.querySelector('.performance-board:not(.cumulative-board)');
    const column = [...(dailyBoard?.querySelectorAll('.performance-column') || [])]
      .find((item) => item.querySelector('h3')?.textContent?.trim() === name);
    const small = column?.querySelector('.performance-main small')?.textContent || '';
    const match = small.match(/(\d+)/);
    return match ? Number(match[1]) : (FALLBACK_TARGETS[name] || 0);
  }

  function patchProduction(snapshot) {
    const board = document.querySelector('.performance-board:not(.cumulative-board)');
    if (!board) return;
    const ribbon = board.querySelector('.board-ribbon > div:last-child');
    if (ribbon) {
      const icon = ribbon.querySelector('svg');
      [...ribbon.childNodes].forEach((node) => { if (node.nodeType === Node.TEXT_NODE) node.textContent = ''; });
      const existing = ribbon.querySelector('[data-live-date]');
      if (existing) setText(existing, snapshot.label);
      else {
        const span = document.createElement('span');
        span.dataset.liveDate = '1';
        span.textContent = snapshot.label;
        if (icon) icon.insertAdjacentElement('afterend', span); else ribbon.appendChild(span);
      }
    }

    const prodMap = new Map((snapshot.production || []).map((p) => [p.name, num(p.value)]));
    board.querySelectorAll('.performance-column').forEach((column) => {
      const name = column.querySelector('h3')?.textContent?.trim();
      if (!name || !prodMap.has(name)) return;
      const value = prodMap.get(name);
      const target = dailyTarget(name);
      setText(column.querySelector('.performance-main strong'), value);
      const gap = value - target;
      setText(column.querySelector('.performance-gap strong'), `${gap > 0 ? '+' : ''}${gap}`);
      const gapBox = column.querySelector('.performance-gap');
      gapBox?.classList.toggle('positive', gap >= 0);
      gapBox?.classList.toggle('negative', gap < 0);
      const progress = column.querySelector('.performance-progress i');
      const width = `${Math.min(target ? value / target * 100 : 0, 100)}%`;
      if (progress && progress.style.width !== width) progress.style.width = width;
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

    if (startInput.min !== monthStart) startInput.min = monthStart;
    if (endInput.max !== latest.date) endInput.max = latest.date;
    if (!userChangedRange) {
      if (startInput.value !== monthStart) startInput.value = monthStart;
      if (endInput.value !== latest.date) endInput.value = latest.date;
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
      const target = dailyTarget(name) * Math.max(period.length, 1);
      setText(column.querySelector('.performance-main strong'), actual);
      setText(column.querySelector('.performance-main small'), `objectif ${target}`);
      const gap = actual - target;
      setText(column.querySelector('.performance-gap strong'), `${gap > 0 ? '+' : ''}${gap}`);
      const gapBox = column.querySelector('.performance-gap');
      gapBox?.classList.toggle('positive', gap >= 0);
      gapBox?.classList.toggle('negative', gap < 0);
      const progress = column.querySelector('.performance-progress i');
      const width = `${Math.min(target ? actual / target * 100 : 0, 100)}%`;
      if (progress && progress.style.width !== width) progress.style.width = width;
    });
  }

  function freshnessText(snapshot) {
    const ftp = latestStatus?.ftpRefresh;
    if (!ftp) return `Factory-j+1 + EtatduParc · données au ${snapshot.label}`;
    return `FTP actualisé ${parisTime(ftp.lastRefreshAt)} · dépôt ${parisTime(ftp.lastDepositAt)} · données au ${snapshot.label}`;
  }

  function patch(payload) {
    if (applying || !payload?.snapshot) return;
    applying = true;
    try {
      const snapshots = [...(payload.snapshots || [payload.snapshot])].sort(byDate);
      const snapshot = snapshots.at(-1) || payload.snapshot;
      if (!snapshot) return;

      setText(document.querySelector('.topbar-date strong'), snapshot.label);

      const sideBottom = document.querySelector('.sidebar-bottom');
      setText(sideBottom?.querySelector('strong'), payload.sourceMode === 'ftp' ? 'Données FTP live' : 'Données connectées');
      setText(sideBottom?.querySelector('small'), payload.sourceMode === 'ftp'
        ? `FTP ${parisTime(latestStatus?.ftpRefresh?.lastRefreshAt)} · dernière donnée ${snapshot.label}`
        : `Dernière donnée · ${snapshot.label}`);
      sideBottom?.querySelector('span')?.classList.remove('book-dot');
      sideBottom?.querySelector('span')?.classList.add('live-dot');

      const freshness = document.querySelector('.freshness');
      setText(freshness?.querySelector('strong'), payload.sourceMode === 'ftp' ? 'FTP live connecté' : 'Données connectées');
      setText(freshness?.querySelector('small'), freshnessText(snapshot));
      freshness?.querySelector('span')?.classList.remove('book-dot');
      freshness?.querySelector('span')?.classList.add('live-dot');
      setText(freshness?.querySelector('.freshness-tag'), payload.sourceMode === 'ftp' ? 'SOURCE FTP LIVE' : 'SOURCE RÉELLE');

      const heroCopy = document.querySelector('.day-hero-copy p');
      setText(heroCopy, payload.sourceMode === 'ftp'
        ? 'Production du jour issue de Factory-j+1, stock issu de la dernière photo EtatduParc.'
        : 'Résultat opérationnel de la dernière donnée disponible.');

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
    } finally {
      applying = false;
    }
  }

  function bindRange() {
    const board = document.querySelector('.cumulative-board');
    if (!board || board.dataset.liveRangeBound === '1') return;
    board.dataset.liveRangeBound = '1';
    board.querySelectorAll('input[type="date"]').forEach((input) => {
      const markChanged = () => {
        if (input.matches(':focus')) userChangedRange = true;
        if (latestPayload) patch(latestPayload);
      };
      input.addEventListener('change', markChanged);
      input.addEventListener('input', markChanged);
    });
  }

  async function load() {
    try {
      const stamp = Date.now();
      const [dashboardResponse, statusResponse] = await Promise.all([
        fetch(`/api/dashboard?history=1&_=${stamp}`, { cache:'no-store', headers:{'Cache-Control':'no-cache'} }),
        fetch(`/api/system-status?_=${stamp}`, { cache:'no-store', headers:{'Cache-Control':'no-cache'} }),
      ]);
      if (!dashboardResponse.ok) throw new Error(`dashboard ${dashboardResponse.status}`);
      const payload = await dashboardResponse.json();
      latestStatus = statusResponse.ok ? await statusResponse.json() : null;
      if (!payload.connected || !payload.snapshot?.date) throw new Error('données live indisponibles');
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
    const quick = window.setInterval(() => {
      quickRuns += 1;
      bindRange();
      if (latestPayload) patch(latestPayload);
      if (quickRuns >= 12) window.clearInterval(quick);
    }, 750);
    window.setInterval(() => void load(), 20000);
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
