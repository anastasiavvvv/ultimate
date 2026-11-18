import { db, DEFAULT_SETTINGS, COLLECTIONS } from '../db.js';
import { esc, icon, field, formRow, formData, toast, on, fmtNum } from '../ui.js';
import { canInstall, promptInstall, isStandalone, onInstallChange } from '../pwa.js';

export const title = 'Настройки';


function installBlock() {
  if (isStandalone()) return `<p class="muted small">ULTIMATE открыт как установленное приложение и работает офлайн. Данные по-прежнему хранятся на этом устройстве.</p>`;
  if (canInstall()) return `<p class="muted small" style="margin-bottom:10px">Поставьте ULTIMATE на экран как обычное приложение: откроется без адресной строки и будет работать без интернета.</p><button class="btn" data-install>${icon('download')} Установить</button>`;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios
    ? `<p class="muted small">На iPhone: нажмите кнопку «Поделиться» в Safari, затем «На экран Домой». Иконка ULTIMATE появится рядом с другими приложениями.</p>`
    : `<p class="muted small">В Chrome или Edge: иконка установки в адресной строке, либо меню браузера → «Установить ULTIMATE». В Safari на Mac: Файл → «Добавить в Dock».</p>`;
}

export async function render(root) {
  const s = db.settings();
  const counts = COLLECTIONS.map(c => db.all(c).length).reduce((a, b) => a + b, 0);
  root.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Ресурсы</div><h1>Настройки</h1></div></div>
    <div class="grid-2" style="align-items:start">
      <form class="card form" id="sform">
        <h3>Профиль и нормы</h3>
        ${field({ name: 'name', label: 'Имя', value: s.name, placeholder: 'Как к вам обращаться' })}
        ${field({ name: 'theme', label: 'Тема', type: 'select', value: s.theme, options: [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']] })}
        <div class="divider"></div>
        <div class="label caps">Питание (в день)</div>
        ${formRow(
          field({ name: 'kcalTarget', label: 'Калории', type: 'number', value: s.kcalTarget, min: 800, step: 10 }),
          field({ name: 'proteinTarget', label: 'Белок, г', type: 'number', value: s.proteinTarget, min: 0 }),
          field({ name: 'fatTarget', label: 'Жиры, г', type: 'number', value: s.fatTarget, min: 0 }),
          field({ name: 'carbsTarget', label: 'Углеводы, г', type: 'number', value: s.carbsTarget, min: 0 }),
        )}
        ${formRow(
          field({ name: 'waterTarget', label: 'Вода, мл', type: 'number', value: s.waterTarget, min: 0, step: 100 }),
          field({ name: 'stepsTarget', label: 'Шаги', type: 'number', value: s.stepsTarget, min: 0, step: 500 }),
        )}
        <div class="divider"></div>
        ${formRow(
          field({ name: 'sleepTarget', label: 'Сон, часов', type: 'number', value: s.sleepTarget, min: 4, max: 12, step: 0.5 }),
          field({ name: 'learningWeeklyMinutes', label: 'Обучение, мин/неделю', type: 'number', value: s.learningWeeklyMinutes, min: 0, step: 15 }),
          field({ name: 'currency', label: 'Валюта', value: s.currency }),
        )}
        <button class="btn" type="submit">${icon('check')} Сохранить</button>
      </form>
      <div class="stack">
        <div class="card">
          <h3>Данные</h3>
          <p class="muted small" style="margin-bottom:12px">Всё хранится локально в этом браузере (IndexedDB). Записей: <b>${fmtNum(counts)}</b>. Делайте резервную копию раз в неделю — файл можно импортировать на другом устройстве.</p>
          <div class="row wrap">
            <button class="btn secondary" data-export>${icon('download')} Экспорт JSON</button>
            <button class="btn secondary" data-import>${icon('upload')} Импорт JSON</button>
            <input type="file" accept="application/json,.json" hidden id="importFile">
          </div>
          <label class="row tiny muted" style="margin-top:10px;gap:6px"><input type="checkbox" id="mergeImport"> При импорте объединять с текущими данными, а не заменять</label>
        </div>
        <div class="card" id="installCard">
          <h3>Приложение на телефоне</h3>
          ${installBlock()}
        </div>
        <div class="card">
          <h3>Горячие клавиши</h3>
          <div class="small muted stack tight">
            <div><span class="kbd">g</span> затем <span class="kbd">t</span> — Сегодня, <span class="kbd">g</span> <span class="kbd">g</span> — Цели, <span class="kbd">g</span> <span class="kbd">h</span> — Привычки</div>
            <div><span class="kbd">g</span> <span class="kbd">l</span> — Обучение, <span class="kbd">g</span> <span class="kbd">n</span> — Питание, <span class="kbd">g</span> <span class="kbd">w</span> — Тренировки, <span class="kbd">g</span> <span class="kbd">s</span> — Сон</div>
            <div><span class="kbd">Esc</span> — закрыть окно</div>
          </div>
        </div>
        <div class="card">
          <h3 class="bad">Опасная зона</h3>
          <p class="muted small" style="margin-bottom:10px">Удалить все данные приложения без возможности восстановления.</p>
          <button class="btn danger" data-wipe>${icon('trash')} Стереть всё</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#sform').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    for (const k of Object.keys(d)) if (d[k] == null && typeof DEFAULT_SETTINGS[k] === 'number') d[k] = DEFAULT_SETTINGS[k];
    db.setSettings(d);
    toast('Настройки сохранены');
  });

  on(root, 'click', '[data-install]', async () => { await promptInstall(); });
  const offInstall = onInstallChange(() => {
    const c = root.querySelector('#installCard');
    if (c) c.innerHTML = `<h3>Приложение на телефоне</h3>${installBlock()}`;
  });

  on(root, 'click', '[data-export]', () => {
    const blob = new Blob([JSON.stringify(db.exportJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ultimate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    localStorage.setItem('lifeos_lastExport', String(Date.now()));
    toast('Файл резервной копии сохранён');
  });
  const fileInput = root.querySelector('#importFile');
  on(root, 'click', '[data-import]', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (obj._app !== 'lifeos') throw new Error('Это не файл ULTIMATE (LifeOS)');
      const merge = root.querySelector('#mergeImport').checked;
      if (!merge && !confirm('Заменить все текущие данные данными из файла?')) return;
      await db.importJSON(obj, { merge });
      toast('Данные импортированы');
    } catch (e) { alert('Не удалось импортировать: ' + e.message); }
  });
  on(root, 'click', '[data-wipe]', async () => {
    if (!confirm('Точно стереть ВСЕ данные? Сначала сделайте экспорт.')) return;
    if (prompt('Введите СТЕРЕТЬ для подтверждения') !== 'СТЕРЕТЬ') return;
    await db.clearAll();
    toast('Все данные удалены');
  });
  return () => offInstall();
}
