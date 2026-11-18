import { db } from '../db.js';
import {
  esc, icon, modal, field, formRow, toast, today, addDays, fmtDate, weekDays, lastNDays, parseISO,
  fmtMinutes, progressBar, emptyState, barChart, ring, on, sum, sortBy, clamp, plural,
} from '../ui.js';

export const title = 'Обучение';

// ---------- Справочники ----------
const TYPES = { course: 'Курс', book: 'Книга', article: 'Статья', video: 'Видео', practice: 'Практика', other: 'Другое' };
const TYPE_CLS = { course: 'accent', book: 'info', article: '', video: 'warn', practice: 'good', other: '' };
const STATUSES = { planned: 'Запланировано', active: 'В работе', done: 'Готово' };
const STATUS_ORDER = { active: 0, planned: 1, done: 2 };
const COLORS = [
  ['var(--c1)', 'Фиолетовый'], ['var(--c2)', 'Зелёный'], ['var(--c3)', 'Жёлтый'], ['var(--c4)', 'Красный'],
  ['var(--c5)', 'Синий'], ['var(--c6)', 'Розовый'], ['var(--c7)', 'Бирюзовый'], ['var(--c8)', 'Коричневый'],
];
const SEED_AREAS = [
  { name: 'Психология', icon: '🧠', color: 'var(--c1)' },
  { name: 'История', icon: '🏛️', color: 'var(--c2)' },
  { name: 'Менеджмент', icon: '📊', color: 'var(--c3)' },
  { name: 'Лидерство', icon: '🚀', color: 'var(--c4)' },
  { name: 'Эмпатия', icon: '💛', color: 'var(--c5)' },
  { name: 'Английский', icon: '🇬🇧', color: 'var(--c6)' },
];
const GRADES = [
  { key: 'again', label: 'Снова', cls: 'danger' },
  { key: 'hard', label: 'Трудно', cls: 'secondary' },
  { key: 'good', label: 'Хорошо', cls: '' },
  { key: 'easy', label: 'Легко', cls: 'good' },
];
const LEARNED_INTERVAL = 21;

// ---------- Локальное состояние (переживает перерисовку) ----------
let selectedArea = null;   // id области-фильтра для материалов
let itemFilter = 'all';    // all | active | planned | done
let timerStart = null;     // ms, если таймер запущен
let timerInterval = null;
let seedChecked = false;

// ---------- Помощники ----------
const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const colorBar = (value, max, color) => {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return `<div class="bar"><i style="width:${pct.toFixed(1)}%;background:${esc(color || 'var(--accent)')}"></i></div>`;
};
const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '';
const areaLabel = (a) => a ? `${a.icon || '📚'} ${a.name}` : 'Без области';
const findEnglish = (areas) => areas.find(a => String(a.name).trim().toLowerCase() === 'английский') || null;

// Упрощённый SM-2.
function schedule(card, grade) {
  let interval = Number(card.interval) || 0;
  let ease = Number(card.ease) || 2.5;
  let reps = Number(card.reps) || 0;
  let lapses = Number(card.lapses) || 0;
  if (grade === 'again') { interval = 1; lapses += 1; ease = Math.max(1.3, ease - 0.2); }
  else if (grade === 'hard') { interval = Math.max(1, Math.round(interval * 1.2)); }
  else if (grade === 'good') { interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease); }
  else { interval = Math.round(Math.max(interval, 1) * ease * 1.3); ease += 0.15; }
  interval = Math.max(1, interval);
  return { interval, ease: Math.round(ease * 100) / 100, reps: reps + 1, lapses, due: addDays(today(), interval) };
}

function seedAreasIfEmpty() {
  if (seedChecked) return;
  seedChecked = true;
  if (db.all('learningAreas').length) return;
  for (const a of SEED_AREAS) db.add('learningAreas', { ...a, description: '', weeklyMinutesTarget: 60 });
}

