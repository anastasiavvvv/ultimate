import { db } from '../db.js';
import {
  esc, icon, modal, field, formData, toast, on,
  today, addDays, parseISO, fmtDate, fmtDateLong, startOfWeek, lastNDays, dateNav,
  lineChart, emptyState, sortBy, avg, plural,
} from '../ui.js';

export const title = 'Рефлексия';

// ---------- Локальное состояние ----------
let day = today();

// ---------- Справочники ----------
const PROMPTS = [
  'Что сегодня дало больше всего энергии, а что её забрало?',
  'Какое решение сегодня я принял(а) осознанно, а какое — на автомате?',
  'Если бы этот день повторился завтра, что бы я сделал(а) иначе?',
  'За что я могу похвалить себя сегодня — даже за мелочь?',
  'Что я сегодня узнал(а) о себе или о мире?',
  'Кому я сегодня помог(ла) или кто помог мне?',
  'Какая мысль сегодня занимала меня дольше всего — и стоит ли она того?',
  'Что из сегодняшнего приближает меня к целям на квартал?',
  'Что я откладывал(а) сегодня и почему?',
  'Какой момент дня я хотел(а) бы запомнить?',
];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const moodEmoji = (m) => MOODS[Number(m) - 1] || '·';

function dayOfYear(dateIso) {
  const d = parseISO(dateIso);
  return Math.round((d - new Date(d.getFullYear(), 0, 1)) / 86400000);
}

// ---------- Модалка недельного обзора ----------
function openWeeklyReviewModal(weekStart) {
  const ex = db.all('weeklyReviews').find(r => r.weekStart === weekStart) || null;
  modal({
    title: `Обзор недели с ${fmtDate(weekStart, { relative: false, year: true })}`,
    body: `<div class="form">
      ${field({ name: 'wins', label: 'Победы недели', type: 'textarea', value: ex?.wins || '', rows: 3, placeholder: 'Что получилось и чем горжусь' })}
      ${field({ name: 'challenges', label: 'Сложности', type: 'textarea', value: ex?.challenges || '', rows: 3, placeholder: 'Что мешало, где буксовал' })}
      ${field({ name: 'nextFocus', label: 'Фокус на следующую неделю', type: 'textarea', value: ex?.nextFocus || '', rows: 2, placeholder: '1–3 главных приоритета' })}
      ${field({ name: 'rating', label: 'Оценка недели', type: 'rating', value: ex?.rating ?? '', hint: '1 — провальная, 5 — отличная' })}
    </div>`,
    onSubmit: (d) => {
      const data = { weekStart, wins: d.wins || '', challenges: d.challenges || '', nextFocus: d.nextFocus || '', rating: d.rating ?? null };
      if (ex) db.update('weeklyReviews', ex.id, data); else db.add('weeklyReviews', data);
      toast('Обзор недели сохранён');
    },
    onDelete: ex ? () => { db.remove('weeklyReviews', ex.id); toast('Обзор удалён'); } : undefined,
  });
}

