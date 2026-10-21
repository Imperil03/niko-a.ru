(() => {
  'use strict';
  const M = window.ReportModel, data = window.REPORT_DATA;
  const $ = id => document.getElementById(id);
  if (!M || !data) { $('panel-results').textContent = 'Не удалось загрузить отчёт. Обновите страницу.'; return; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paragraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
  const strongHTML = value => esc(value).replace(/\*\*([^*\r\n]+)\*\*/g, '<strong>$1</strong>');
  const detailParagraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${strongHTML(p)}</p>`).join('');
  const number = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
  const dateLabel = value => value ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value + 'T12:00:00Z')) : '';
  const icon = (name, cls = '') => `<svg class="${cls}" width="20" height="20" aria-hidden="true" viewBox="0 0 24 24">${{
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', chevron:'<path d="m9 5 7 7-7 7"/>',
    external:'<path d="M7 17 17 7M7 7h10v10"/>', work:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 6h6m-6 5h6"/>',
    chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>', up:'<path d="M12 20V4m-6 6 6-6 6 6"/>', down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  }[name] || ''}</svg>`;
  const tabs = ['results','works'], months = M.months(data), dialog = $('detail-dialog');
  const hasWorkDetails = month => month >= '2026-10';
  const state = {month:M.defaultMonth(data),region:M.defaultRegion(M.getReport(data,M.defaultMonth(data))),tab:'works',detail:null,filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex'};
  let view = null, report = null, positionColumns = null, renderedMonth = null, currentDetail = null, lastOpener = null;
  const linkHTML = item => M.safeHref(item.url) ? `<a href="${esc(M.safeHref(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.label || item.url)}${icon('external')}</a>` : esc(item.label || 'Ссылка недоступна');
  function readRoute() {
    const url = new URL(location.href), requestedMonth = url.searchParams.get('month'), tab = url.hash.slice(1);
    const month = months.includes(requestedMonth) ? requestedMonth : M.defaultMonth(data), monthReport = M.getReport(data,month), requestedRegion = url.searchParams.get('region');
    const region = M.rankingRegions(monthReport).some(item => item.id === requestedRegion) ? requestedRegion : M.defaultRegion(monthReport);
    return {month,region,tab:tabs.includes(tab) ? tab : 'works',detail:url.searchParams.get('work')};
  }
  function routeURL() {
    const url = new URL(location.href);
    url.searchParams.set('month',state.month); url.searchParams.delete('task');
    if (state.region) url.searchParams.set('region',state.region); else url.searchParams.delete('region');
    if (state.detail) url.searchParams.set('work',state.detail); else url.searchParams.delete('work');
    url.hash = state.tab; return url;
  }
  function navigate(changes, {replace = false, focusTab = false} = {}) {
    if ((changes.month && changes.month !== state.month) || (changes.region && changes.region !== state.region)) { state.filters = {search:'',direction:'',trend:'all'}; state.limit = 25; }
    Object.assign(state, changes);
    const monthReport = M.getReport(data,state.month);
    if (!M.rankingRegions(monthReport).some(item => item.id === state.region)) state.region = M.defaultRegion(monthReport);
    if (state.detail && (state.tab !== 'works' || !hasWorkDetails(state.month) || !M.getReport(data,state.month)?.works.some(w => w.id === state.detail))) state.detail = null;
    try { history[replace ? 'replaceState' : 'pushState'](null,'',routeURL()); } catch (_) {}
    render(); if (focusTab) $('tab-' + state.tab).focus({preventScroll:true});
  }
  function pendingHTML(kind) {
    const region = kind === 'results' && M.rankingRegions(report).find(item => item.id === state.region);
    const heading = kind === 'works' ? 'Работы за этот месяц ещё не добавлены' : region ? `Позиции: ${esc(region.label)} — замеров пока нет` : 'Позиции за этот месяц ещё не добавлены';
    const text = kind === 'works' ? 'Будем добавлять выполненные работы по мере готовности. Итоги месяца появятся после его завершения.' : 'Здесь появятся сохранённые замеры Яндекса и Google с фактическими датами проверки.';
    return `<div class="empty-state surface"><div class="empty-symbol">${icon(kind === 'works' ? 'work' : 'chart')}</div><div><h2>${heading}</h2><p>${text}</p></div></div>`;
  }
  function kpiHTML(engine, top) {
    if (report.archive) {
      const metric = report.archive.kpis[engine]['top' + top];
      const before = metric.before.replace(/^Было:\s*/i,'').trim(), after = metric.after.replace(/^Стало:\s*/i,'').trim();
      return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values"><div><span class="kpi-period">Было</span><span class="number before">${esc(before)}</span></div>${icon('arrow','kpi-arrow')}<div><span class="kpi-period">Стало</span><span class="number neutral">${esc(after)}</span></div></div><p class="kpi-count archive-change">${esc(metric.change)}</p></div>`;
    }
    const stats = view?.stats[engine], metric = stats?.['top' + top];
    if (!stats?.total) return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p class="no-metric">Нет данных</p></div>`;
    const after = metric.after / stats.total * 100, before = metric.before === null ? null : metric.before / stats.total * 100;
    const trend = before === null || after === before ? 'neutral' : after > before ? 'positive' : 'negative';
    return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${before === null ? '' : `<div><span class="kpi-period">Было</span><span class="number before">${number(metric.before)}</span></div>${icon('arrow','kpi-arrow')}`}<div>${before === null ? '' : '<span class="kpi-period">Стало</span>'}<span class="number ${trend}">${number(metric.after)}</span></div></div><p class="kpi-count">из ${number(stats.total)} запросов · ${number(after)}%</p></div>`;
  }
  function engineKpisHTML() {
    return `<div class="engine-kpi-grid">${M.ENGINES.map(engine => `<section class="engine-kpi-card surface engine-${engine}" aria-labelledby="kpi-heading-${engine}"><h3 class="searcher-name" id="kpi-heading-${engine}">${engine === 'yandex' ? 'Яндекс' : 'Google'}</h3><div class="engine-kpi-metrics">${[10,3].map(top => kpiHTML(engine,top)).join('')}</div></section>`).join('')}</div>`;
  }
  function rankCharts() {
    const archive = report.archive;
    if (!archive && !view) return '';
    const percent = text => Number.parseFloat(text.replace(/^.*?:\s*/,'').replace(',','.'));
    const stats = archive ? Object.fromEntries(M.ENGINES.map(engine => [engine, Object.fromEntries([3,10].map(top => ['top' + top, {
      before:percent(archive.kpis[engine]['top' + top].before), after:percent(archive.kpis[engine]['top' + top].after)
    }]))])) : view.stats;
    const max = Math.max(1, ...Object.values(stats).flatMap(s => [s.top3.before,s.top3.after,s.top10.before,s.top10.after].filter(Number.isFinite)));
    return `<div class="charts-grid">${M.ENGINES.map(engine => {
      const s = stats[engine], comparable = archive || s.comparable;
      if (!archive && !s.total) return '';
      const bars = [3,10].map(top => `<div class="rank-bar-group">${['before','after'].map(side => {
        const value = s['top' + top][side];
        return Number.isFinite(value) ? `<div class="rank-bar ${side}" style="height:${value / max * 104}px"><span>${number(value)}${archive ? '%' : ''}</span></div>` : '';
      }).join('')}<strong>Топ-${top}</strong></div>`).join('');
      const name = engine === 'yandex' ? 'Яндекс' : 'Google';
      return `<section class="ranking-chart surface" aria-label="${name}: ${archive ? 'доли запросов по архивной сводке' : 'количество запросов'}"><h3>${name}</h3>${archive ? '<p class="archive-chart-note">Доли запросов по сводке архивного отчёта</p>' : ''}<div class="rank-bars">${bars}</div><div class="chart-legend">${comparable ? `<span><i class="before-key"></i>Было${archive ? '' : ' · ' + dateLabel(view.before.date)}</span>` : ''}<span><i></i>${comparable ? 'Стало' : 'Сейчас'}${archive ? '' : ' · ' + dateLabel(view.after.date)}</span></div></section>`;
    }).join('')}</div>`;
  }
  function trafficHTML() {
    if (!report.traffic) return '';
    return `<section class="traffic-card surface"><div><h3>Поисковый трафик</h3><p class="traffic-value">${number(report.traffic.visits)}<span>визитов</span></p><p class="source-label">${esc(report.traffic.sourceLabel || '')}</p>${report.traffic.note ? `<p class="traffic-context">${esc(report.traffic.note)}</p>` : ''}</div></section>`;
  }
  function rankCell(value, archive = false) {
    if (value === undefined || (archive && (value === null || value === ''))) return '<span class="rank-missing">Нет замера</span>';
    if (value === null) return '<span class="rank-value rank-out" aria-label="Сайт не найден в результатах проверки">—</span>';
    const numeric = Number(value), band = numeric > 0 && numeric <= 3 ? 'top3' : numeric <= 10 && numeric > 0 ? 'top10' : numeric <= 30 && numeric > 0 ? 'top30' : 'other';
    return `<span class="rank-value rank-${band}">${archive ? esc(value) : number(value)}</span>`;
  }
  function deltaHTML(change) {
    const labels = {appeared:'Появился',lost:'За пределами',same:'Без изменений',no_data:'Не сравниваем',new:'Новый запрос'};
    if (['up','down'].includes(change.kind)) return `<span class="delta ${change.kind === 'up' ? 'positive' : 'negative'}" aria-label="${change.kind === 'up' ? 'Рост' : 'Снижение'} на ${change.amount}">${icon(change.kind)}${number(change.amount)}</span>`;
    return `<span class="delta ${change.kind === 'appeared' ? 'positive' : change.kind === 'lost' ? 'negative' : 'neutral'}">${labels[change.kind]}</span>`;
  }
  function queryTableHTML() {
    if (!report.archive && !view) return '';
    const archive = report.archive, rows = archive ? archive.rows : view.rows;
    const directions = [...new Set(rows.map(r => r.direction).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
    const labels = {start:'Начало работ',before:'Прошлый месяц',after:view?.pending?'Новый замер':'Сейчас'};
    const shortLabels = {start:'Старт',before:'Было',after:view?.pending?'Новый':'Стало'};
    positionColumns = Object.fromEntries(M.ENGINES.map(engine => [engine, archive ? archive.dates[engine].map((d,i,dates) => ({...d,key:i,role:i === dates.length - 1 ? 'after' : i === 0 ? 'start' : 'before'})) :
      ['start','before','after'].filter(role => (role === 'after' && view.pending) || (view[role] && (role !== 'start' || view.start.date !== view.after?.date))).map(role => ({key:role,role,date:view[role]?.date || null,pending:role === 'after' && view.pending}))]));
    const counts = Object.fromEntries(M.ENGINES.map(e => [e,positionColumns[e].length]));
    const heading = engine => positionColumns[engine].map((column,i) => {
      const date = column.pending ? '<span class="rank-date-pending"><span class="rank-date-full">Ожидается</span><span class="rank-date-short" aria-hidden="true">Ждём</span></span>' : `<time datetime="${column.date}" aria-label="${dateLabel(column.date)}"><span class="rank-date-full">${dateLabel(column.date)}</span><span class="rank-date-short" aria-hidden="true">${dateLabel(column.date).slice(0,5)}</span></time>`;
      return `<th id="rank-${engine}-${column.key}" scope="col" class="engine-${engine} period-${column.role} ${i === 0 ? 'engine-start' : ''} ${column.role === 'after' ? 'current' : ''} ${column.pending ? 'pending-measurement' : ''}" aria-label="${labels[column.role]}, ${column.pending ? 'ожидается' : dateLabel(column.date)}"><span class="rank-label-long">${labels[column.role]}</span><span class="rank-label-short" aria-hidden="true">${shortLabels[column.role]}</span>${date}</th>`;
    }).join('');
    const columns = M.ENGINES.map(engine => positionColumns[engine].map(() => `<col class="rank-col engine-${engine}">`).join('')).join('');
    const method = archive ? '«Нет замера» — нет данных за эту дату.' : view.pending ? '«—» — сайт не найден в сохранённом замере. «Нет замера» — данные за эту дату отсутствуют. Столбец «Новый замер» зарезервирован; динамика появится после добавления проверки.' : '«—» — сайт не найден. «Нет замера» — измерение отсутствует. Стрелки показывают изменение к прошлому месяцу. Новые запросы не включаем в сравнение.';
    const legend = `<div class="rank-legend" aria-label="Обозначения позиций"><span>${view?.pending ? 'Позиции в сохранённом замере:' : 'Текущие позиции:'}</span><span><i class="rank-key rank-top3" aria-hidden="true"></i>Топ-3</span><span><i class="rank-key rank-top10" aria-hidden="true"></i>4–10</span><span><i class="rank-key rank-top30" aria-hidden="true"></i>11–30</span><span><i class="rank-key rank-other" aria-hidden="true"></i>31 и ниже</span></div>`;
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2></div><div class="table-filters"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, тактическая аптечка" value="${esc(state.filters.search)}"></div><div class="filter-field direction"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>${icon('chevron')}</div></div>${!archive && view.before && !view.pending ? `<div class="filter-field trend"><label for="trend-filter">Динамика за месяц</label><div class="select-wrap"><select id="trend-filter">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([v,label]) => `<option value="${v}">${label}</option>`).join('')}</select>${icon('chevron')}</div></div>` : ''}</div>${legend}<div class="mobile-engine" role="group" aria-label="Поисковик в таблице"><button type="button" data-engine="yandex" aria-pressed="${state.engine === 'yandex'}">Яндекс</button><button type="button" data-engine="google" aria-pressed="${state.engine === 'google'}">Google</button></div><p class="table-scroll-hint">Проведите по таблице влево, чтобы увидеть текущие позиции.</p><div class="table-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table snapshot-positions" style="--rank-columns:${counts.yandex + counts.google};--yandex-columns:${counts.yandex};--google-columns:${counts.google}"><caption class="sr-only">Позиции запросов за ${esc(M.monthLabel(state.month).toLowerCase())}: начало работ, прошлый месяц и ${view?.pending ? 'место для нового замера' : 'текущий замер'}</caption><colgroup><col class="query-col">${columns}</colgroup><thead><tr><th id="query-heading" rowspan="2" scope="col" class="query-heading">Запрос</th><th id="engine-yandex" colspan="${counts.yandex}" scope="colgroup" class="engine-yandex engine-title engine-start">Яндекс</th><th id="engine-google" colspan="${counts.google}" scope="colgroup" class="engine-google engine-title engine-start">Google</th></tr><tr>${M.ENGINES.map(heading).join('')}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="show-more">Показать ещё 25</button></div><p class="table-method">${method}</p></section>`;
  }
  function renderQueries() {
    if (!$('query-rows')) return;
    const archive = report.archive, allRows = archive ? archive.rows : view.rows;
    const filtered = M.filterRows(allRows,state.filters), visible = filtered.slice(0,state.limit);
    $('query-rows').innerHTML = visible.map((row,rowIndex) => `<tr><th id="query-${rowIndex}" scope="row" class="query-name">${esc(row.query)}</th>${M.ENGINES.map(engine => positionColumns[engine].map((column,i) => {
      const value = row[engine][column.key], change = !archive && column.role === 'after' && row[engine].change;
      const movement = change && ['up','down','appeared','lost','new'].includes(change.kind) ? `<span class="rank-movement">${deltaHTML(change)}</span>` : '';
      return `<td headers="query-${rowIndex} engine-${engine} rank-${engine}-${column.key}" class="engine-${engine} period-${column.role} ${i === 0 ? 'engine-start' : ''} ${column.role === 'after' ? 'current' : ''} ${column.pending ? 'pending-measurement' : ''}">${column.pending ? '<span class="rank-missing" aria-label="Новый замер ожидается">…</span>' : rankCell(value,!!archive)}${movement}</td>`;
    }).join('')).join('')}</tr>`).join('');
    $('positions-wrap').hidden = filtered.length === 0; $('query-empty').hidden = filtered.length !== 0;
    $('query-count').textContent = `Показано: ${visible.length} из ${filtered.length}`; $('show-more').hidden = state.limit >= filtered.length;
  }
  function resultsHTML() {
    view = M.rankingsView(report.rankings);
    let intro = report.intro.map(paragraphsHTML).join('');
    if (report.conclusions.length) intro += '<p class="archive-conclusion-title">Выводы</p>' + report.conclusions.map(paragraphsHTML).join('');
    const reference = view?.after || view?.before || view?.start;
    const stateNote = !report.archive && view ? view.pending ? `${view.start?.date ? 'Начало работ — ' + dateLabel(view.start.date) + '. ' : 'Стартовый замер отсутствует. '}${view.before ? 'Прошлый замер — ' + dateLabel(view.before.date) + '. ' : ''}Новый замер ожидается. ${esc(reference.region)}. ${esc(reference.device)}.` : `${report.status === 'in_progress' ? 'Промежуточные данные. Итоговый отчёт будет подготовлен в конце месяца. ' : ''}Замеры Топвизора: ${view.before ? dateLabel(view.before.date) + ' — ' : ''}${dateLabel(view.after.date)}. ${esc(reference.region)}. ${esc(reference.device)}.` : '';
    const note = (view?.before && !view.metaMatch ? '<p class="metrics-note">Настройки замеров различаются. Динамику не сравниваем.</p>' : '') + (view?.notes || []).map(n=>`<p class="metrics-note">${esc(n)}</p>`).join('');
    const regions = M.rankingRegions(report);
    const regionPicker = regions.length ? `<div class="table-filters"><div class="filter-field direction"><label for="report-region">Город</label><div class="select-wrap"><select id="report-region">${regions.map(region => `<option value="${esc(region.id)}"${region.id === state.region ? ' selected' : ''}>${esc(region.label)}</option>`).join('')}</select>${icon('chevron')}</div></div></div>` : '';
    return `<div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2>${regionPicker}${intro}${stateNote ? `<p class="report-state">${stateNote}</p>` : ''}</div>${report.archive || (view && !view.pending) ? engineKpisHTML() + note + rankCharts() + trafficHTML() + queryTableHTML() : note + trafficHTML() + (view ? queryTableHTML() : pendingHTML('results'))}`;
  }
  function worksHTML() {
    if (!report.works.length) return pendingHTML('works');
    const details = hasWorkDetails(state.month);
    return `<div class="works-heading"><h2>Работы за ${M.monthLabel(state.month).toLowerCase()}</h2></div><section class="surface"><table class="works-table${details ? '' : ' without-details'}"><thead><tr><th scope="col">Что сделали</th><th scope="col">Краткое описание</th><th scope="col">Для чего это нужно</th>${details ? '<th scope="col">Подробнее</th>' : ''}</tr></thead><tbody>${report.works.map(work => `<tr><td><h3 class="work-name">${esc(work.title)}</h3></td><td class="work-summary">${esc(work.summary)}</td><td data-label="Для чего это нужно">${work.why ? paragraphsHTML(work.why) : '—'}</td>${details ? `<td><button type="button" class="work-open" data-work="${esc(work.id)}" aria-label="Подробнее: ${esc(work.title)}">Подробнее${icon('arrow')}</button></td>` : ''}</tr>`).join('')}</tbody></table></section>`;
  }
  function tableHTML(item, emphasize = false) {
    const isUrlMap = item.rows.length > 0 && item.rows.every(row => row.length === 3 && [row[1],row[2]].every(value => typeof value === 'string' && value.startsWith('/')));
    const content = emphasize ? strongHTML : esc;
    const compact = emphasize && item.columns.length <= 3 && !isUrlMap;
    return `${isUrlMap || compact ? '' : '<p class="table-scroll-hint">Проведите по таблице влево, чтобы увидеть остальные показатели.</p>'}<div class="table-scroll" role="region" aria-label="${esc(item.label)}"${isUrlMap ? '' : ' tabindex="0"'}><table class="evidence-table${isUrlMap ? ' evidence-url-map' : compact ? ' evidence-compact' : ''}" role="table"><thead role="rowgroup"><tr role="row">${item.columns.map(c => `<th scope="col" role="columnheader">${content(c)}</th>`).join('')}</tr></thead><tbody role="rowgroup">${item.rows.map(row => `<tr role="row">${item.columns.map((column,i) => `<td data-label="${esc(column)}" role="cell">${isUrlMap && i > 0 ? content(row[i]).replaceAll('/','/<wbr>').replaceAll('-','-<wbr>') : content(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function evidenceHTML(item) {
    if (item.type === 'link') return `<p class="detail-resource">${linkHTML(item)}</p>`;
    let body = '';
    const hasImages = item.type === 'comparison' && M.safeImageHref(item.beforeImage) && M.safeImageHref(item.afterImage);
    if (item.type === 'comparison') {
      const sideHTML = (side,label) => `<div><h4>${label}</h4>${item[side] ? `<p>${esc(item[side])}</p>` : ''}${hasImages ? `<figure class="comparison-screenshot"><a href="${esc(item[side + 'Image'])}" target="_blank" rel="noopener noreferrer" aria-label="${label}: открыть снимок в полном размере"><img src="${esc(item[side + 'Image'])}" alt="${esc(item[side + 'Alt'])}" loading="lazy" decoding="async"></a><figcaption>Нажмите на снимок, чтобы открыть его в полном размере.</figcaption></figure>` : ''}</div>`;
      body = `<div class="comparison-grid${hasImages ? ' has-images' : ''}">${sideHTML('before','Было')}${sideHTML('after','Стало')}</div>`;
    }
    if (item.type === 'table') body = tableHTML(item);
    return `<details class="evidence-block"${hasImages || item.type === 'table' ? ' open' : ''}><summary>${esc(item.label)}</summary><div class="evidence-content">${item.text ? `<p class="evidence-intro">${esc(item.text)}</p>` : ''}${body}</div></details>`;
  }
  function sectionHTML(section) {
    return `<section class="detail-section">${section.title?.trim() ? `<h3>${esc(section.title)}</h3>` : ''}${detailParagraphsHTML(section.text)}${section.bullets?.length ? `<ul>${section.bullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${section.table ? tableHTML({...section.table,label:section.table.label || section.title || 'Таблица'},true) : ''}${section.note ? `<p class="section-note">${strongHTML(section.note)}</p>` : ''}${detailParagraphsHTML(section.afterText)}${section.links?.length ? `<ul class="detail-links">${section.links.map(l => `<li>${linkHTML(l)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  function renderDetail() {
    const work = state.tab === 'works' && hasWorkDetails(state.month) && report.works.find(w => w.id === state.detail);
    const key = work ? `${state.month}:${work.id}` : null;
    if (!work) {
      if (dialog.open) { dialog.close(); document.body.classList.remove('dialog-open'); (lastOpener?.isConnected ? lastOpener : $('tab-' + state.tab)).focus({preventScroll:true}); }
      currentDetail = null; return;
    }
    if (key === currentDetail && dialog.open) return;
    dialog.dataset.reportView = 'works'; $('detail-title').textContent = work.title; $('detail-meta').hidden = true;
    const sections = (work.sections || []).map(sectionHTML).join('');
    $('detail-body').innerHTML = `<section class="actual-result"><h3>Что сделали</h3>${detailParagraphsHTML(work.result)}${work.resultBullets?.length ? `<ul class="result-bullets">${work.resultBullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${sections}${(work.evidence || []).map(evidenceHTML).join('')}</section>`;
    if (!dialog.open) { dialog.showModal(); document.body.classList.add('dialog-open'); }
    $('detail-body').scrollTop = 0; $('close-detail').focus({preventScroll:true}); currentDetail = key;
  }
  function render() {
    const monthReport = M.getReport(data,state.month), viewKey = `${state.month}:${state.region || ''}`;
    report = {...monthReport,rankings:M.selectedRankings(monthReport,state.region)}; $('report-month').value = state.month;
    if (renderedMonth !== viewKey) { $('panel-results').innerHTML = resultsHTML(); $('panel-works').innerHTML = worksHTML(); renderedMonth = viewKey; }
    for (const tab of tabs) { $('tab-' + tab).setAttribute('aria-selected',String(state.tab === tab)); $('tab-' + tab).tabIndex = state.tab === tab ? 0 : -1; $('panel-' + tab).hidden = state.tab !== tab; }
    $('work-count').hidden = !report.works.length; $('work-count').textContent = report.works.length;
    document.title = `Отчёт по продвижению сайта «${data.project.name}» — ${M.monthLabel(state.month)}`;
    renderQueries(); renderDetail();
  }
  $('report-client').textContent = `«${data.project.name}»`;
  $('site-link').href = M.safeHref(data.project.website); $('site-link').innerHTML = esc(new URL(data.project.website).hostname) + icon('external');
  $('period-label').textContent = months.length === 1 ? M.monthLabel(months[0]) : `${M.monthLabel(months[0])} — ${M.monthLabel(months.at(-1)).toLowerCase()}`;
  $('report-month').innerHTML = months.map(month => `<option value="${month}">${M.monthLabel(month)}</option>`).join('');
  $('report-month').addEventListener('change',event => { navigate({month:event.target.value,detail:null}); $('announcement').textContent = `Выбран ${M.monthLabel(state.month)}.`; });
  tabs.forEach((tab,index) => {
    $('tab-' + tab).addEventListener('click',() => navigate({tab,detail:null}));
    $('tab-' + tab).addEventListener('keydown',event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      navigate({tab:tabs[next],detail:null},{focusTab:true});
    });
  });
  document.addEventListener('click',event => {
    const work = event.target.closest('[data-work]'); if (work) { lastOpener = work; navigate({detail:work.dataset.work}); return; }
    const engine = event.target.closest('button[data-engine]');
    if (engine) { state.engine = engine.dataset.engine; $('positions-wrap').dataset.engine = state.engine; document.querySelectorAll('button[data-engine]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.engine === state.engine))); return; }
    if (event.target.closest('#show-more')) { state.limit += 25; renderQueries(); }
  });
  document.addEventListener('input',event => { if (event.target.id === 'query-search') { state.filters.search = event.target.value; state.limit = 25; renderQueries(); } });
  document.addEventListener('change',event => {
    if (event.target.id === 'report-region') { navigate({region:event.target.value}); $('report-region')?.focus({preventScroll:true}); $('announcement').textContent = `Выбран город: ${M.rankingRegions(report).find(region => region.id === state.region)?.label || ''}.`; return; }
    if (event.target.id === 'direction-filter') state.filters.direction = event.target.value;
    else if (event.target.id === 'trend-filter') state.filters.trend = event.target.value; else return;
    state.limit = 25; renderQueries();
  });
  $('close-detail').addEventListener('click',() => navigate({detail:null}));
  dialog.addEventListener('cancel',event => { event.preventDefault(); navigate({detail:null}); });
  dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) navigate({detail:null}); } });
  function restoreRoute() { navigate(readRoute(),{replace:true}); }
  window.addEventListener('popstate',restoreRoute); window.addEventListener('hashchange',restoreRoute);
  navigate(readRoute(),{replace:true});
})();
