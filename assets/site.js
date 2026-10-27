(() => {
  'use strict';
  const one = (selector, scope = document) => scope.querySelector(selector);
  const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const storage = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };
  let toastTimer;
  const toast = message => {
    const box = one('.toast');
    if (!box) return;
    box.textContent = message;
    box.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('visible'), 3200);
  };
  const menu = one('.menu-toggle');
  menu?.addEventListener('click', () => {
    const opened = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(opened));
    menu.setAttribute('aria-label', opened ? '收起导航' : '展开导航');
    one('#main-nav')?.classList.toggle('is-open', opened);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') menu.click();
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      const search = one('[data-search-input]');
      if (search) { event.preventDefault(); search.focus(); }
    }
  });

  const catalogue = one('[data-catalogue]');
  if (catalogue) {
    const grid = one('[data-app-grid]', catalogue);
    const cards = all('[data-app]', grid);
    const search = one('[data-search-input]', catalogue);
    const sort = one('[data-sort]', catalogue);
    const params = new URLSearchParams(location.search);
    const filters = { platform: 'all', status: 'all', category: 'all' };
    const initialOrder = new Map(cards.map((card, i) => [card, i]));
    for (const key of Object.keys(filters)) {
      const requested = params.get(key);
      const group = one(`[data-filter-group="${key}"]`, catalogue);
      if (requested && all('button', group).some(button => button.dataset.value === requested)) filters[key] = requested;
    }
    search.value = params.get('q') || '';
    if (['recommended', 'name', 'active'].includes(params.get('sort'))) sort.value = params.get('sort');
    const update = () => {
      let count = 0;
      const query = search.value.trim().toLocaleLowerCase();
      for (const card of cards) {
        const appPlatforms = card.dataset.platforms.split('|');
        const platformMatch = filters.platform === 'all' || appPlatforms.includes(filters.platform) || (filters.platform === 'iOS' && appPlatforms.includes('iPadOS'));
        const statusMatch = filters.status === 'all' || card.dataset.status === filters.status || (filters.status === 'legacy' && ['archived', 'discontinued'].includes(card.dataset.status));
        const categoryMatch = filters.category === 'all' || card.dataset.category === filters.category;
        const queryMatch = !query || query.split(/\s+/).every(part => card.dataset.search.includes(part));
        card.hidden = !(platformMatch && statusMatch && categoryMatch && queryMatch);
        if (!card.hidden) count++;
      }
      const sorted = [...cards].sort((a, b) => {
        if (sort.value === 'name') return a.querySelector('h3').textContent.localeCompare(b.querySelector('h3').textContent, 'en');
        if (sort.value === 'active') {
          const weight = { active: 0, unknown: 1, archived: 2, discontinued: 3 };
          return weight[a.dataset.status] - weight[b.dataset.status] || initialOrder.get(a) - initialOrder.get(b);
        }
        return initialOrder.get(a) - initialOrder.get(b);
      });
      sorted.forEach(card => grid.append(card));
      one('[data-result-count]', catalogue).textContent = `显示 ${count} / ${cards.length} 个项目`;
      one('[data-empty]', catalogue).hidden = count !== 0;
      all('[data-filter-group]', catalogue).forEach(group => all('button', group).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === filters[group.dataset.filterGroup]))));
      const updated = new URL(location.href);
      for (const key of Object.keys(filters)) filters[key] === 'all' ? updated.searchParams.delete(key) : updated.searchParams.set(key, filters[key]);
      query ? updated.searchParams.set('q', search.value.trim()) : updated.searchParams.delete('q');
      sort.value === 'recommended' ? updated.searchParams.delete('sort') : updated.searchParams.set('sort', sort.value);
      history.replaceState(null, '', updated);
    };
    one('form', catalogue).addEventListener('submit', event => { event.preventDefault(); update(); });
    search.addEventListener('input', update);
    sort.addEventListener('change', update);
    all('[data-filter-group] button', catalogue).forEach(button => button.addEventListener('click', () => {
      filters[button.closest('[data-filter-group]').dataset.filterGroup] = button.dataset.value;
      update();
    }));
    all('[data-reset]', catalogue).forEach(button => button.addEventListener('click', () => {
      Object.keys(filters).forEach(key => { filters[key] = 'all'; });
      search.value = '';
      sort.value = 'recommended';
      update();
    }));
    update();
  }

  const comparisonData = one('#comparison-data');
  let knownApps = [];
  try { knownApps = comparisonData ? JSON.parse(comparisonData.textContent) : []; } catch {}
  const initialSelection = storage.get('clash-atlas-compare', []);
  let selection = Array.isArray(initialSelection) ? initialSelection.filter(slug => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)).slice(0, 3) : [];
  const selectedParam = new URLSearchParams(location.search).get('apps');
  if (comparisonData && selectedParam !== null) selection = [...new Set(selectedParam.split(',').filter(slug => knownApps.some(app => app.slug === slug)))].slice(0, 3);
  if (comparisonData) selection = selection.filter(slug => knownApps.some(app => app.slug === slug));
  const renderComparison = () => {
    const target = one('[data-comparison-selection]');
    if (!target) return;
    const selected = selection.map(slug => knownApps.find(app => app.slug === slug)).filter(Boolean);
    target.innerHTML = selected.length ? `<div class="selected-compare-grid">${selected.map(app => `<article class="selected-compare-card"><button class="remove-compare" type="button" data-remove="${escape(app.slug)}" aria-label="移除 ${escape(app.name)}">移除 ×</button><span class="eyebrow">${escape(app.category)}</span><h2>${escape(app.name)}</h2><dl><div><dt>支持平台</dt><dd>${app.platforms.map(escape).join(' / ')}</dd></div><div><dt>内核</dt><dd>${escape(app.core)}</dd></div><div><dt>维护状态</dt><dd>${escape(app.status)}</dd></div><div><dt>项目类型</dt><dd>${escape(app.category)}</dd></div></dl><ul>${app.features.map(feature => `<li>${escape(feature)}</li>`).join('')}</ul><p>${escape(app.statusNote)}</p><a class="text-link" href="/apps/${escape(app.slug)}/">查看完整资料与下载 ↗</a></article>`).join('')}</div>` : '<div class="compare-placeholder"><span aria-hidden="true">↔</span><div>还没有选择项目。<a href="/apps/">去软件目录勾选最多 3 款软件</a>，就可以并排比较。</div></div>';
    all('[data-remove]', target).forEach(button => button.addEventListener('click', () => {
      selection = selection.filter(slug => slug !== button.dataset.remove);
      syncCompare();
    }));
  };
  const syncCompare = () => {
    storage.set('clash-atlas-compare', selection);
    all('[data-compare]').forEach(input => { input.checked = selection.includes(input.dataset.compare); });
    const tray = one('.compare-tray');
    if (tray) {
      tray.hidden = selection.length === 0;
      one('[data-compare-count]', tray).textContent = selection.length;
      one('[data-compare-link]', tray).href = `/compare/?apps=${selection.join(',')}`;
    }
    if (comparisonData) {
      const url = new URL(location.href);
      selection.length ? url.searchParams.set('apps', selection.join(',')) : url.searchParams.delete('apps');
      history.replaceState(null, '', url);
    }
    renderComparison();
  };
  all('[data-compare]').forEach(input => input.addEventListener('change', () => {
    const slug = input.dataset.compare;
    if (input.checked && !selection.includes(slug)) {
      if (selection.length >= 3) { input.checked = false; toast('最多选择 3 款软件，请先移除一项。'); return; }
      selection.push(slug);
    } else if (!input.checked) selection = selection.filter(value => value !== slug);
    syncCompare();
  }));
  one('[data-compare-clear]')?.addEventListener('click', () => { selection = []; syncCompare(); });
  syncCompare();

  const defaultProxy = one('meta[name="download-proxy"]')?.content || 'https://gh-proxy.com/';
  const validProxy = input => {
    const url = new URL(String(input).trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('请填写不含账号、查询参数或片段的 HTTPS 加速前缀。');
    return url.href.replace(/\/+$/, '') + '/';
  };
  const applyProxy = prefix => {
    all('[data-download-source]').forEach(link => { link.href = prefix + link.dataset.downloadSource; });
    all('[data-proxy-name]').forEach(label => { label.textContent = new URL(prefix).hostname; });
  };
  let proxy = defaultProxy;
  try { proxy = validProxy(storage.get('clash-atlas-proxy', defaultProxy)); } catch { storage.remove('clash-atlas-proxy'); }
  applyProxy(proxy);
  const proxyInput = one('#proxy-prefix');
  if (proxyInput) {
    proxyInput.value = proxy;
    const feedback = one('.proxy-feedback');
    one('[data-save-proxy]')?.addEventListener('click', () => {
      try {
        const prefix = validProxy(proxyInput.value);
        const saved = storage.set('clash-atlas-proxy', prefix);
        proxyInput.value = prefix;
        applyProxy(prefix);
        feedback.textContent = saved ? `已保存：${prefix}。返回软件页即可使用。` : '当前浏览器不允许保存本地设置；其他页面将使用默认线路。';
        feedback.dataset.error = 'false';
      } catch (error) {
        feedback.textContent = error.message || '请填写有效的 HTTPS 加速前缀。';
        feedback.dataset.error = 'true';
        proxyInput.focus();
      }
    });
    one('[data-reset-proxy]')?.addEventListener('click', () => {
      storage.remove('clash-atlas-proxy');
      proxyInput.value = defaultProxy;
      applyProxy(defaultProxy);
      feedback.textContent = '已恢复默认加速线路。';
      feedback.dataset.error = 'false';
    });
  }

  // A cached page is restored without running this script again. Read current
  // preferences so Back/Forward does not resurrect an old proxy or comparison.
  const restorePreferences = () => {
    const saved = storage.get('clash-atlas-compare', []);
    selection = Array.isArray(saved) ? [...new Set(saved.filter(slug => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)))].slice(0, 3) : [];
    if (comparisonData) selection = selection.filter(slug => knownApps.some(app => app.slug === slug));
    syncCompare();
    let prefix = defaultProxy;
    try { prefix = validProxy(storage.get('clash-atlas-proxy', defaultProxy)); } catch { storage.remove('clash-atlas-proxy'); }
    applyProxy(prefix);
    if (proxyInput && document.activeElement !== proxyInput) proxyInput.value = prefix;
  };
  window.addEventListener('pageshow', event => { if (event.persisted) restorePreferences(); });
  window.addEventListener('storage', event => {
    if (event.key === null || ['clash-atlas-compare', 'clash-atlas-proxy'].includes(event.key)) restorePreferences();
  });
})();