// ---------- Страница ----------
export async function render(root, ctx) {
  const rerender = () => render(root, ctx);
  const t = today();
  const journal = db.all('journal');
  const byDate = new Map(journal.map(r => [r.date, r]));
  const rec = byDate.get(day) || null;
  const recent = sortBy(journal, r => r.date, true).slice(0, 14);
  const reviews = sortBy(db.all('weeklyReviews'), r => r.weekStart, true);
  const currentWeek = startOfWeek();
  const currentReview = reviews.find(r => r.weekStart === currentWeek) || null;
  const promptText = PROMPTS[((dayOfYear(day) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];

  // Серия дней с записями (сегодня или вчера — отправная точка).
  let streak = 0;
  for (let d = byDate.has(t) ? t : addDays(t, -1); byDate.has(d) && streak < 3650; d = addDays(d, -1)) streak++;

  // Настроение за 30 дней.
  const days30 = lastNDays(30, t);
  const points = [];
  days30.forEach((d, i) => { const r = byDate.get(d); if (r && r.mood) points.push({ x: i, y: Number(r.mood) }); });
  const avgMood = points.length ? avg(points, p => p.y) : null;
  const chart = points.length >= 2
    ? lineChart([{ points, color: 'var(--accent)' }], days30.map(d => String(Number(d.slice(8, 10)))), { height: 120, min: 1, max: 5 })
    : '';

  const f = rec || {};
  const formHtml = `<form class="card form" data-journal>
    <div class="row between wrap"><h3 style="margin:0">Дневник дня</h3><span class="tiny muted">${esc(fmtDateLong(day))}</span></div>
    <div class="small" style="background:var(--accent-soft);color:var(--accent);padding:10px 12px;border-radius:10px"><b>Вопрос дня.</b> ${esc(promptText)}</div>
    ${field({ name: 'highlight', label: 'Главное событие', value: f.highlight || '', placeholder: 'Одной строкой' })}
    ${field({ name: 'wentWell', label: 'Что прошло хорошо', type: 'textarea', value: f.wentWell || '', rows: 3 })}
    ${field({ name: 'improve', label: 'Что улучшить', type: 'textarea', value: f.improve || '', rows: 3 })}
    ${field({ name: 'gratitude', label: 'За что благодарен', type: 'textarea', value: f.gratitude || '', rows: 2 })}
    ${field({ name: 'lessons', label: 'Инсайт дня', type: 'textarea', value: f.lessons || '', rows: 2 })}
    ${field({ name: 'mood', label: 'Настроение', type: 'rating', value: f.mood ?? '', labels: MOODS, hint: '1 — тяжёлый день, 5 — отличный' })}
    <div class="row between wrap">
      <button class="btn" type="submit">${icon('check')} Сохранить</button>
      ${rec ? `<button type="button" class="btn ghost sm" data-action="delete-entry">${icon('trash')} Удалить запись</button>` : '<span class="tiny faint">Записи за этот день ещё нет</span>'}
    </div>
  </form>`;

  const recentHtml = recent.length
    ? `<div class="list">${recent.map(r => `<div class="list-item clickable" data-action="go" data-date="${esc(r.date)}">
        <span style="font-size:20px;width:28px;text-align:center">${moodEmoji(r.mood)}</span>
        <div class="main">
          <div class="title">${esc(fmtDate(r.date, { weekday: true }))}</div>
          <div class="sub ellipsis">${esc(r.highlight || r.wentWell || r.lessons || 'без заголовка')}</div>
        </div>
        ${r.date === day ? '<span class="pill accent">открыта</span>' : ''}
      </div>`).join('')}</div>`
    : emptyState('Записей пока нет — начните с сегодняшнего дня', '📝');

  const reviewsHtml = reviews.length
    ? `<div class="list">${reviews.map(r => `<div class="list-item clickable" data-action="edit-review" data-id="${esc(r.id)}">
        <div class="main">
          <div class="title">Неделя с ${esc(fmtDate(r.weekStart, { relative: false, year: true }))}${r.weekStart === currentWeek ? ' <span class="tag">текущая</span>' : ''}</div>
          <div class="sub ellipsis">${esc(r.wins || r.nextFocus || r.challenges || '—')}</div>
        </div>
        ${r.rating ? `<span class="pill ${Number(r.rating) >= 4 ? 'good' : Number(r.rating) <= 2 ? 'bad' : ''}">${Number(r.rating)}/5</span>` : ''}
      </div>`).join('')}</div>`
    : emptyState('Обзоров пока нет. Пятница или воскресенье — хороший момент начать', '🗓️');

  root.innerHTML = `<div>
    <div class="page-head">
      <div><div class="eyebrow">Главное</div><h1>Рефлексия</h1></div>
      <div class="actions">${dateNav(day)}</div>
    </div>
    <div class="grid-3" style="margin-bottom:12px">
      <div class="stat">
        <div class="label">Записей</div>
        <div class="value">${journal.length}</div>
        <div class="sub">всего в дневнике</div>
      </div>
      <div class="stat">
        <div class="label">Серия</div>
        <div class="value">${streak}<small>${plural(streak, 'день', 'дня', 'дней')}</small></div>
        <div class="sub">${streak ? 'подряд с записями' : 'начните сегодня'}</div>
      </div>
      <div class="stat">
        <div class="label">Настроение</div>
        <div class="value">${avgMood != null ? `${moodEmoji(Math.round(avgMood))} ${avgMood.toFixed(1)}` : '—'}</div>
        <div class="sub">среднее за 30 дней</div>
      </div>
    </div>
    <div class="grid-2" style="align-items:start">
      ${formHtml}
      <div class="stack">
        <div class="card">
          <div class="section-title"><h2>Последние записи</h2><span class="tiny muted">${recent.length} из ${journal.length}</span></div>
          ${recentHtml}
        </div>
        ${chart ? `<div class="card">
          <div class="section-title"><h2>Настроение за 30 дней</h2><span class="tiny muted">1 — плохо, 5 — отлично</span></div>
          ${chart}
        </div>` : ''}
        <div class="card">
          <div class="section-title">
            <h2>Недельные обзоры</h2>
            <button type="button" class="btn sm secondary" data-action="weekly">${icon('edit')} ${currentReview ? 'Изменить обзор недели' : 'Обзор недели'}</button>
          </div>
          ${reviewsHtml}
        </div>
      </div>
    </div>
  </div>`;

  const view = root.firstElementChild;

  // Рейтинг в форме страницы (в модалках его подключает ui.js, здесь — вручную).
  on(view, 'click', '.rating button[data-v]', (e, b) => {
    const r = b.closest('.rating');
    const hidden = r.querySelector('input[type=hidden]');
    if (hidden.value === b.dataset.v) {
      hidden.value = '';
      r.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      return;
    }
    hidden.value = b.dataset.v;
    r.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  });

  on(view, 'submit', 'form[data-journal]', (e, form) => {
    e.preventDefault();
    const d = formData(form);
    const data = {
      date: day,
      wentWell: d.wentWell || '', improve: d.improve || '', gratitude: d.gratitude || '',
      lessons: d.lessons || '', highlight: d.highlight || '', mood: d.mood ?? null,
    };
    const hasContent = [data.wentWell, data.improve, data.gratitude, data.lessons, data.highlight].some(Boolean) || data.mood != null;
    if (!hasContent) { toast('Запись пустая — нечего сохранять'); return; }
    const existing = db.all('journal').find(r => r.date === day);
    if (existing) db.update('journal', existing.id, data); else db.add('journal', data);
    toast('Запись сохранена');
  });

  on(view, 'click', '[data-action]', (e, b) => {
    switch (b.dataset.action) {
      case 'go': day = b.dataset.date; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'delete-entry':
        if (rec && confirm('Удалить запись за этот день?')) { db.remove('journal', rec.id); toast('Запись удалена'); }
        break;
      case 'weekly': openWeeklyReviewModal(currentWeek); break;
      case 'edit-review': { const r = db.get('weeklyReviews', b.dataset.id); if (r) openWeeklyReviewModal(r.weekStart); break; }
      default: break;
    }
  });

  on(view, 'click', '[data-dn]', (e, b) => {
    const a = b.dataset.dn;
    if (a === 'prev') day = addDays(day, -1);
    else if (a === 'next') day = addDays(day, 1);
    else if (a === 'today') day = today();
    else return;
    rerender();
  });
  on(view, 'change', '[data-dn="pick"]', (e, inp) => { if (inp.value) { day = inp.value; rerender(); } });
}
