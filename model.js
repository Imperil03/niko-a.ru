(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ReportModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ENGINES = ['yandex', 'google'];
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const monthLabel = (month, year = true) => `${MONTHS[Number(month.slice(5)) - 1]}${year ? ' ' + month.slice(0,4) : ''}`;
  const months = data => data.reports.map(r => r.month).sort();
  const getReport = (data, month) => data.reports.find(r => r.month === month) || null;
  const defaultMonth = data => months(data).includes(data.project.currentMonth) ? data.project.currentMonth : months(data).at(-1);
  const rankingRegions = report => Array.isArray(report?.rankingRegions) ? report.rankingRegions : [];
  const defaultRegion = report => rankingRegions(report)[0]?.id || null;
  const selectedRankings = (report, region) => rankingRegions(report).length ? report.rankingsByRegion?.[region] || null : report?.rankings || null;
  const normalize = value => String(value ?? '').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');
  function safeHref(value) {
    if (typeof value !== 'string') return null;
    if (/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) && !value.split('/').includes('..')) return value;
    try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch (_) {}
    return null;
  }
  function safeImageHref(value) {
    return typeof value === 'string' && value.startsWith('evidence/') && /\.(png|jpe?g|webp)$/.test(value) && safeHref(value) === value ? value : null;
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
  }
  function rankChange(before, after, comparable, isNew = false) {
    if (!comparable || after === undefined) return {kind:'no_data', amount:null};
    if (isNew || before === undefined) return {kind:'new', amount:null};
    if (before === null && after === null) return {kind:'same', amount:0};
    if (before === null) return {kind:'appeared', amount:null};
    if (after === null) return {kind:'lost', amount:null};
    return {kind:before > after ? 'up' : before < after ? 'down' : 'same', amount:Math.abs(before - after)};
  }
  function sameSettings(before, after, engine) {
    if (!before || !after || before.region !== after.region || before.device !== after.device || before.sourceKey !== after.sourceKey) return false;
    return JSON.stringify(before.engines?.[engine] ?? null) === JSON.stringify(after.engines?.[engine] ?? null);
  }
  function rankingsView(rankings) {
    if (rankings?.pending && !rankings.after) {
      const {start,before}=rankings, reference=before||start;
      if (!reference) return null;
      const initial=new Map((start?.rows||[]).map(r=>[r.id,r]));
      const previous=new Map((before?.rows||[]).map(r=>[r.id,r]));
      const rows=reference.rows.map(r=>{
        const row={id:r.id,query:r.query,direction:r.direction||'',isNew:false,removed:false};
        for(const engine of ENGINES){
          const first=initial.get(r.id);
          row[engine]={start:first&&normalize(first.query)===normalize(r.query)&&sameSettings(start,reference,engine)?first[engine]:undefined,before:previous.get(r.id)?.[engine],after:undefined,change:{kind:'no_data',amount:null}};
        }
        return row;
      });
      return {start,before,after:null,rows,stats:null,metaMatch:true,pending:true,notes:rankings.notes||[]};
    }
    if (!rankings?.after) return null;
    const {start, before, after} = rankings;
    const matches = Object.fromEntries(ENGINES.map(e => [e, sameSettings(before, after, e)]));
    const beforeMap = new Map((before?.rows || []).map(r => [r.id, r]));
    const startMap = new Map((start?.rows || []).map(r => [r.id, r]));
    const afterMap = new Map(after.rows.map(r => [r.id, r]));
    const rows = [...new Set([...afterMap.keys(), ...beforeMap.keys()])].map(id => {
      const old = beforeMap.get(id), current = afterMap.get(id), display = current || old;
      const renamed = !!(old && current && normalize(old.query) !== normalize(current.query));
      const isNew = !!before && (!old || renamed || ENGINES.every(e => !own(old, e)));
      const row = {id, query:display.query, direction:display.direction || '', isNew, removed:!current};
      for (const engine of ENGINES) {
        const previous = renamed ? undefined : old?.[engine];
        const initial = startMap.get(id);
        const initialMatches = initial && normalize(initial.query) === normalize(display.query) && sameSettings(start,after,engine);
        row[engine] = {start:initialMatches ? initial[engine] : undefined, before:previous, after:current?.[engine], change:rankChange(previous, current?.[engine], matches[engine], isNew)};
      }
      return row;
    });
    const stats = {};
    for (const engine of ENGINES) {
      const comparableRows = rows.filter(r => !r.isNew && r[engine].before !== undefined && r[engine].after !== undefined);
      const currentRows = rows.filter(r => r[engine].after !== undefined);
      const comparable = matches[engine] && comparableRows.length > 0;
      const population = comparable ? comparableRows : currentRows;
      const count = (side, top) => population.filter(r => typeof r[engine][side] === 'number' && r[engine][side] <= top).length;
      stats[engine] = {comparable, total:population.length, currentTotal:currentRows.length,
        newCount:rows.filter(r => r.isNew && r[engine].after !== undefined).length,
        missingCount:after.rows.length - currentRows.length,
        top3:{before:comparable ? count('before',3) : null, after:count('after',3)},
        top10:{before:comparable ? count('before',10) : null, after:count('after',10)}};
    }
    return {start, before, after, rows, stats, metaMatch:ENGINES.every(e => matches[e]),pending:false,notes:rankings.notes||[]};
  }
  function filterRows(rows, {search = '', direction = '', trend = 'all'} = {}) {
    const term = normalize(search).replaceAll('ё', 'е');
    return rows.filter(row => {
      if (term && !normalize(row.query).replaceAll('ё','е').includes(term)) return false;
      if (direction && row.direction !== direction) return false;
      const kinds = ENGINES.map(e => row[e]?.change?.kind || 'no_data');
      if (trend === 'up') return kinds.some(k => ['up','appeared'].includes(k));
      if (trend === 'down') return kinds.some(k => ['down','lost'].includes(k));
      if (trend === 'same') return kinds.includes('same') && kinds.every(k => ['same','no_data'].includes(k));
      if (trend === 'new') return row.isNew;
      return true;
    });
  }
  function sortRows(rows, engine = 'google') {
    const primary = ENGINES.includes(engine) ? engine : 'google';
    const secondary = ENGINES.find(value => value !== primary);
    const collator = new Intl.Collator('ru', {numeric:true,sensitivity:'base'});
    const position = value => Number.isInteger(value) && value > 0 ? [0,value] : value === null ? [1,0] : [2,0];
    const comparePosition = (a,b,key) => {
      const left = position(a[key]?.after), right = position(b[key]?.after);
      return left[0] - right[0] || left[1] - right[1];
    };
    const compareId = (a,b) => {
      const left = String(a.id ?? ''), right = String(b.id ?? '');
      return collator.compare(left,right) || (left < right ? -1 : left > right ? 1 : 0);
    };
    return rows.slice().sort((a,b) => comparePosition(a,b,primary) || comparePosition(a,b,secondary) ||
      collator.compare(String(a.query ?? ''),String(b.query ?? '')) || compareId(a,b));
  }
  function validateData(data) {
    const errors = [], check = (test, message) => { if (!test) errors.push(message); };
    if (!data?.project || !Array.isArray(data.reports)) return ['Нет настроек проекта или месяцев.'];
    check(data.project.id === 'niko' && data.project.website === 'https://niko-a.ru/', 'Неверный проект отчёта.');
    check(months(data).includes(data.project.currentMonth), 'Текущий месяц отсутствует.');
    check(new Set(months(data)).size === data.reports.length, 'Повторный месяц.');
    for (const report of data.reports) {
      const label = report.month;
      check(report.projectId === data.project.id && /^\d{4}-(0[1-9]|1[0-2])$/.test(label), 'Неверный идентификатор месяца.');
      check(['in_progress','closed'].includes(report.status), `${label}: неизвестное состояние отчёта.`);
      for (const key of ['intro','conclusions']) check(Array.isArray(report[key]) && report[key].every(x => typeof x === 'string'), `${label}: неверный текст ${key}.`);
      if (own(report,'resultsIntro')) check(Array.isArray(report.resultsIntro) && report.resultsIntro.every(x => typeof x === 'string'), `${label}: неверный вводный текст результатов.`);
      check(!(report.archive && report.rankings), `${label}: архив смешан с API.`);
      if (report.archive) {
        const a = report.archive;
        check(a.sourceLabel === 'Google Таблица' && report.status === 'closed', `${label}: неверный источник архива.`);
        check(Array.isArray(a.rows) && a.rows.length > 0, `${label}: пустой архив позиций.`);
        check(new Set((a.rows || []).map(r => r.id)).size === a.rows?.length, `${label}: повторные запросы архива.`);
        for (const engine of ENGINES) {
          check(Array.isArray(a.dates?.[engine]) && a.dates[engine].every(d => validDate(d.date) && typeof d.label === 'string'), `${label}: неверные даты архива.`);
          for (const row of a.rows || []) {
            check(typeof row.query === 'string' && row.query.trim() && typeof row.id === 'string', `${label}: неверный запрос.`);
            check(Array.isArray(row[engine]) && row[engine].length === a.dates?.[engine]?.length && row[engine].every(v => v === null || typeof v === 'string'), `${label}: потеря столбцов архива.`);
          }
          for (const top of ['top10','top3']) check(['before','after','change'].every(k => typeof a.kpis?.[engine]?.[top]?.[k] === 'string'), `${label}: неполная сводка архива.`);
        }
      }
      const regional = own(report,'rankingRegions') || own(report,'rankingsByRegion');
      const regions = rankingRegions(report);
      if (regional) {
        check(regions.length > 0 && regions.every(region => region && /^[a-z][a-z0-9-]*$/.test(region.id) && typeof region.label === 'string' && region.label.trim()), `${label}: неверные регионы замеров.`);
        check(new Set(regions.map(region => region?.id)).size === regions.length, `${label}: повторные регионы замеров.`);
        check(!!report.rankingsByRegion && typeof report.rankingsByRegion === 'object' && !Array.isArray(report.rankingsByRegion) && Object.keys(report.rankingsByRegion).length === regions.length && regions.every(region => region && own(report.rankingsByRegion,region.id)), `${label}: неполные замеры по регионам.`);
        check(!report.archive && !report.rankings, `${label}: региональные замеры смешаны с общими позициями.`);
      }
      const rankingGroups = regional ? regions.map(region => [region,report.rankingsByRegion?.[region?.id]]) : [[null,report.rankings]];
      for (const [region,rankings] of rankingGroups) {
        if (regional) check(rankings === null || (!!rankings && typeof rankings === 'object' && !Array.isArray(rankings)), `${label}: неверный замер региона.`);
        if (!rankings || typeof rankings !== 'object' || Array.isArray(rankings)) continue;
        const pending=rankings.pending===true;
        check(pending ? rankings.after===null && !!(rankings.before||rankings.start) : !!rankings.after, `${label}: нет текущего среза или явно зарезервированного столбца.`);
        if(pending)check(report.status==='in_progress',`${label}: ожидающий замер нельзя выдавать за завершённый отчёт.`);
        if(rankings.after)check(rankings.after.date?.slice(0,7) === label, `${label}: срез относится к другому месяцу.`);
        if(own(rankings,'notes'))check(Array.isArray(rankings.notes)&&rankings.notes.every(n=>typeof n==='string'),`${label}: неверные пояснения замеров.`);
        for (const snapshot of [rankings.start, rankings.before, rankings.after].filter(Boolean)) {
          check(validDate(snapshot.date) && snapshot.region && snapshot.device && snapshot.sourceKey, `${label}: неполные настройки замера.`);
          if (region) check(snapshot.region === region.label, `${label}: замер относится к другому региону.`);
          check(Array.isArray(snapshot.rows) && new Set(snapshot.rows.map(r => r.id)).size === snapshot.rows.length, `${label}: неполные или повторные запросы.`);
          for (const row of snapshot.rows || []) {
            check(typeof row.id === 'string' && typeof row.query === 'string' && row.query.trim(), `${label}: запрос без ID или текста.`);
            for (const engine of ENGINES) if (own(row, engine)) check(row[engine] === null || (Number.isInteger(row[engine]) && row[engine] > 0 && row[engine] <= 1000), `${label}: неверная позиция.`);
          }
        }
        if (rankings.before && rankings.after) check(rankings.before.date < rankings.after.date, `${label}: неверный порядок дат.`);
        if (rankings.start) check(rankings.start.date <= (rankings.before?.date || rankings.after?.date || rankings.start.date), `${label}: первый замер позже отчётного периода.`);
      }
      if (report.traffic) {
        const traffic = report.traffic;
        check(typeof traffic === 'object' && !Array.isArray(traffic), `${label}: неверные данные посещаемости.`);
        check(Number.isSafeInteger(traffic.visits) && traffic.visits >= 0, `${label}: неверное число визитов.`);
        if (own(traffic,'kind')) check(['all_sources','search'].includes(traffic.kind), `${label}: неизвестный вид посещаемости.`);
        if (own(traffic,'complete')) check(typeof traffic.complete === 'boolean', `${label}: неверный статус посещаемости.`);
        for (const key of ['sourceLabel','note']) if (own(traffic,key)) check(typeof traffic[key] === 'string', `${label}: неверное пояснение посещаемости.`);
        const dailyTraffic = traffic.kind === 'all_sources' || ['periodStart','periodEnd','daily','evidenceUrl'].some(key => own(traffic,key));
        if (dailyTraffic) {
          const validPeriod = validDate(traffic.periodStart) && validDate(traffic.periodEnd) && traffic.periodStart <= traffic.periodEnd;
          check(validPeriod, `${label}: неверный период посещаемости.`);
          check(typeof traffic.complete === 'boolean', `${label}: отсутствует статус полноты посещаемости.`);
          const daily = Array.isArray(traffic.daily) ? traffic.daily : [];
          check(daily.length > 0, `${label}: нет дневных значений посещаемости.`);
          let previous = null, total = 0, validValues = true;
          for (const day of daily) {
            const validDay = !!day && typeof day === 'object' && !Array.isArray(day) && validDate(day.date);
            const validVisits = !!day && Number.isSafeInteger(day.visits) && day.visits >= 0;
            check(validDay && validVisits, `${label}: неверное дневное значение посещаемости.`);
            if (validDay) {
              check(validPeriod && day.date >= traffic.periodStart && day.date <= traffic.periodEnd, `${label}: день посещаемости вне периода.`);
              check(previous === null || previous < day.date, `${label}: дни посещаемости повторяются или не упорядочены.`);
              previous = day.date;
            }
            if (validVisits) total += day.visits; else validValues = false;
          }
          check(validValues && total === traffic.visits, `${label}: сумма дневных визитов не совпадает с итогом.`);
          check(typeof traffic.evidenceUrl === 'string' && traffic.evidenceUrl.startsWith('evidence/') && /\.xlsx$/i.test(traffic.evidenceUrl) && safeHref(traffic.evidenceUrl) === traffic.evidenceUrl, `${label}: неверное приложение посещаемости.`);
        }
      }
      check(Array.isArray(report.works), `${label}: отсутствует список работ.`);
      check(new Set((report.works || []).map(w => w.id)).size === report.works?.length, `${label}: повторные работы.`);
      for (const work of report.works || []) {
        check(['id','title','summary','result'].every(k => typeof work[k] === 'string' && work[k].trim()), `${label}: неполная работа.`);
        check(work.why === null || typeof work.why === 'string', `${label}: неверное пояснение работы.`);
        if (own(work,'retainedEvidence')) check(Array.isArray(work.retainedEvidence) && work.retainedEvidence.every(url => typeof url === 'string' && url.startsWith('evidence/') && safeHref(url) === url), `${label}: неверный путь сохранённого подтверждения.`);
        for (const section of work.sections || []) {
          const validSection = !!section && typeof section === 'object' && !Array.isArray(section);
          check(validSection, `${label}: неверный раздел работы.`);
          if (!validSection) continue;
          if (own(section,'title')) check(typeof section.title === 'string', `${label}: неверный заголовок раздела.`);
          if (own(section,'afterText')) check(typeof section.afterText === 'string', `${label}: неверный текст после таблицы.`);
          if (own(section,'note')) check(typeof section.note === 'string', `${label}: неверное примечание раздела.`);
          if (own(section,'table')) {
            const table = section.table;
            const validColumns = Array.isArray(table?.columns) && table.columns.length > 0 && table.columns.every(column => typeof column === 'string' && column.trim());
            const validRows = Array.isArray(table?.rows) && table.rows.every(row => Array.isArray(row) && row.length === table.columns?.length && row.every(cell => typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))));
            check(!!table && typeof table === 'object' && !Array.isArray(table) && validColumns && validRows, `${label}: неверная таблица раздела.`);
            if (table && own(table,'label')) check(typeof table.label === 'string', `${label}: неверная подпись таблицы.`);
          }
          for (const link of section.links || []) check(!!safeHref(link.url), `${label}: небезопасная ссылка.`);
        }
        for (const evidence of work.evidence || []) {
          if (own(evidence,'text')) check(typeof evidence.text === 'string', `${label}: неверное описание подтверждения.`);
          check(['link','comparison','table','image'].includes(evidence.type), `${label}: неизвестное подтверждение.`);
          if (evidence.type === 'link') check(!!safeHref(evidence.url), `${label}: небезопасное подтверждение.`);
          if (evidence.type === 'image') {
            check(!!safeImageHref(evidence.url), `${label}: изображение должно находиться внутри evidence.`);
            check(typeof evidence.alt === 'string' && evidence.alt.trim(), `${label}: у изображения отсутствует описание.`);
          }
          if (evidence.type === 'comparison' && (own(evidence,'beforeImage') || own(evidence,'afterImage'))) {
            check(!!safeImageHref(evidence.beforeImage) && !!safeImageHref(evidence.afterImage), `${label}: сравнение должно содержать два изображения внутри evidence.`);
            check(['beforeAlt','afterAlt'].every(key => typeof evidence[key] === 'string' && evidence[key].trim()), `${label}: у снимков отсутствует описание.`);
          }
        }
      }
    }
    return errors;
  }
  return {ENGINES, months, monthLabel, getReport, defaultMonth, rankingRegions, defaultRegion, selectedRankings, safeHref, safeImageHref, validDate, normalize, rankChange, rankingsView, filterRows, sortRows, validateData};
});
