import { db } from '../db.js';
import { esc, icon, field, formRow, formData, toast, on, today, addDays, lastNDays, fmtDate, fmtNum, avg, sum, sortBy, emptyState, barChart, lineChart, dateNav, weekdayShort, plural } from '../ui.js';

export const title = 'Сон и энергия';

const QUALITY = ['😫', '😕', '😐', '🙂', '😴'];
const ENERGY = ['🪫', '😴', '😐', '⚡', '🔥'];
const tile = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

// Локальное состояние: выбранная дата (дата пробуждения).
let day = today();

// ---------- Время ----------
const toMin = (t) => {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fromMin = (m) => {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Для усреднения отбоя: время до полудня считаем «после полуночи» (+24 ч).
const bedNorm = (t) => { const v = toMin(t); return v == null ? null : (v < 720 ? v + 1440 : v); };

function calcHours(bed, wake) {
  const b = toMin(bed), w = toMin(wake);
  if (b == null || w == null) return null;
  let d = w - b;
  if (d < 0) d += 1440;
  return Math.round(d / 15) / 4;
}

// ---------- Инсайты ----------
function insights(logs, target) {
  if (logs.length < 7) return [`Недостаточно данных: нужно хотя бы 7 записей, пока ${logs.length}.`];
  const out = [];
  const f1 = (v) => fmtNum(v, 1);

  const withE = logs.filter(l => l.hours != null && l.energy);
  const long = withE.filter(l => Number(l.hours) >= target), short = withE.filter(l => Number(l.hours) < target);
  if (long.length >= 3 && short.length >= 3) {
    const a = avg(long, l => l.energy), b = avg(short, l => l.energy);
    out.push(`В дни после сна ≥ ${f1(target)} ч средняя энергия ${f1(a)}, после короткого сна — ${f1(b)}${a - b >= 0.3 ? '. Длинный сон явно помогает.' : a - b <= -0.3 ? '. Любопытно: короткий сон не снижает энергию.' : '. Разница небольшая.'}`);
  } else out.push('Связь длительности сна и энергии: недостаточно данных (нужно по 3 дня с длинным и коротким сном).');

  const wDates = new Set(db.all('workouts').map(w => w.date));
  const withQ = logs.filter(l => l.quality);
  const afterW = withQ.filter(l => wDates.has(addDays(l.date, -1)));
  const noW = withQ.filter(l => !wDates.has(addDays(l.date, -1)));
  if (afterW.length >= 3 && noW.length >= 3) {
    const a = avg(afterW, l => l.quality), b = avg(noW, l => l.quality);
    out.push(`Качество сна в ночь после тренировки — ${f1(a)}/5, без тренировки — ${f1(b)}/5${a - b >= 0.3 ? '. Тренировки улучшают сон.' : a - b <= -0.3 ? '. После тренировок сон хуже — возможно, они слишком поздно.' : '. Заметной разницы нет.'}`);
  } else out.push('Связь тренировок и сна: недостаточно данных (нужно по 3 ночи после тренировки и без неё).');

  const withB = logs.filter(l => bedNorm(l.bedTime) != null && l.quality);
  if (withB.length >= 6) {
    const sorted = sortBy(withB, l => bedNorm(l.bedTime));
    const med = bedNorm(sorted[Math.floor(sorted.length / 2)].bedTime);
    const early = withB.filter(l => bedNorm(l.bedTime) < med), late = withB.filter(l => bedNorm(l.bedTime) >= med);
    if (early.length >= 3 && late.length >= 3) {
      const a = avg(early, l => l.quality), b = avg(late, l => l.quality);
      out.push(`Если лечь раньше ${fromMin(med)}, качество сна в среднем ${f1(a)}/5, позже — ${f1(b)}/5.`);
    }
  }
  return out;
}

// ---------- Страница ----------
export async function render(root, ctx) {
  const rerender = () => render(root, ctx);
  const target = Number(db.settings().sleepTarget) || 8;
  const logs = sortBy(db.all('sleepLogs'), l => l.date);
  const byDate = new Map(logs.map(l => [l.date, l]));
  const cur = byDate.get(day);

  // --- статистика за 7 дней
  const week = lastNDays(7).map(d => byDate.get(d)).filter(Boolean);
  const weekH = week.filter(l => l.hours != null && !isNaN(Number(l.hours)));
  const avgH = weekH.length ? avg(weekH, l => l.hours) : null;
  const weekQ = week.filter(l => l.quality);
  const avgQ = weekQ.length ? avg(weekQ, l => l.quality) : null;
  const debt = sum(weekH, l => Math.max(0, target - Number(l.hours)));
  const beds = week.map(l => bedNorm(l.bedTime)).filter(v => v != null);
  const avgBed = beds.length ? fromMin(avg(beds)) : null;

  // --- графики за 14 дней
  const days14 = lastNDays(14);
  const bars = days14.map(d => {
    const h = Number(byDate.get(d)?.hours) || 0;
    return { label: weekdayShort(d), value: h, valueLabel: fmtNum(h, 1), color: h >= target ? 'var(--good)' : 'var(--warn)' };
  });
  const hasBars = bars.some(b => b.value > 0);
  const mk = (k) => days14.map((d, i) => ({ x: i, y: byDate.get(d)?.[k] ?? null })).filter(p => p.y != null);
  const energyPts = mk('energy'), qualityPts = mk('quality');

  const recent = [...logs].reverse().slice(0, 14);
  const tips = insights(logs, target);

  root.innerHTML = `<div>
    <div class="page-head">
      <div><div class="eyebrow">Тело</div><h1>Сон и энергия</h1></div>
      <div class="actions">${dateNav(day)}</div>
    </div>

    <div class="grid-4">
      ${tile('Сон, среднее за 7 дней', avgH != null ? `<span class="${avgH >= target ? 'good' : 'warn'}">${fmtNum(avgH, 1)}</span><small>ч</small>` : '—', `цель ${fmtNum(target, 1)} ч${weekH.length ? ` · ${weekH.length} ${plural(weekH.length, 'ночь', 'ночи', 'ночей')}` : ''}`)}
      ${tile('Качество сна', avgQ != null ? `${fmtNum(avgQ, 1)}<small>/5</small>` : '—', 'среднее за 7 дней')}
      ${tile('Долг сна за неделю', weekH.length ? `<span class="${debt >= 5 ? 'bad' : debt > 0 ? 'warn' : 'good'}">${fmtNum(debt, 1)}</span><small>ч</small>` : '—', 'сумма недосыпа до цели')}
      ${tile('Среднее время отбоя', avgBed ? `<span class="mono">${avgBed}</span>` : '—', 'за 7 дней')}
    </div>

    <div class="grid-2" style="margin-top:12px;align-items:start">
      <form class="card form" id="sleepForm">
        <div class="row between"><h3 style="margin:0">Сон · ${esc(fmtDate(day, { weekday: true }))}</h3>${cur ? '<span class="pill good">Записано</span>' : ''}</div>
        <p class="tiny muted">Дата — день пробуждения. Часы считаются автоматически по времени отбоя и подъёма, но их можно поправить.</p>
        ${formRow(
          field({ name: 'bedTime', label: 'Лёг спать', type: 'time', value: cur?.bedTime || '' }),
          field({ name: 'wakeTime', label: 'Проснулся', type: 'time', value: cur?.wakeTime || '' }),
          field({ name: 'hours', label: 'Часов сна', type: 'number', step: 0.25, min: 0, max: 24, value: cur?.hours ?? '', placeholder: '7.5' }),
        )}
        <div class="row wrap top" style="gap:16px">
          ${field({ name: 'quality', label: 'Качество сна', type: 'rating', value: cur?.quality, labels: QUALITY })}
          ${field({ name: 'energy', label: 'Энергия днём', type: 'rating', value: cur?.energy, labels: ENERGY })}
        </div>
        ${field({ name: 'notes', label: 'Заметки', type: 'textarea', value: cur?.notes, rows: 2, placeholder: 'Что повлияло на сон?' })}
        <button class="btn" type="submit">${icon('check')} Сохранить</button>
      </form>

      <div class="stack">
        <div class="card">
          <div class="row between"><h3 style="margin:0">Часы сна · 14 дней</h3><span class="tiny muted">пунктир — цель ${fmtNum(target, 1)} ч</span></div>
          ${hasBars ? barChart(bars, { target, showValues: true, height: 130 }) : emptyState('Пока нет записей за две недели', '🌙')}
        </div>
        <div class="card">
          <h3>Энергия и качество сна · 14 дней</h3>
          ${(energyPts.length + qualityPts.length) > 0
            ? lineChart([{ points: energyPts, color: 'var(--c2)' }, { points: qualityPts, color: 'var(--c1)' }], days14.map(weekdayShort), { min: 1, max: 5 })
            : emptyState('Оцените сон и энергию, чтобы увидеть график', '📈')}
          <div class="legend" style="margin-top:8px">
            <span><i class="sw" style="background:var(--c2)"></i>Энергия</span>
            <span><i class="sw" style="background:var(--c1)"></i>Качество сна</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:12px;align-items:start">
      <div class="card">
        <h3>Наблюдения</h3>
        <div class="stack tight small">${tips.map(t => `<div class="row top" style="gap:8px"><span class="accent">•</span><span>${esc(t)}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="row between"><h3 style="margin:0">История</h3><span class="tiny muted">последние 14</span></div>
        ${recent.length ? `<div class="list">${recent.map(l => {
          const h = Number(l.hours);
          const bits = [];
          if (l.bedTime || l.wakeTime) bits.push(`${esc(l.bedTime || '—')} → ${esc(l.wakeTime || '—')}`);
          if (l.quality) bits.push(`качество ${esc(l.quality)}/5`);
          if (l.energy) bits.push(`энергия ${esc(l.energy)}/5`);
          return `<div class="list-item">
            <div class="main" data-pick="${esc(l.date)}" style="cursor:pointer">
              <div class="title">${esc(fmtDate(l.date, { weekday: true }))}</div>
              <div class="sub">${bits.join(' · ') || '—'}${l.notes ? ` · <span class="faint">${esc(l.notes)}</span>` : ''}</div>
            </div>
            ${l.hours != null && !isNaN(h) ? `<span class="pill ${h >= target ? 'good' : 'warn'}">${fmtNum(h, 2)} ч</span>` : ''}
            <button class="icon-btn sm" data-del="${esc(l.id)}" aria-label="Удалить">${icon('trash')}</button>
          </div>`;
        }).join('')}</div>` : emptyState('Записей пока нет — заполните форму слева', '🌙')}
      </div>
    </div>
  </div>`;

  const view = root.firstElementChild;

  // --- навигация по датам
  on(view, 'click', '[data-dn]', (e, t) => {
    const a = t.dataset.dn;
    if (a === 'pick') return;
    day = a === 'prev' ? addDays(day, -1) : a === 'next' ? addDays(day, 1) : today();
    rerender();
  });
  on(view, 'change', '[data-dn="pick"]', (e, t) => { if (t.value) { day = t.value; rerender(); } });
  on(view, 'click', '[data-pick]', (e, t) => { day = t.dataset.pick; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // --- оценки 1-5 внутри страницы
  on(view, 'click', '.rating button[data-v]', (e, b) => {
    const r = b.closest('.rating');
    const hidden = r.querySelector('input[type=hidden]');
    if (hidden.value === b.dataset.v) { hidden.value = ''; r.querySelectorAll('button').forEach(x => x.classList.remove('active')); return; }
    hidden.value = b.dataset.v;
    r.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  });

  // --- форма сна
  const form = view.querySelector('#sleepForm');
  const bedEl = form.querySelector('[name="bedTime"]'), wakeEl = form.querySelector('[name="wakeTime"]'), hoursEl = form.querySelector('[name="hours"]');
  const recompute = () => { const h = calcHours(bedEl.value, wakeEl.value); if (h != null) hoursEl.value = h; };
  bedEl.addEventListener('change', recompute);
  wakeEl.addEventListener('change', recompute);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    let hours = d.hours;
    if (hours == null) hours = calcHours(d.bedTime, d.wakeTime);
    if (hours == null && !d.quality && !d.energy) { toast('Укажите время сна или часы'); return; }
    const rec = { date: day, bedTime: d.bedTime || '', wakeTime: d.wakeTime || '', hours, quality: d.quality, energy: d.energy, notes: d.notes };
    db.upsert('sleepLogs', cur ? { id: cur.id, ...rec } : rec);
    toast('Сон сохранён');
  });

  // --- удаление из истории
  on(view, 'click', '[data-del]', (e, t) => {
    const l = db.get('sleepLogs', t.dataset.del); if (!l) return;
    if (!confirm(`Удалить запись за ${fmtDate(l.date)}?`)) return;
    db.remove('sleepLogs', l.id);
    toast('Запись удалена');
  });
}