// ---------- Рендер ----------
export async function render(root, ctx = {}) {
  seedAreasIfEmpty();
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  const rerender = () => {
    const y = window.scrollY;
    return render(root, ctx).then(() => window.scrollTo(0, y));
  };

  const settings = db.settings();
  const weeklyTarget = Number(settings.learningWeeklyMinutes) || 0;
  const areas = sortBy(db.all('learningAreas'), a => a.createdAt || '');
  const areaById = Object.fromEntries(areas.map(a => [a.id, a]));
  if (selectedArea && !areaById[selectedArea]) selectedArea = null;
  const items = db.all('learningItems');
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const sessions = db.all('studySessions');
  const cards = db.all('flashcards');
  const t = today();

  // Неделя
  const week = weekDays(t);
  const weekSet = new Set(week);
  const weekSessions = sessions.filter(s => weekSet.has(s.date));
  const weekMinutes = sum(weekSessions, s => s.minutes);
  const todayMinutes = sum(sessions.filter(s => s.date === t), s => s.minutes);
  const weekPct = weeklyTarget > 0 ? (weekMinutes / weeklyTarget) * 100 : 0;
  const minutesByArea = {};
  for (const s of weekSessions) minutesByArea[s.areaId] = (minutesByArea[s.areaId] || 0) + (Number(s.minutes) || 0);

  // Серия дней подряд
  const daySet = new Set(sessions.map(s => s.date));
  let streak = 0, d = t;
  if (!daySet.has(d)) d = addDays(d, -1);
  while (daySet.has(d)) { streak++; d = addDays(d, -1); }

  // 14 дней
  const byDay = {};
  for (const s of sessions) byDay[s.date] = (byDay[s.date] || 0) + (Number(s.minutes) || 0);
  const chartData = lastNDays(14, t).map(day => ({
    label: String(parseISO(day).getDate()),
    value: byDay[day] || 0,
    color: day === t ? 'var(--c6)' : 'var(--accent)',
  }));
  const dailyTarget = weeklyTarget > 0 ? Math.round(weeklyTarget / 7) : null;

  // Материалы
  let visibleItems = items;
  if (selectedArea) visibleItems = visibleItems.filter(i => i.areaId === selectedArea);
  if (itemFilter !== 'all') visibleItems = visibleItems.filter(i => i.status === itemFilter);
  visibleItems = [...visibleItems].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const minutesByItem = {};
  for (const s of sessions) if (s.itemId) minutesByItem[s.itemId] = (minutesByItem[s.itemId] || 0) + (Number(s.minutes) || 0);

  // Последние занятия
  const recent = [...sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10);

  // Карточки
  const dueCards = cards.filter(c => (c.due || t) <= t);
  const learnedCount = cards.filter(c => (Number(c.interval) || 0) >= LEARNED_INTERVAL).length;
  const cardsSorted = [...cards].sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')));
  const CARDS_LIMIT = 30;

  const areaCard = (a) => {
    const mins = minutesByArea[a.id] || 0;
    const target = Number(a.weeklyMinutesTarget) || 0;
    const activeCount = items.filter(i => i.areaId === a.id && i.status === 'active').length;
    const selected = selectedArea === a.id;
    return `<div class="card" data-action="select-area" data-id="${esc(a.id)}" style="cursor:pointer;${selected ? 'outline:2px solid var(--accent);' : ''}">
      <div class="row between top">
        <div class="row" style="min-width:0">
          <span style="font-size:24px;line-height:1">${esc(a.icon || '📚')}</span>
          <div style="min-width:0">
            <div class="bold ellipsis">${esc(a.name)}</div>
            <div class="tiny muted">${activeCount} ${plural(activeCount, 'материал', 'материала', 'материалов')} в работе</div>
          </div>
        </div>
        <button type="button" class="icon-btn sm" data-action="edit-area" data-id="${esc(a.id)}" aria-label="Изменить">${icon('edit')}</button>
      </div>
      <div class="row between tiny muted" style="margin:12px 0 5px">
        <span class="bold" style="color:var(--fg)">${esc(fmtMinutes(mins))}</span>
        <span>${target ? `цель ${esc(fmtMinutes(target))}` : 'без цели'}</span>
      </div>
      ${colorBar(mins, target, a.color)}
    </div>`;
  };

  const itemRow = (it) => {
    const a = areaById[it.areaId];
    const p = clamp(Number(it.progress) || 0, 0, 100);
    const url = safeUrl(it.url);
    const mins = minutesByItem[it.id] || 0;
    return `<div class="list-item">
      <div class="main">
        <div class="row wrap" style="gap:6px">
          <span class="pill ${TYPE_CLS[it.type] || ''}">${esc(TYPES[it.type] || TYPES.other)}</span>
          <span class="title ${it.status === 'done' ? 'strike' : ''}" data-action="edit-item" data-id="${esc(it.id)}" style="cursor:pointer">${esc(it.title)}</span>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="tiny" title="Открыть ссылку">↗</a>` : ''}
        </div>
        <div class="sub">${esc(areaLabel(a))} · ${esc(STATUSES[it.status] || it.status)}${mins ? ` · ${esc(fmtMinutes(mins))}` : ''}${it.notes ? ` — ${esc(it.notes)}` : ''}</div>
        <div class="row" style="margin-top:7px">
          <div class="grow">${progressBar(p, 100, it.status === 'done' ? 'good thin' : 'thin')}</div>
          <span class="tiny mono muted" style="width:38px;text-align:right">${p}%</span>
        </div>
      </div>
      <button type="button" class="btn sm secondary" data-action="bump" data-id="${esc(it.id)}" ${p >= 100 ? 'disabled' : ''}>+10%</button>
      <button type="button" class="icon-btn sm" data-action="edit-item" data-id="${esc(it.id)}" aria-label="Изменить">${icon('edit')}</button>
    </div>`;
  };

  const sessionRow = (s) => {
    const a = areaById[s.areaId];
    const it = s.itemId ? itemById[s.itemId] : null;
    return `<div class="list-item">
      <span style="font-size:20px;line-height:1;width:28px;text-align:center">${esc(a?.icon || '📚')}</span>
      <div class="main">
        <div class="title">${esc(fmtMinutes(s.minutes))} · ${esc(a ? a.name : 'Без области')}</div>
        <div class="sub">${esc(fmtDate(s.date))}${it ? ` · ${esc(it.title)}` : ''}${s.notes ? ` — ${esc(s.notes)}` : ''}</div>
      </div>
      <button type="button" class="icon-btn sm" data-action="del-session" data-id="${esc(s.id)}" aria-label="Удалить">${icon('trash')}</button>
    </div>`;
  };

  const cardRow = (c) => {
    const due = c.due || t;
    const interval = Number(c.interval) || 0;
    const pillCls = due <= t ? 'warn' : interval >= LEARNED_INTERVAL ? 'good' : '';
    const pillText = due <= t ? 'к повторению' : `${esc(fmtDate(due))}`;
    return `<div class="list-item clickable" data-action="edit-card" data-id="${esc(c.id)}">
      <div class="main">
        <div class="title">${esc(c.front)} <span class="muted" style="font-weight:500">— ${esc(c.back)}</span></div>
        ${c.example ? `<div class="sub" style="font-style:italic">${esc(c.example)}</div>` : ''}
      </div>
      <span class="pill ${pillCls}">${pillText}</span>
    </div>`;
  };

  const segBtn = (key, label) => `<button type="button" class="${itemFilter === key ? 'active' : ''}" data-action="filter" data-filter="${key}">${label}</button>`;

  root.innerHTML = `<div class="learning-page">
    <div class="page-head">
      <div><div class="eyebrow">Развитие</div><h1>Обучение</h1></div>
      <div class="actions">
        ${timerStart
          ? `<span class="pill accent mono" id="timerElapsed" style="font-size:14px;padding:7px 12px">${fmtElapsed(Date.now() - timerStart)}</span>
             <button type="button" class="btn danger" data-action="timer-stop">${icon('x')} Стоп</button>`
          : `<button type="button" class="btn secondary" data-action="timer-start">${icon('play')} Старт таймера</button>`}
        <button type="button" class="btn" data-action="log-session">${icon('plus')} Записать занятие</button>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:12px">
      <div class="card row" style="gap:14px">
        ${ring(weekPct, { size: 84, stroke: 9, label: `${Math.round(weekPct)}%`, color: weekPct >= 100 ? 'var(--good)' : 'var(--accent)' })}
        <div class="grow">
          <div class="label">Эта неделя</div>
          <div class="value">${esc(fmtMinutes(weekMinutes))}</div>
          <div class="tiny muted" style="margin-top:4px">из ${esc(fmtMinutes(weeklyTarget))} · ${weekSessions.length} ${plural(weekSessions.length, 'занятие', 'занятия', 'занятий')}</div>
        </div>
      </div>
      <div class="stat">
        <div class="label">${icon('flame')} Серия</div>
        <div class="value ${streak ? 'warn' : ''}">${streak}<small>${plural(streak, 'день', 'дня', 'дней')}</small></div>
        <div class="sub">${daySet.has(t) ? 'Сегодня уже занимались' : streak ? 'Позанимайтесь сегодня, чтобы продолжить' : 'Начните серию сегодня'}</div>
      </div>
      <div class="stat">
        <div class="label">${icon('clock')} Сегодня</div>
        <div class="value">${esc(fmtMinutes(todayMinutes))}</div>
        <div class="sub">${dailyTarget ? `ориентир ${esc(fmtMinutes(dailyTarget))} в день` : 'цель не задана'}</div>
      </div>
    </div>

    <div class="card">
      <div class="row between"><h3>Минуты за 14 дней</h3>${dailyTarget ? `<span class="tiny muted">пунктир — ${esc(fmtMinutes(dailyTarget))}/день</span>` : ''}</div>
      ${barChart(chartData, { height: 130, target: dailyTarget, showValues: true })}
    </div>

    <div class="section-title">
      <h2>Области</h2>
      <div class="row">
        ${selectedArea ? `<button type="button" class="link" data-action="clear-area">Сбросить фильтр</button>` : ''}
        <button type="button" class="btn sm secondary" data-action="add-area">${icon('plus')} Область</button>
      </div>
    </div>
    ${areas.length ? `<div class="grid-auto">${areas.map(areaCard).join('')}</div>` : `<div class="card">${emptyState('Добавьте области обучения — например, «Психология» или «Английский»', '🎓')}</div>`}

    <div class="section-title">
      <h2>Материалы${selectedArea ? ` <span class="muted" style="font-weight:500">· ${esc(areaLabel(areaById[selectedArea]))}</span>` : ''}</h2>
      <div class="row wrap">
        <div class="seg">${segBtn('all', 'Все')}${segBtn('active', 'В работе')}${segBtn('planned', 'Запланировано')}${segBtn('done', 'Готово')}</div>
        <button type="button" class="btn sm secondary" data-action="add-item">${icon('plus')} Материал</button>
      </div>
    </div>
    <div class="card">
      ${visibleItems.length ? `<div class="list">${visibleItems.map(itemRow).join('')}</div>` : emptyState(items.length ? 'Ничего не найдено по текущему фильтру' : 'Добавьте курс, книгу или статью, которую хотите пройти', '📚')}
    </div>

    <div class="section-title"><h2>Последние занятия</h2><span class="tiny muted">последние 10</span></div>
    <div class="card">
      ${recent.length ? `<div class="list">${recent.map(sessionRow).join('')}</div>` : emptyState('Пока нет занятий — запустите таймер или запишите вручную', '⏱️')}
    </div>

    <div class="section-title">
      <h2>Английский: карточки</h2>
      <div class="row wrap">
        <button type="button" class="btn sm secondary" data-action="add-card">${icon('plus')} Карточка</button>
        <button type="button" class="btn sm" data-action="review" ${dueCards.length ? '' : 'disabled'}>${icon('repeat')} Повторить (${dueCards.length} к повторению)</button>
      </div>
    </div>
    <div class="card">
      <div class="row wrap" style="gap:24px;margin-bottom:${cards.length ? '12px' : '0'}">
        <div><div class="label">Всего карточек</div><div class="value">${cards.length}</div></div>
        <div><div class="label">К повторению</div><div class="value ${dueCards.length ? 'warn' : ''}">${dueCards.length}</div></div>
        <div><div class="label">Выучено</div><div class="value good">${learnedCount}</div></div>
      </div>
      ${cards.length
        ? `<div class="list">${cardsSorted.slice(0, CARDS_LIMIT).map(cardRow).join('')}</div>${cards.length > CARDS_LIMIT ? `<div class="tiny muted" style="margin-top:8px">…и ещё ${cards.length - CARDS_LIMIT}</div>` : ''}`
        : emptyState('Добавьте слова и фразы — повторение по интервалам поможет их запомнить', '🗂️')}
    </div>
  </div>`;

  const page = root.firstElementChild;

  // Таймер
  if (timerStart) {
    const span = root.querySelector('#timerElapsed');
    timerInterval = setInterval(() => {
      if (!timerStart || !document.body.contains(span)) return;
      span.textContent = fmtElapsed(Date.now() - timerStart);
    }, 1000);
  }

  // ---------- Модалки ----------
  const areaOptions = (withEmpty = true) => [
    ...(withEmpty ? [['', 'Без области']] : []),
    ...areas.map(a => [a.id, areaLabel(a)]),
  ];

  function openAreaModal(a) {
    modal({
      title: a ? 'Область обучения' : 'Новая область',
      body: `
        ${formRow(
          field({ name: 'icon', label: 'Эмодзи', value: a?.icon ?? '📚', placeholder: '📚' }),
          field({ name: 'name', label: 'Название', value: a?.name ?? '', required: true, placeholder: 'Например, Психология' }),
        )}
        ${formRow(
          field({ name: 'color', label: 'Цвет', type: 'select', value: a?.color ?? 'var(--c1)', options: COLORS }),
          field({ name: 'weeklyMinutesTarget', label: 'Цель, мин/неделю', type: 'number', value: a?.weeklyMinutesTarget ?? 60, min: 0, step: 15 }),
        )}
        ${field({ name: 'description', label: 'Описание', type: 'textarea', value: a?.description ?? '', rows: 3 })}`,
      onSubmit: (d) => {
        const rec = { name: d.name, icon: d.icon || '📚', color: d.color || 'var(--c1)', weeklyMinutesTarget: d.weeklyMinutesTarget ?? 60, description: d.description || '' };
        if (a) db.update('learningAreas', a.id, rec); else db.add('learningAreas', rec);
        toast(a ? 'Область обновлена' : 'Область добавлена');
      },
      onDelete: a ? () => {
        if (selectedArea === a.id) selectedArea = null;
        db.remove('learningAreas', a.id);
        toast('Область удалена');
      } : undefined,
    });
  }

  function openItemModal(it) {
    modal({
      title: it ? 'Материал' : 'Новый материал',
      body: `
        ${field({ name: 'title', label: 'Название', value: it?.title ?? '', required: true, placeholder: 'Курс, книга, статья…' })}
        ${formRow(
          field({ name: 'areaId', label: 'Область', type: 'select', value: it?.areaId ?? selectedArea ?? '', options: areaOptions() }),
          field({ name: 'type', label: 'Тип', type: 'select', value: it?.type ?? 'course', options: Object.entries(TYPES) }),
        )}
        ${formRow(
          field({ name: 'status', label: 'Статус', type: 'select', value: it?.status ?? 'planned', options: Object.entries(STATUSES) }),
          field({ name: 'progress', label: 'Прогресс, %', type: 'number', value: it?.progress ?? 0, min: 0, max: 100, step: 5 }),
        )}
        ${field({ name: 'url', label: 'Ссылка', type: 'url', value: it?.url ?? '', placeholder: 'https://…' })}
        ${field({ name: 'notes', label: 'Заметки', type: 'textarea', value: it?.notes ?? '', rows: 3 })}`,
      onSubmit: (d) => {
        const progress = clamp(Number(d.progress) || 0, 0, 100);
        const rec = { title: d.title, areaId: d.areaId || null, type: d.type, status: d.status, progress, url: d.url || '', notes: d.notes || '' };
        if (it) db.update('learningItems', it.id, rec); else db.add('learningItems', rec);
        toast(it ? 'Материал обновлён' : 'Материал добавлен');
      },
      onDelete: it ? () => { db.remove('learningItems', it.id); toast('Материал удалён'); } : undefined,
    });
  }

  function openLogModal({ minutes = 30, areaId = null, itemId = null, date = t } = {}) {
    const itemOptions = [['', 'Без материала'], ...sortBy(items.filter(i => i.status !== 'done' || i.id === itemId), i => `${STATUS_ORDER[i.status] ?? 9}${i.title}`)
      .map(i => [i.id, `${i.title}${areaById[i.areaId] ? ` · ${areaById[i.areaId].name}` : ''}`])];
    modal({
      title: 'Записать занятие',
      body: `
        ${formRow(
          field({ name: 'areaId', label: 'Область', type: 'select', value: areaId ?? selectedArea ?? areas[0]?.id ?? '', options: areaOptions(!areas.length) }),
          field({ name: 'itemId', label: 'Материал', type: 'select', value: itemId ?? '', options: itemOptions }),
        )}
        ${formRow(
          field({ name: 'date', label: 'Дата', type: 'date', value: date, required: true }),
          field({ name: 'minutes', label: 'Минуты', type: 'number', value: minutes, min: 1, step: 5, required: true }),
        )}
        ${field({ name: 'notes', label: 'Заметки', type: 'textarea', value: '', rows: 2, placeholder: 'Что изучали, что поняли' })}`,
      onSubmit: (d) => {
        const mins = Math.max(1, Math.round(Number(d.minutes) || 0));
        let aId = d.areaId || null;
        if (!aId && d.itemId && itemById[d.itemId]) aId = itemById[d.itemId].areaId || null;
        db.add('studySessions', { areaId: aId, itemId: d.itemId || null, date: d.date || t, minutes: mins, notes: d.notes || '' });
        toast(`Записано ${fmtMinutes(mins)}`);
      },
    });
  }

  function openCardModal(c) {
    const english = findEnglish(areas);
    modal({
      title: c ? 'Карточка' : 'Новая карточка',
      body: `
        ${field({ name: 'front', label: 'Слово или фраза', value: c?.front ?? '', required: true, placeholder: 'to look forward to' })}
        ${field({ name: 'back', label: 'Перевод', value: c?.back ?? '', required: true, placeholder: 'с нетерпением ждать' })}
        ${field({ name: 'example', label: 'Пример', type: 'textarea', value: c?.example ?? '', rows: 2, placeholder: 'I am looking forward to the weekend.' })}
        ${c ? `<div class="tiny muted" style="margin-top:4px">Интервал ${Number(c.interval) || 0} дн · повторений ${Number(c.reps) || 0} · ошибок ${Number(c.lapses) || 0} · следующий повтор ${esc(fmtDate(c.due || t))}</div>` : ''}`,
      onSubmit: (d) => {
        if (c) {
          db.update('flashcards', c.id, { front: d.front, back: d.back, example: d.example || '' });
          toast('Карточка обновлена');
        } else {
          db.add('flashcards', { areaId: english ? english.id : null, front: d.front, back: d.back, example: d.example || '', due: t, interval: 0, ease: 2.5, reps: 0, lapses: 0 });
          toast('Карточка добавлена');
        }
      },
      onDelete: c ? () => { db.remove('flashcards', c.id); toast('Карточка удалена'); } : undefined,
    });
  }

  function openReview() {
    const queue = db.where('flashcards', c => (c.due || t) <= t).sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')));
    if (!queue.length) { toast('Нет карточек к повторению'); return; }
    let idx = 0, shown = false, done = 0;
    const m = modal({ title: 'Повторение', body: '', noForm: true, cancelText: 'Закрыть' });
    const body = m.el.querySelector('.modal-body');

    const draw = () => {
      if (idx >= queue.length) {
        body.innerHTML = `<div class="empty"><div class="big">🎉</div>Готово! Повторено карточек: ${done}</div>`;
        return;
      }
      const c = queue[idx];
      body.innerHTML = `
        <div class="row between tiny muted" style="margin-bottom:10px"><span>Карточка ${idx + 1} из ${queue.length}</span><span>интервал ${Number(c.interval) || 0} дн</span></div>
        <div class="card" style="background:var(--bg);box-shadow:none;text-align:center;padding:28px 16px">
          <div class="value" style="font-size:26px">${esc(c.front)}</div>
          ${shown ? `
            <div class="divider" style="margin:16px 0"></div>
            <div class="value" style="font-size:20px;color:var(--accent)">${esc(c.back)}</div>
            ${c.example ? `<div class="muted small" style="margin-top:8px;font-style:italic">${esc(c.example)}</div>` : ''}` : ''}
        </div>
        <div class="row wrap" style="margin-top:14px;justify-content:center;gap:8px">
          ${shown
            ? GRADES.map((g, i) => `<button type="button" class="btn ${g.cls}" data-rate="${g.key}" title="Клавиша ${i + 1}">${g.label}<span class="tiny" style="opacity:.75;margin-left:4px">${schedule(c, g.key).interval} дн</span></button>`).join('')
            : `<button type="button" class="btn" data-show>Показать ответ <span class="tiny" style="opacity:.75;margin-left:4px">пробел</span></button>`}
        </div>`;
    };

    const rate = (grade) => {
      const c = queue[idx];
      db.update('flashcards', c.id, schedule(c, grade));
      done++; idx++; shown = false;
      draw();
    };

    body.addEventListener('click', (e) => {
      const show = e.target.closest('[data-show]');
      if (show) { shown = true; draw(); return; }
      const r = e.target.closest('[data-rate]');
      if (r && shown) rate(r.dataset.rate);
    });

    const onKey = (e) => {
      if (!document.body.contains(m.el)) { document.removeEventListener('keydown', onKey); return; }
      if (idx >= queue.length) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!shown) { shown = true; draw(); } }
      else if (shown && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rate(GRADES[Number(e.key) - 1].key); }
    };
    document.addEventListener('keydown', onKey);
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { obs.disconnect(); document.removeEventListener('keydown', onKey); }
    });
    obs.observe(document.getElementById('modals'), { childList: true });

    draw();
  }

  // ---------- События ----------
  on(page, 'click', '[data-action]', (e, btn) => {
    const act = btn.dataset.action, id = btn.dataset.id;
    switch (act) {
      case 'timer-start':
        timerStart = Date.now();
        rerender();
        toast('Таймер запущен');
        break;
      case 'timer-stop': {
        const mins = Math.max(1, Math.round((Date.now() - timerStart) / 60000));
        timerStart = null;
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        rerender();
        openLogModal({ minutes: mins });
        break;
      }
      case 'log-session': openLogModal(); break;
      case 'add-area': openAreaModal(null); break;
      case 'edit-area': openAreaModal(areaById[id]); break;
      case 'select-area':
        selectedArea = selectedArea === id ? null : id;
        rerender();
        break;
      case 'clear-area': selectedArea = null; rerender(); break;
      case 'filter': itemFilter = btn.dataset.filter || 'all'; rerender(); break;
      case 'add-item': openItemModal(null); break;
      case 'edit-item': openItemModal(itemById[id]); break;
      case 'bump': {
        const it = itemById[id]; if (!it) break;
        const p = clamp((Number(it.progress) || 0) + 10, 0, 100);
        const patch = { progress: p };
        if (p >= 100) patch.status = 'done';
        else if (it.status === 'planned') patch.status = 'active';
        db.update('learningItems', id, patch);
        break;
      }
      case 'del-session':
        if (confirm('Удалить занятие?')) { db.remove('studySessions', id); toast('Занятие удалено'); }
        break;
      case 'add-card': openCardModal(null); break;
      case 'edit-card': openCardModal(db.get('flashcards', id)); break;
      case 'review': openReview(); break;
    }
  });

  return () => { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } };
}
