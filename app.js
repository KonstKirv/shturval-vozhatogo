/* Активности — offline PWA (iPhone / браузер) */
(function () {
  'use strict';

  const CAT_LABEL = {
    PHYSICAL: '🏃 Физические',
    VERBAL: '💬 Вербальные',
    CREATIVE: '🎨 Творческие',
    CHALLENGE: '🧩 Челленджи'
  };
  const GOAL_RU = {
    BONDING: 'Сплочение', EMPATHY: 'Эмпатия', LISTENING: 'Слушание',
    ENERGY_RELEASE: 'Сброс энергии', CALM_DOWN: 'Заземление', INCLUSION: 'Включить тихого',
    LEADERSHIP: 'Лидерство', AFTER_CONFLICT: 'После напряжения', ICEBREAK: 'Знакомство', FOCUS: 'Фокус'
  };
  const PRESETS = [
    { id: 'canteen', title: '🍽️ Столовая', filter: (a) => a.durationMin <= 12 && a.propsLevel !== 'COMPLEX' },
    { id: 'rain', title: '🌧️ Дождь', filter: (a) => a.places.some((p) => p === 'HALL' || p === 'SMALL_ROOM') && a.energy !== 'HIGH' },
    { id: 'outdoor', title: '☀️ Улица', filter: (a) => a.places.includes('OUTDOOR') },
    { id: 'bus', title: '🚌 Автобус', filter: (a) => a.places.includes('BUS') },
    { id: 'evening', title: '🌙 Вечер', filter: (a) => a.energy === 'CALM' && (a.category === 'VERBAL' || a.category === 'CREATIVE') },
    { id: 'day1', title: '👋 День 1', filter: (a) => (a.goals || []).includes('ICEBREAK') || a.durationMin <= 14 }
  ];

  let ALL = [];
  let state = {
    tab: 'home',
    query: '',
    cat: null,
    preset: null,
    detail: null,
    swipeDir: 0,
    fav: loadSet('fav'),
    hist: loadJson('hist', []),
    plans: loadJson('plans', [])
  };

  function loadSet(k) {
    try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); }
  }
  function saveSet(k, s) { localStorage.setItem(k, JSON.stringify([...s])); }
  function loadJson(k, d) {
    try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; }
  }
  function saveJson(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  /** URL ассета относительно каталога страницы (чинит GitHub Pages без trailing slash) */
  function assetUrl(path) {
    path = String(path || '').replace(/^\.\//, '');
    try {
      var dir = location.pathname || '/';
      if (!dir.endsWith('/')) {
        // /repo  → /repo/   |  /repo/index.html → /repo/
        dir = /\.[a-zA-Z0-9]+$/.test(dir) ? dir.replace(/\/[^/]*$/, '/') : (dir + '/');
      }
      return location.origin + dir + path;
    } catch (_) {
      return path;
    }
  }

  async function init() {
    const url = assetUrl('data/activities.json');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Не удалось загрузить каталог (' + res.status + ')');
    ALL = await res.json();
    if (!Array.isArray(ALL) || !ALL.length) throw new Error('Каталог активностей пуст');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(assetUrl('sw.js')).catch(() => {});
    }
    // iOS install tip
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true;
    if (isIos && !standalone) {
      var banner = document.getElementById('installBanner');
      if (banner) banner.classList.remove('hidden');
    }
    bind();
    render();
  }

  function bind() {
    document.getElementById('search').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      renderHome();
    });
    document.querySelectorAll('.nav button').forEach((b) => {
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        state.detail = null;
        document.querySelectorAll('.nav button').forEach((x) => x.classList.toggle('on', x === b));
        render();
      });
    });
    document.getElementById('detailBack').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDetail();
    });
    var prevBtn = document.getElementById('detailPrev');
    var nextBtn = document.getElementById('detailNext');
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.preventDefault(); goAdjacent(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.preventDefault(); goAdjacent(1); });
    document.getElementById('planDays').oninput = (e) => {
      document.getElementById('daysVal').textContent = e.target.value;
    };
    document.getElementById('planPerDay').oninput = (e) => {
      document.getElementById('perDayVal').textContent = e.target.value;
    };
    document.getElementById('genPlan').onclick = generatePlan;
    document.getElementById('cExit').onclick = closeCounselor;
    document.getElementById('cNext').onclick = () => counselorNav(1);
    document.getElementById('cPrev').onclick = () => counselorNav(-1);
    document.getElementById('cTimerBtn').onclick = toggleTimer;

    // Делегирование кликов — надёжнее на iOS, чем onclick на каждой карточке
    document.body.addEventListener('click', onDelegatedClick, false);
    setupDetailSwipe();
  }

  /** Список, в котором сейчас «листаем» детали (каталог / избранное / результат фильтра) */
  function browseList() {
    if (state.tab === 'fav') {
      return ALL.filter(function (a) { return state.fav.has(Number(a.number)); });
    }
    return filtered();
  }

  function goAdjacent(dir) {
    if (!state.detail) return;
    var list = browseList();
    if (!list.length) list = ALL;
    var cur = Number(state.detail.number);
    var idx = list.findIndex(function (a) { return Number(a.number) === cur; });
    if (idx < 0) idx = 0;
    var next = idx + dir;
    if (next < 0 || next >= list.length) return;
    animateThenOpen(list[next].number, dir);
  }

  function resetDetailAnim(body) {
    if (!body) body = document.getElementById('detailBody');
    if (!body) return;
    body.classList.remove('swipe-in-left', 'swipe-in-right', 'swipe-out-left', 'swipe-out-right');
    body.style.transform = '';
    body.style.opacity = '';
  }

  function animateThenOpen(number, dir) {
    var body = document.getElementById('detailBody');
    if (!body) {
      openDetail(number);
      return;
    }
    state.swipeDir = dir;
    resetDetailAnim(body);
    void body.offsetWidth;
    body.classList.add(dir > 0 ? 'swipe-out-left' : 'swipe-out-right');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      body.removeEventListener('animationend', finish);
      openDetail(number);
      requestAnimationFrame(function () {
        resetDetailAnim(body);
        void body.offsetWidth;
        body.classList.add(dir > 0 ? 'swipe-in-right' : 'swipe-in-left');
        body.addEventListener('animationend', function cleanup() {
          body.removeEventListener('animationend', cleanup);
          resetDetailAnim(body);
        });
        setTimeout(function () { resetDetailAnim(body); }, 320);
      });
    }
    body.addEventListener('animationend', finish);
    setTimeout(finish, 280);
  }

  function setupDetailSwipe() {
    var el = document.getElementById('detailScroll') || document.getElementById('screen-detail');
    if (!el || el.dataset.swipeBound) return;
    el.dataset.swipeBound = '1';
    var startX = 0, startY = 0, tracking = false;
    el.addEventListener('touchstart', function (e) {
      if (!state.detail || !e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (!tracking || !state.detail) return;
      tracking = false;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      // горизонтальный свайп сильнее вертикального
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (dx < 0) goAdjacent(1);   // влево → следующая
      else goAdjacent(-1);         // вправо → предыдущая
    }, { passive: true });
  }

  function onDelegatedClick(e) {
    // клик по избранному
    const favBtn = e.target.closest && e.target.closest('[data-fav]');
    if (favBtn) {
      e.preventDefault();
      e.stopPropagation();
      const n = Number(favBtn.getAttribute('data-fav'));
      if (state.fav.has(n)) state.fav.delete(n); else state.fav.add(n);
      saveSet('fav', state.fav);
      favBtn.textContent = state.fav.has(n) ? '★' : '☆';
      if (state.tab === 'fav' && !state.detail) renderFav();
      return;
    }

    // открытие карточки (каталог / избранное / история / план)
    const card = e.target.closest && e.target.closest('[data-open-activity]');
    if (card) {
      e.preventDefault();
      e.stopPropagation();
      const n = Number(card.getAttribute('data-open-activity'));
      if (!Number.isFinite(n)) return;
      try {
        openDetail(n);
      } catch (err) {
        console.error(err);
        alert('Ошибка открытия: ' + (err && err.message ? err.message : err));
      }
      return;
    }

  }

  function showTab(tab) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
    const map = {
      home: 'screen-home',
      plan: 'screen-plan',
      fav: 'screen-fav',
      hist: 'screen-hist',
      detail: 'screen-detail'
    };
    const id = map[tab] || 'screen-home';
    const el = document.getElementById(id);
    if (el) el.classList.add('on');
    // прокрутка вверх при смене экрана
    try { window.scrollTo(0, 0); } catch (_) {}
  }

  function closeDetail() {
    state.detail = null;
    render();
  }

  function findActivity(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    return ALL.find((a) => Number(a.number) === num || Number(a.id) === num) || null;
  }

  function filtered() {
    return ALL.filter((a) => {
      if (state.cat && a.category !== state.cat) return false;
      if (state.preset) {
        const p = PRESETS.find((x) => x.id === state.preset);
        if (p && !p.filter(a)) return false;
      }
      if (state.query) {
        const blob = (a.title + ' ' + a.rules + ' ' + (a.goals || []).join(' ')).toLowerCase();
        if (!blob.includes(state.query) && String(a.number) !== state.query) return false;
      }
      return true;
    });
  }

  function render() {
    if (state.detail) {
      showTab('detail');
      renderDetail();
      return;
    }
    showTab(state.tab);
    if (state.tab === 'home') renderHome();
    if (state.tab === 'fav') renderFav();
    if (state.tab === 'hist') renderHist();
    if (state.tab === 'plan') renderPlanForm();
  }

  function renderHome() {
    const presets = document.getElementById('presetChips');
    presets.innerHTML = PRESETS.map((p) =>
      `<button class="chip orange ${state.preset === p.id ? 'on' : ''}" data-p="${p.id}">${p.title}</button>`
    ).join('');
    presets.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.preset = state.preset === b.dataset.p ? null : b.dataset.p;
        renderHome();
      };
    });

    const cats = document.getElementById('catChips');
    const catKeys = ['PHYSICAL', 'VERBAL', 'CREATIVE', 'CHALLENGE'];
    cats.innerHTML = `<button class="chip ${!state.cat ? 'on' : ''}" data-c="">Все</button>` +
      catKeys.map((c) =>
        `<button class="chip ${state.cat === c ? 'on' : ''}" data-c="${c}">${CAT_LABEL[c]}</button>`
      ).join('');
    cats.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.cat = b.dataset.c || null;
        renderHome();
      };
    });

    const list = filtered();
    var countEl = document.getElementById('listCount');
    if (countEl) countEl.textContent = 'Найдено: ' + list.length;
    var hdr = document.getElementById('listCountHeader');
    if (hdr) hdr.textContent = list.length + ' игр · offline';
    document.getElementById('homeList').innerHTML = list.map(cardHtml).join('');
  }

  function cardHtml(a) {
    const n = Number(a.number);
    const fav = state.fav.has(n) ? '★' : '☆';
    const goals = (a.goals || []).slice(0, 2).map((g) => GOAL_RU[g] || g).join(' · ');
    return `<article class="card" data-open-activity="${n}" role="button" tabindex="0">
      <button type="button" class="fav" data-fav="${n}" aria-label="Избранное">${fav}</button>
      <div class="badge">${CAT_LABEL[a.category] || a.category}</div>
      <h3>${n}. ${esc(a.title)}</h3>
      <div class="meta">≈ ${a.durationMin} мин · ${esc(energyRu(a.energy))} · ${esc(propsRu(a.propsLevel))}</div>
      ${goals ? `<div class="goals">${esc(goals)}</div>` : ''}
    </article>`;
  }

  function energyRu(e) {
    return ({ CALM: 'тихо', MEDIUM: 'средне', HIGH: 'динамично' })[e] || e || '';
  }
  function propsRu(p) {
    return ({ ZERO: 'без реквизита', MINIMAL: 'минимум', COMPLEX: 'реквизит' })[p] || p || '';
  }

  function openDetail(n) {
    resetDetailAnim();
    const a = findActivity(n);
    if (!a) {
      console.error('Activity not found', n, 'ALL length', ALL.length);
      alert('Не удалось открыть игру №' + n + '. Обновите страницу (потяните вниз).');
      return;
    }
    state.detail = a;
    // Явно показываем detail до render (на случай гонок)
    showTab('detail');
    renderDetail();
    // синхронизируем остальное
    render();
    setTimeout(function () {
      resetDetailAnim();
      var sc = document.getElementById('detailScroll');
      if (sc) sc.scrollTop = 0;
      var body = document.getElementById('detailBody');
      if (body && (!body.innerHTML || body.innerHTML.length < 20)) {
        // повторная попытка, если тело осталось пустым
        renderDetail();
      }
    }, 0);
  }

  function updateDetailNavButtons() {
    var list = browseList();
    if (!list.length) list = ALL;
    var cur = state.detail ? Number(state.detail.number) : -1;
    var idx = list.findIndex(function (a) { return Number(a.number) === cur; });
    var prev = document.getElementById('detailPrev');
    var next = document.getElementById('detailNext');
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx < 0 || idx >= list.length - 1;
  }

  function ruleSteps(rulesText) {
    return String(rulesText || '')
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** Полное понятное описание активности (без «ребята») */
  function kidsRulesText(a, rulesText) {
    if (a && a.rulesForKids && String(a.rulesForKids).trim()) {
      return String(a.rulesForKids).trim().replace(/\s*ребята,?\s*/gi, ' ').replace(/  +/g, ' ').trim();
    }
    var steps = ruleSteps(rulesText);
    var body = steps.length
      ? steps.map(function (s, i) { return (i + 1) + ') ' + s.replace(/^\d+\)\s*/, ''); }).join('\n')
      : String(rulesText || '');
    return 'Что это. Игра «' + (a && a.title ? a.title : '…') + '».\n\n' +
      'Что делать по шагам.\n' + body +
      '\n\nВажно. Участие добровольное: «пас» — норма. Без насмешек. Если непонятно — остановитесь и уточните.';
  }

  function stepsHtml(a, rulesText) {
    var steps = ruleSteps(rulesText);
    var tips = [
      'Покажите сами / дайте 10 сек на вопросы',
      'Следите, чтобы все включились; тихих не вытаскивать силой',
      a.energy === 'HIGH'
        ? 'Контролируйте безопасность и громкость'
        : 'Держите темп спокойным, без гонки',
      'Зафиксируйте короткий итог перед рефлексией'
    ];
    return steps.map(function (step, i) {
      var tip = tips[i % tips.length];
      var clean = step.replace(/^\d+\)\s*/, '');
      return '<div class="rule-step">' +
        '<div class="rule-step-n">' + (i + 1) + '</div>' +
        '<div class="rule-step-body">' +
          '<div>' + esc(clean) + '</div>' +
          '<div class="rule-step-tip">💡 ' + esc(tip) + '</div>' +
        '</div></div>';
    }).join('');
  }

  function safetyList(a) {
    var safety = [
      'Участие добровольное: «пас» — норма, без объяснений',
      'Без насмешек и «штрафов-унижений»',
      'Стоп-слово / жест: сразу останавливаем'
    ];
    if (a.category === 'PHYSICAL') {
      safety.push('Ровный пол, без резких падений и подъёма на руки');
    }
    return safety;
  }

  function renderDetail() {
    const a = state.detail;
    const body = document.getElementById('detailBody');
    if (!body) {
      console.error('detailBody missing');
      return;
    }
    resetDetailAnim(body);
    if (!a) {
      body.innerHTML = '<p class="empty">Игра не найдена</p>';
      return;
    }
    try {
      const goals = (a.goals || []).map((g) => GOAL_RU[g] || g).join(' · ');
      const places = Array.isArray(a.places) ? a.places.join(', ') : String(a.places || '');
      const rulesText = (a.rules && String(a.rules).trim())
        ? String(a.rules).trim()
        : 'Описание правил не загрузилось. Обновите страницу.';
      const kidsText = kidsRulesText(a, rulesText);
      const safety = safetyList(a);
      const adapt = [
        'Упростить: меньше правил, короче время',
        'Без касаний / только голос',
        'Микрогруппы 3–4 вместо всего отряда'
      ];
      const refl = [
        'Что происходило? (факты)',
        (a.reflection && String(a.reflection).trim()) || 'Что вы почувствовали?',
        'Что возьмём в жизнь отряда завтра?'
      ];
      // Полное описание сверху — главное, чтобы было понятно
      body.innerHTML =
        '<div class="badge">' + esc(CAT_LABEL[a.category] || a.category || '') + '</div>' +
        '<h2 style="font-size:1.25rem;line-height:1.25;margin:6px 0 4px">' +
          Number(a.number) + '. ' + esc(a.title) + '</h2>' +
        '<p class="meta-line">≈ ' + esc(String(a.durationMin)) + ' мин · ' +
          esc(energyRu(a.energy)) +
          (places ? ' · ' + esc(places) : '') +
          ' · ' + esc(propsRu(a.propsLevel)) + '</p>' +

        '<div class="sec-main">Что делать — полное описание</div>' +
        '<div class="kids-box">' + esc(kidsText) + '</div>' +

        '<button type="button" class="big-btn" id="startCounselor">▶ Режим ведущего</button>' +

        '<div class="sec">Реквизит</div><pre>' + esc(a.propsText || '—') + '</pre>' +
        (goals ? '<div class="sec">Цели</div><pre>' + esc(goals) + '</pre>' : '') +

        '<div class="sec">Краткие шаги для ведущего</div>' +
        '<div class="rules-box rules-box-open">' +
          stepsHtml(a, rulesText) +
        '</div>' +

        '<div class="sec">Психологический смысл</div><pre>' +
          esc(a.psychology || 'Смотрите на участие всех, а не на «победителей».') + '</pre>' +

        '<div class="sec">Рамка безопасности</div>' +
        '<ul class="rules-detail-list">' +
          safety.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ul>' +

        '<div class="sec">Если не идёт</div>' +
        '<ul class="rules-detail-list">' +
          adapt.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ul>' +

        '<div class="sec">💬 Рефлексия (3 уровня)</div>' +
        '<ol class="rules-detail-list rules-detail-ol">' +
          refl.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ol>';

      const btn = document.getElementById('startCounselor');
      if (btn) btn.onclick = function () { openCounselor(a); };
      updateDetailNavButtons();
      var screen = document.getElementById('screen-detail');
      if (screen && !screen.classList.contains('on')) screen.classList.add('on');
    } catch (err) {
      console.error(err);
      body.innerHTML = '<p class="empty">Ошибка отображения: ' + esc(String(err && err.message || err)) + '</p>';
    }
  }

  function renderFav() {
    const list = ALL.filter((a) => state.fav.has(Number(a.number)));
    document.getElementById('favList').innerHTML = list.length
      ? list.map(cardHtml).join('')
      : '<div class="empty">Пока пусто — жмите ☆ на карточках</div>';
  }

  function renderHist() {
    const h = state.hist;
    document.getElementById('histList').innerHTML = h.length
      ? h.map((x) => '<div class="card" data-open-activity="' + Number(x.number) + '" role="button" tabindex="0">' +
          '<h3>' + esc(x.emoji || '✓') + ' ' + Number(x.number) + '. ' + esc(x.title) + '</h3>' +
          '<div class="meta">' + esc(x.rating) + ' · ' + new Date(x.at).toLocaleString('ru') + '</div>' +
          '<div class="open-hint">Открыть →</div></div>').join('')
      : '<div class="empty">Завершите игру в режиме ведущего</div>';
  }

  function renderPlanForm() {
    const wrap = document.getElementById('planCats');
    if (!wrap.dataset.ready) {
      wrap.innerHTML = Object.keys(CAT_LABEL).map((c) =>
        `<button type="button" class="chip on" data-pc="${c}">${CAT_LABEL[c]}</button>`
      ).join('');
      wrap.querySelectorAll('button').forEach((b) => {
        b.onclick = () => b.classList.toggle('on');
      });
      wrap.dataset.ready = '1';
    }
    // show saved last plan
    if (state.plans[0] && !document.getElementById('planResult').dataset.live) {
      document.getElementById('planResult').innerHTML = renderPlanHtml(state.plans[0]);
      bindPlanSlots();
    }
  }

  /* ─── Multi-day generator (place-aware) ─── */
  function venueMode(a) {
    const places = Array.isArray(a.places) ? a.places : [];
    const outdoor = places.includes('OUTDOOR');
    const indoor = places.includes('HALL') || places.includes('SMALL_ROOM');
    const bus = places.includes('BUS');
    if (bus && !outdoor && !indoor) return 'BUS';
    if (outdoor && !indoor) return 'OUTDOOR';
    if (indoor && !outdoor) return 'INDOOR';
    if (a.category === 'CREATIVE') return 'INDOOR';
    if (a.category === 'PHYSICAL' && a.energy === 'HIGH' && outdoor) return 'OUTDOOR';
    if (a.category === 'PHYSICAL' && outdoor) return 'OUTDOOR';
    if (indoor) return 'INDOOR';
    if (outdoor) return 'OUTDOOR';
    return 'INDOOR';
  }
  function fitsVenue(mode, a) {
    const places = Array.isArray(a.places) ? a.places : [];
    if (mode === 'OUTDOOR') return places.includes('OUTDOOR');
    if (mode === 'INDOOR') return places.includes('HALL') || places.includes('SMALL_ROOM');
    if (mode === 'BUS') return places.includes('BUS');
    return true;
  }

  function generatePlan() {
    const days = +document.getElementById('planDays').value;
    const perDay = +document.getElementById('planPerDay').value;
    const title = document.getElementById('planTitle').value || `Смена · ${days} дн.`;
    const cats = [...document.querySelectorAll('#planCats .chip.on')].map((b) => b.dataset.pc);
    let pool = ALL.filter((a) => cats.includes(a.category));
    if (pool.length < days * perDay) pool = ALL.slice();
    pool = shuffle(pool);

    const used = new Set();
    const planDays = [];
    for (let d = 1; d <= days; d++) {
      const phase = d <= 2 ? 'Оргпериод / знакомство' : d / days >= 0.75 ? 'Финал / смысл' : 'Основная часть';
      const roles = perDay === 2 ? ['Разогрев', 'Заземление']
        : perDay === 3 ? ['Разогрев', 'Ядро', 'Заземление']
        : ['Разогрев', 'Ядро', 'Ядро', 'Заземление'].slice(0, perDay);
      let venue = null;
      const slots = [];
      let lastCat = null;
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        let cands = pool.filter((a) => !used.has(a.number));
        if (venue) {
          const fit = cands.filter((a) => fitsVenue(venue, a));
          if (fit.length) cands = fit;
        }
        // score
        cands = cands.map((a) => {
          let s = Math.random();
          if (d <= 2 && (a.goals || []).includes('ICEBREAK')) s += 5;
          if (phase.startsWith('Финал') && ((a.goals || []).includes('CALM_DOWN') || a.number === 100)) s += 5;
          if (role === 'Разогрев' && a.durationMin <= 14) s += 3;
          if (role === 'Заземление' && a.energy === 'CALM') s += 4;
          if (role === 'Ядро' && (a.category === 'CHALLENGE' || a.category === 'CREATIVE')) s += 2;
          if (lastCat && a.category === lastCat) s -= 8;
          if (venue && fitsVenue(venue, a)) s += 10;
          if (venue && !fitsVenue(venue, a)) s -= 30;
          return { a, s };
        }).sort((x, y) => y.s - x.s);
        const pick = cands[0]?.a;
        if (!pick) break;
        used.add(pick.number);
        if (!venue) venue = venueMode(pick);
        lastCat = pick.category;
        slots.push({
          role,
          number: pick.number,
          title: pick.title,
          category: pick.category,
          durationMin: pick.durationMin,
          reason: `День ${d} · ${role} · место: ${venueLabel(venue)}`
        });
      }
      planDays.push({
        day: d,
        phase,
        venue: venueLabel(venue),
        tip: venueTip(phase, venue),
        slots,
        minutes: slots.reduce((s, x) => s + x.durationMin, 0)
      });
    }
    const plan = { title, days, perDay, daysData: planDays, at: Date.now() };
    state.plans = [plan, ...state.plans].slice(0, 10);
    saveJson('plans', state.plans);
    const box = document.getElementById('planResult');
    box.dataset.live = '1';
    box.innerHTML = renderPlanHtml(plan);
    bindPlanSlots();
  }

  function venueLabel(v) {
    return ({ OUTDOOR: 'улица', INDOOR: 'корпус/комната', BUS: 'автобус' })[v] || '—';
  }
  function venueTip(phase, venue) {
    return `${phase}. Место дня: ${venueLabel(venue)} — активности согласованы, без «рисование → беготня на улице».`;
  }

  function renderPlanHtml(plan) {
    return `<div class="tip"><b>${esc(plan.title)}</b> · ${plan.days} дн. · ${plan.perDay} игр/день</div>` +
      plan.daysData.map((d) => `
        <div class="day-block">
          <h3>День ${d.day} · ${esc(d.phase)}</h3>
          <div class="meta">${esc(d.tip)} · ≈ ${d.minutes} мин</div>
          ${d.slots.map((s) => `
            <div class="slot" data-open-activity="${s.number}" role="button" tabindex="0">
              <div class="role">${esc(s.role)}</div>
              <b>${s.number}. ${esc(s.title)}</b>
              <div class="meta">${s.durationMin} мин · ${CAT_LABEL[s.category] || ''} · ${esc(s.reason)}</div>
              <div class="open-hint">Открыть →</div>
            </div>`).join('')}
        </div>`).join('');
  }
  function bindPlanSlots() {
    // клики через делегирование data-open-activity
  }

  /* ─── Counselor mode ─── */
  let cState = null;
  let timerId = null;
  let timerSec = 0;
  let timerRun = false;

  function leaderSteps(a) {
    const lines = String(a.rules || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const steps = [
      `Скажи: «Сейчас попробуем «${a.title}». Можно сказать „пас“ — это ок.»`,
      // маркер EXPLAIN — в UI покажем полный текст «как объяснить детям»
      'EXPLAIN'
    ];
    lines.forEach((l, i) => steps.push(`Шаг ${i + 1}: ${l.replace(/^\d+[).]\s*/, '')}`));
    steps.push('Стоп-сигнал. Поблагодари группу без «кто лучше».');
    steps.push('Рефлексия: Что происходило?');
    steps.push(a.reflection || 'Что почувствовали?');
    steps.push('Что возьмём в жизнь отряда завтра?');
    steps.push('RATE');
    return steps;
  }

  function openCounselor(a) {
    cState = { a, steps: leaderSteps(a), i: 0 };
    timerSec = 0; timerRun = false;
    document.getElementById('counselor').classList.add('on');
    document.getElementById('cTitle').textContent = a.title;
    renderCounselor();
  }
  function closeCounselor() {
    document.getElementById('counselor').classList.remove('on');
    stopTimer();
    cState = null;
  }
  function renderCounselor() {
    if (!cState) return;
    const { steps, i, a } = cState;
    const step = steps[i];
    document.getElementById('cPhase').textContent = `Шаг ${i + 1} / ${steps.length}`;
    const body = document.getElementById('cBody');
    if (step === 'RATE') {
      body.className = 'step-text';
      body.innerHTML = `<p>Как прошло?</p>
        <button class="big-btn" data-r="GOOD">🔥 Зашло</button>
        <button class="big-btn" data-r="OK" style="background:var(--orange)">😐 Средне</button>
        <button class="big-btn" data-r="MISS" style="background:#555">👎 Мимо</button>`;
      body.querySelectorAll('[data-r]').forEach((b) => {
        b.onclick = () => {
          const emoji = { GOOD: '🔥', OK: '😐', MISS: '👎' }[b.dataset.r];
          state.hist.unshift({
            number: a.number, title: a.title, rating: b.dataset.r, emoji, at: Date.now()
          });
          state.hist = state.hist.slice(0, 100);
          saveJson('hist', state.hist);
          closeCounselor();
          render();
        };
      });
    } else if (step === 'EXPLAIN' || /объясни правила/i.test(String(step))) {
      body.className = 'step-text c-explain';
      var kids = kidsRulesText(a, a.rules);
      body.innerHTML =
        '<div class="c-explain-head">Покажи / объясни правила (1–2 мин)</div>' +
        '<div class="c-explain-label">📢 Полное описание — можно читать вслух</div>' +
        '<div class="c-explain-kids">' + esc(kids) + '</div>';
    } else if (i >= steps.length - 4 && i < steps.length - 1) {
      body.className = 'reflect';
      body.textContent = step;
    } else {
      body.className = 'step-text';
      body.textContent = step;
    }
    document.getElementById('cPrev').disabled = i === 0;
  }
  function counselorNav(d) {
    if (!cState) return;
    cState.i = Math.max(0, Math.min(cState.steps.length - 1, cState.i + d));
    renderCounselor();
  }
  function toggleTimer() {
    if (timerRun) stopTimer();
    else {
      timerRun = true;
      document.getElementById('cTimerBtn').textContent = '⏸';
      timerId = setInterval(() => {
        timerSec++;
        const mm = String(Math.floor(timerSec / 60)).padStart(2, '0');
        const ss = String(timerSec % 60).padStart(2, '0');
        document.getElementById('cTimer').textContent = `${mm}:${ss}`;
      }, 1000);
    }
  }
  function stopTimer() {
    timerRun = false;
    clearInterval(timerId);
    const btn = document.getElementById('cTimerBtn');
    if (btn) btn.textContent = '▶';
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  init().catch((e) => {
    document.body.innerHTML = `<div class="empty">Ошибка загрузки: ${esc(e.message)}</div>`;
  });
})();
