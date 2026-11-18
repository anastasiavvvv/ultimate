import { db } from '../db.js';
import { esc, icon, modal, field, formRow, toast, today, fmtDate, progressBar, emptyState, on, clamp, plural } from '../ui.js';

export const title = 'Книги и заметки';

// ---------- Справочники ----------
const BOOK_STATUS = { reading: 'Читаю', want: 'Хочу прочитать', done: 'Прочитано' };
const BOOK_STATUS_CLS = { reading: 'accent', want: '', done: 'good' };
const BOOK_STATUS_ORDER = { reading: 0, want: 1, done: 2 };
const PREVIEW_LEN = 200;

// ---------- Локальное состояние (переживает перерисовку) ----------
let tab = 'books';        // 'books' | 'notes'
let bookFilter = 'all';   // all | reading | want | done
let noteQuery = '';
let noteTag = null;

// ---------- Помощники ----------
const stars = (n) => { const r = clamp(Number(n) || 0, 0, 5); return '★'.repeat(r) + '☆'.repeat(5 - r); };
const parseTags = (s) => [...new Set(String(s || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean))];
const preview = (body) => {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > PREVIEW_LEN ? s.slice(0, PREVIEW_LEN).trimEnd() + '…' : s;
};
const areaLabel = (a) => a ? `${a.icon || '📚'} ${a.name}` : '';
const sortByUpdated = (arr) => [...arr].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

// ---------- Рендер ----------
export async function render(root, ctx = {}) {
  const rerender = () => {
    const y = window.scrollY;
    return render(root, ctx).then(() => window.scrollTo(0, y));
  };

  const t = today();
  const year = t.slice(0, 4);
  const books = db.all('books');
  const notes = db.all('notes');
  const areas = db.all('learningAreas');
  const areaById = Object.fromEntries(areas.map(a => [a.id, a]));
  const bookById = Object.fromEntries(books.map(b => [b.id, b]));
  const notesByBook = {};
  for (const n of notes) if (n.bookId) notesByBook[n.bookId] = (notesByBook[n.bookId] || 0) + 1;

  const areaOptions = [['', 'Без области'], ...areas.map(a => [a.id, areaLabel(a)])];
  const bookOptions = [['', 'Без книги'], ...[...books].sort((a, b) => (BOOK_STATUS_ORDER[a.status] ?? 9) - (BOOK_STATUS_ORDER[b.status] ?? 9) || String(a.title).localeCompare(String(b.title), 'ru'))
    .map(b => [b.id, `${b.title}${b.author ? ` — ${b.author}` : ''}`])];

  // ---------- Книги ----------
  const countReading = books.filter(b => b.status === 'reading').length;
  const countWant = books.filter(b => b.status === 'want').length;
  const countDoneYear = books.filter(b => b.status === 'done' && String(b.finishedAt || '').startsWith(year)).length;
  const pagesThisYear = books.filter(b => b.status === 'done' && String(b.finishedAt || '').startsWith(year)).reduce((s, b) => s + (Number(b.pages) || 0), 0);

  let visibleBooks = bookFilter === 'all' ? books : books.filter(b => b.status === bookFilter);
  visibleBooks = [...visibleBooks].sort((a, b) =>
    (BOOK_STATUS_ORDER[a.status] ?? 9) - (BOOK_STATUS_ORDER[b.status] ?? 9) ||
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  const chip = (key, label, count) => `<button type="button" class="chip ${bookFilter === key ? 'active' : ''}" data-action="book-filter" data-filter="${key}">${label}${count != null ? ` · ${count}` : ''}</button>`;

  const bookCard = (b) => {
    const a = areaById[b.areaId];
    const pages = Number(b.pages) || 0;
    const read = clamp(Number(b.pagesRead) || 0, 0, pages || Infinity);
    const pct = pages ? Math.round((read / pages) * 100) : 0;
    const nCount = notesByBook[b.id] || 0;
    const dates = b.status === 'done' && b.finishedAt ? `прочитано ${esc(fmtDate(b.finishedAt, { relative: false }))}`
      : b.status === 'reading' && b.startedAt ? `с ${esc(fmtDate(b.startedAt, { relative: false }))}` : '';
    return `<div class="card" data-action="edit-book" data-id="${esc(b.id)}" style="cursor:pointer;display:flex;flex-direction:column;gap:8px">
      <div class="row between top">
        <div style="min-width:0">
          <div class="bold" style="line-height:1.3">${esc(b.title)}</div>
          <div class="small muted">${esc(b.author || 'Автор не указан')}</div>
        </div>
        <span class="pill ${BOOK_STATUS_CLS[b.status] || ''}">${esc(BOOK_STATUS[b.status] || b.status)}</span>
      </div>
      ${b.status === 'done' && b.rating ? `<div class="warn" style="letter-spacing:2px">${stars(b.rating)}</div>` : ''}
      ${pages ? `
        <div>
          <div class="row between tiny muted" style="margin-bottom:4px"><span>${read} / ${pages} стр.</span><span>${pct}%</span></div>
          ${progressBar(read, pages, b.status === 'done' ? 'good thin' : 'thin')}
        </div>` : ''}
      <div class="row between wrap" style="gap:6px;margin-top:auto">
        <div class="row wrap tiny muted" style="gap:6px">
          ${a ? `<span class="tag">${esc(areaLabel(a))}</span>` : ''}
          ${nCount ? `<span class="tag">${nCount} ${plural(nCount, 'заметка', 'заметки', 'заметок')}</span>` : ''}
          ${dates ? `<span>${dates}</span>` : ''}
        </div>
        ${b.status !== 'done' && pages ? `<button type="button" class="btn sm secondary" data-action="add-pages" data-id="${esc(b.id)}">+ страницы</button>` : ''}
      </div>
    </div>`;
  };

  const booksHtml = `
    <div class="grid-3" style="margin-bottom:12px">
      <div class="stat"><div class="label">${icon('book')} Читаю</div><div class="value">${countReading}</div><div class="sub">${countReading ? 'в процессе' : 'начните новую книгу'}</div></div>
      <div class="stat"><div class="label">${icon('star')} Хочу прочитать</div><div class="value">${countWant}</div><div class="sub">в списке желаний</div></div>
      <div class="stat"><div class="label">${icon('check')} Прочитано за ${esc(year)}</div><div class="value good">${countDoneYear}</div><div class="sub">${pagesThisYear ? `${pagesThisYear} стр.` : 'пока ни одной'}</div></div>
    </div>
    <div class="chips" style="margin-bottom:12px">
      ${chip('all', 'Все', books.length)}${chip('reading', 'Читаю', countReading)}${chip('want', 'Хочу', countWant)}${chip('done', 'Прочитано', books.filter(b => b.status === 'done').length)}
    </div>
    ${visibleBooks.length
      ? `<div class="grid-auto" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${visibleBooks.map(bookCard).join('')}</div>`
      : `<div class="card">${emptyState(books.length ? 'Нет книг с таким статусом' : 'Добавьте первую книгу — что читаете сейчас?', '📖')}</div>`}`;

  // ---------- Заметки ----------
  const allTags = [...new Set(notes.flatMap(n => Array.isArray(n.tags) ? n.tags : []))].sort((a, b) => a.localeCompare(b, 'ru'));
  if (noteTag && !allTags.includes(noteTag)) noteTag = null;

  const notesListHtml = () => {
    const q = noteQuery.trim().toLowerCase();
    let list = notes;
    if (noteTag) list = list.filter(n => Array.isArray(n.tags) && n.tags.includes(noteTag));
    if (q) list = list.filter(n =>
      String(n.title || '').toLowerCase().includes(q) ||
      String(n.body || '').toLowerCase().includes(q) ||
      (Array.isArray(n.tags) && n.tags.some(tg => tg.toLowerCase().includes(q))));
    list = sortByUpdated(list).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    const tagChip = (tg) => `<button type="button" class="chip ${noteTag === tg ? 'active' : ''}" data-action="note-tag" data-tag="${esc(tg)}">#${esc(tg)}</button>`;
    const noteCard = (n) => {
      const b = n.bookId ? bookById[n.bookId] : null;
      const a = n.areaId ? areaById[n.areaId] : null;
      const text = preview(n.body);
      return `<div class="card" data-action="edit-note" data-id="${esc(n.id)}" style="cursor:pointer;display:flex;flex-direction:column;gap:8px;${n.pinned ? 'outline:1px solid var(--accent-soft);' : ''}">
        <div class="row between top">
          <div class="bold" style="line-height:1.3">${n.pinned ? '📌 ' : ''}${esc(n.title || 'Без названия')}</div>
          <span class="tiny faint" style="white-space:nowrap">${esc(fmtDate((n.updatedAt || n.createdAt || '').slice(0, 10)))}</span>
        </div>
        ${text ? `<div class="small muted" style="white-space:pre-wrap">${esc(text)}</div>` : ''}
        ${(Array.isArray(n.tags) && n.tags.length) || b || a ? `
          <div class="row wrap" style="gap:6px;margin-top:auto">
            ${(n.tags || []).map(tg => `<span class="tag">#${esc(tg)}</span>`).join('')}
            ${b ? `<span class="pill info">${icon('book')} ${esc(b.title)}</span>` : ''}
            ${a ? `<span class="pill">${esc(areaLabel(a))}</span>` : ''}
          </div>` : ''}
      </div>`;
    };

    return `
      ${allTags.length ? `<div class="chips" style="margin-bottom:12px">
        <button type="button" class="chip ${noteTag ? '' : 'active'}" data-action="note-tag" data-tag="">Все теги</button>
        ${allTags.map(tagChip).join('')}
      </div>` : ''}
      ${list.length
        ? `<div class="grid-auto" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${list.map(noteCard).join('')}</div>`
        : `<div class="card">${emptyState(notes.length ? 'Ничего не найдено' : 'Записывайте мысли, цитаты и выводы из книг', '📝')}</div>`}`;
  };

  const notesHtml = `
    <div class="card" style="margin-bottom:12px;padding:10px 12px">
      <div class="row">
        <span class="muted" style="display:grid;place-items:center">${icon('search')}</span>
        <input type="search" class="input" id="noteSearch" placeholder="Поиск по заголовку, тексту и тегам…" value="${esc(noteQuery)}" style="border:0;background:transparent;padding:6px 4px">
        <span class="tiny faint" style="white-space:nowrap">${notes.length} ${plural(notes.length, 'заметка', 'заметки', 'заметок')}</span>
      </div>
    </div>
    <div id="notesList">${notesListHtml()}</div>`;

  root.innerHTML = `<div class="books-page">
    <div class="page-head">
      <div><div class="eyebrow">Развитие</div><h1>Книги и заметки</h1></div>
      <div class="actions">
        <div class="seg">
          <button type="button" class="${tab === 'books' ? 'active' : ''}" data-action="tab" data-tab="books">Книги${books.length ? ` · ${books.length}` : ''}</button>
          <button type="button" class="${tab === 'notes' ? 'active' : ''}" data-action="tab" data-tab="notes">Заметки${notes.length ? ` · ${notes.length}` : ''}</button>
        </div>
        ${tab === 'books'
          ? `<button type="button" class="btn" data-action="add-book">${icon('plus')} Книга</button>`
          : `<button type="button" class="btn" data-action="add-note">${icon('plus')} Заметка</button>`}
      </div>
    </div>
    ${tab === 'books' ? booksHtml : notesHtml}
  </div>`;

  const page = root.firstElementChild;

  // ---------- Модалки ----------
  function openBookModal(b) {
    modal({
      title: b ? 'Книга' : 'Новая книга',
      wide: true,
      body: `
        ${formRow(
          field({ name: 'title', label: 'Название', value: b?.title ?? '', required: true }),
          field({ name: 'author', label: 'Автор', value: b?.author ?? '' }),
        )}
        ${formRow(
          field({ name: 'status', label: 'Статус', type: 'select', value: b?.status ?? 'want', options: Object.entries(BOOK_STATUS) }),
          field({ name: 'pages', label: 'Страниц всего', type: 'number', value: b?.pages ?? '', min: 0 }),
          field({ name: 'pagesRead', label: 'Прочитано страниц', type: 'number', value: b?.pagesRead ?? '', min: 0 }),
        )}
        ${formRow(
          field({ name: 'areaId', label: 'Область обучения', type: 'select', value: b?.areaId ?? '', options: areaOptions }),
          field({ name: 'startedAt', label: 'Начата', type: 'date', value: b?.startedAt ?? '' }),
          field({ name: 'finishedAt', label: 'Закончена', type: 'date', value: b?.finishedAt ?? '', hint: 'Заполнится сегодняшней датой при статусе «Прочитано»' }),
        )}
        ${field({ name: 'rating', label: 'Оценка', type: 'rating', value: b?.rating ?? '', labels: ['1', '2', '3', '4', '5'] })}
        ${field({ name: 'summary', label: 'Главные мысли', type: 'textarea', value: b?.summary ?? '', rows: 5, placeholder: 'О чём книга и что из неё взять' })}`,
      onSubmit: (d) => {
        const pages = d.pages != null ? Math.max(0, Math.round(d.pages)) : null;
        let pagesRead = d.pagesRead != null ? Math.max(0, Math.round(d.pagesRead)) : null;
        if (pages && pagesRead != null) pagesRead = Math.min(pagesRead, pages);
        let finishedAt = d.finishedAt || null;
        if (d.status === 'done' && !finishedAt) finishedAt = t;
        if (d.status === 'done' && pages) pagesRead = pages;
        const rec = {
          title: d.title, author: d.author || '', status: d.status, pages, pagesRead,
          rating: d.rating ?? null, areaId: d.areaId || null,
          startedAt: d.startedAt || null, finishedAt, summary: d.summary || '',
        };
        if (b) db.update('books', b.id, rec); else db.add('books', rec);
        toast(b ? 'Книга обновлена' : 'Книга добавлена');
      },
      onDelete: b ? () => { db.remove('books', b.id); toast('Книга удалена'); } : undefined,
    });
  }

  function openNoteModal(n, preset = {}) {
    modal({
      title: n ? 'Заметка' : 'Новая заметка',
      wide: true,
      body: `
        ${field({ name: 'title', label: 'Заголовок', value: n?.title ?? '', required: true })}
        ${field({ name: 'body', label: 'Текст', type: 'textarea', value: n?.body ?? '', rows: 10 })}
        ${field({ name: 'tags', label: 'Теги', value: (n?.tags || []).join(', '), placeholder: 'через запятую: идея, цитата, вывод' })}
        ${formRow(
          field({ name: 'bookId', label: 'Книга', type: 'select', value: n?.bookId ?? preset.bookId ?? '', options: bookOptions }),
          field({ name: 'areaId', label: 'Область', type: 'select', value: n?.areaId ?? preset.areaId ?? '', options: areaOptions }),
        )}
        ${field({ name: 'pinned', label: 'Закрепить сверху', type: 'checkbox', value: !!n?.pinned })}`,
      onSubmit: (d) => {
        const rec = { title: d.title, body: d.body || '', tags: parseTags(d.tags), bookId: d.bookId || null, areaId: d.areaId || null, pinned: !!d.pinned };
        if (n) db.update('notes', n.id, rec); else db.add('notes', rec);
        toast(n ? 'Заметка обновлена' : 'Заметка добавлена');
      },
      onDelete: n ? () => { db.remove('notes', n.id); toast('Заметка удалена'); } : undefined,
    });
  }

  // ---------- События ----------
  on(page, 'click', '[data-action]', (e, btn) => {
    const act = btn.dataset.action, id = btn.dataset.id;
    switch (act) {
      case 'tab': tab = btn.dataset.tab === 'notes' ? 'notes' : 'books'; rerender(); break;
      case 'book-filter': bookFilter = btn.dataset.filter || 'all'; rerender(); break;
      case 'add-book': openBookModal(null); break;
      case 'edit-book': openBookModal(bookById[id]); break;
      case 'add-pages': {
        const b = bookById[id]; if (!b) break;
        const pages = Number(b.pages) || 0;
        const read = Number(b.pagesRead) || 0;
        const raw = prompt(`Сколько страниц прочитали? (сейчас ${read}${pages ? ` из ${pages}` : ''})`, '20');
        if (raw == null) break;
        const n = Math.round(Number(String(raw).replace(',', '.')));
        if (!n || n <= 0) { toast('Введите число страниц'); break; }
        let next = read + n;
        const patch = {};
        if (pages && next >= pages) { next = pages; patch.status = 'done'; if (!b.finishedAt) patch.finishedAt = t; }
        else if (b.status === 'want') { patch.status = 'reading'; if (!b.startedAt) patch.startedAt = t; }
        patch.pagesRead = next;
        db.update('books', id, patch);
        toast(patch.status === 'done' ? 'Книга дочитана!' : `+${n} стр.`);
        break;
      }
      case 'add-note': openNoteModal(null); break;
      case 'edit-note': openNoteModal(db.get('notes', id)); break;
      case 'note-tag': {
        const tg = btn.dataset.tag || '';
        noteTag = tg && noteTag !== tg ? tg : null;
        const list = root.querySelector('#notesList');
        if (list) list.innerHTML = notesListHtml();
        break;
      }
    }
  });

  // Поиск по заметкам: фильтрация локальная, перерисовываем только список.
  const search = root.querySelector('#noteSearch');
  if (search) {
    search.addEventListener('input', () => {
      noteQuery = search.value;
      const list = root.querySelector('#notesList');
      if (list) list.innerHTML = notesListHtml();
    });
  }
}
