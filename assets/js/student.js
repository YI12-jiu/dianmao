/* 学生端：只看自己的考勤 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STATUS_TEXT = { present: '到场', late: '迟到', absent: '缺勤', leave: '请假' };
  var WEEK = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var S = { user: null, cls: null, courses: [], rows: [], today: '', slot: '', month: 'all' };

  function initial(n) { return (n || '?').slice(0, 1); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function dateCN(str) {
    var d = new Date(str + 'T00:00:00');
    if (isNaN(d)) return str;
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + UI.weekdayCN(str);
  }
  function hhmm(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function switchPage(page) {
    ['home', 'records', 'timetable'].forEach(function (p) { $('page-' + p).hidden = p !== page; });
    document.querySelectorAll('.nav__btn, .tabbar button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.page === page);
    });
    window.scrollTo({ top: 0 });
  }

  function loadRows() {
    return Store.attendanceOf(S.cls.code).then(function (rows) {
      S.rows = rows.filter(function (r) { return r.studentId === S.user.no; })
        .sort(function (a, b) { return (a.date + a.slot) < (b.date + b.slot) ? 1 : -1; });
    });
  }

  function summarize(rows) {
    var p = 0, a = 0, l = 0, lv = 0;
    rows.forEach(function (r) {
      if (r.status === 'present') p++;
      else if (r.status === 'late') { p++; l++; }
      else if (r.status === 'absent') a++;
      else lv++;
    });
    return { p: p, a: a, l: l, lv: lv, total: rows.length, rate: pct(p, rows.length) };
  }

  function streak(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].status === 'present' || rows[i].status === 'late') n++;
      else break;
    }
    return n;
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var sum = summarize(S.rows);
    $('ring').style.setProperty('--p', sum.rate);
    $('ringVal').textContent = sum.total ? sum.rate + '%' : '—';
    $('chipStreak').innerHTML = '<span class="chip__dot"></span>连续到场 ' + streak(S.rows) + ' 次';
    $('chipAbsent').textContent = '缺勤 ' + sum.a + ' 次';
    $('chipAbsent').className = 'chip' + (sum.a ? ' chip--bad' : '');

    var wd = UI.weekdayNum(S.today);
    var todayCourses = S.courses.filter(function (c) { return c.weekday === wd; });
    var box = $('todayCourses');
    box.innerHTML = todayCourses.length ? todayCourses.map(function (c) {
      return '<div class="course"><div class="course__slot"><b>' + c.slot.replace('第 ', '').replace(' 节', '') + '</b>节</div>' +
        '<div><b>' + esc(c.name) + '</b><span>' + esc(c.room || '') + '</span></div>' +
        '<span class="chip chip--gold">' + esc(S.cls.subject || '课程') + '</span></div>';
    }).join('') : '<div class="empty"><b>今天没有排课</b><span>休息一下，或者看看本周课表</span></div>';

    /* 节次选项：优先今天的课 */
    var slots = todayCourses.length ? todayCourses.map(function (c) { return c.slot; }) : ['第 1 节', '第 2 节', '第 3 节'];
    if (slots.indexOf(S.slot) < 0) S.slot = slots[0];
    $('checkSlot').innerHTML = slots.map(function (s) {
      return '<option value="' + s + '"' + (s === S.slot ? ' selected' : '') + '>' + s + '</option>';
    }).join('');

    paintCheckState();
  }

  function findTodayRecord(slot) {
    return S.rows.filter(function (r) { return r.date === S.today && r.slot === slot; })[0];
  }

  function paintCheckState() {
    var rec = findTodayRecord(S.slot);
    var chip = $('checkState');
    var btn = $('checkBtn');
    if (rec) {
      chip.className = 'chip ' + (rec.status === 'present' ? 'chip--ok' : rec.status === 'absent' ? 'chip--bad' : 'chip--warn');
      chip.textContent = STATUS_TEXT[rec.status] + (rec.at ? ' · ' + hhmm(rec.at) : '');
      btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>更新为「到场」';
    } else {
      chip.className = 'chip';
      chip.textContent = '未签到';
      btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>我到了，签到';
    }
    $('checkSub').textContent = dateCN(S.today) + ' · ' + S.slot;
  }

  function checkIn() {
    var slot = $('checkSlot').value;
    var existing = findTodayRecord(slot);
    var now = Date.now();
    var rec = {
      id: S.cls.code + '|' + S.today + '|' + slot + '|' + S.user.no,
      classCode: S.cls.code,
      date: S.today,
      slot: slot,
      studentId: S.user.no,
      studentName: S.user.name,
      status: 'present',
      by: S.user.id,
      self: true,
      at: now,
      updatedAt: now
    };

    Store.put('attendance', rec).then(function () {
      return Cloud.enqueue('attendance.bulk', {
        classCode: S.cls.code,
        date: S.today,
        slot: slot,
        records: [{ studentId: S.user.no, status: 'present', at: now, self: true }],
        removed: []
      });
    }).then(function () {
      var idx = -1;
      S.rows.forEach(function (r, i) { if (r.id === rec.id) idx = i; });
      if (idx >= 0) S.rows[idx] = rec; else S.rows.unshift(rec);
      S.rows.sort(function (a, b) { return (a.date + a.slot) < (b.date + b.slot) ? 1 : -1; });
      paintCheckState();
      renderHomeStats();
      renderRecords();
      UI.toast(existing ? '已更新为到场 ' + hhmm(now) : '签到成功 ' + hhmm(now), 'ok');
      $('checkBtn').animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'cubic-bezier(.22,.61,.36,1)' }
      );
    }).catch(function (e) { UI.toast('签到失败：' + (e.message || e), 'bad'); });
  }

  function renderHomeStats() {
    var sum = summarize(S.rows);
    $('ring').style.setProperty('--p', sum.rate);
    $('ringVal').textContent = sum.total ? sum.rate + '%' : '—';
    $('chipStreak').innerHTML = '<span class="chip__dot"></span>连续到场 ' + streak(S.rows) + ' 次';
    $('chipAbsent').textContent = '缺勤 ' + sum.a + ' 次';
    $('chipAbsent').className = 'chip' + (sum.a ? ' chip--bad' : '');
  }

  /* ---------------- 记录 ---------------- */
  function renderMonths() {
    var months = {};
    S.rows.forEach(function (r) { months[r.date.slice(0, 7)] = true; });
    var list = Object.keys(months).sort().reverse();
    $('monthFilter').innerHTML = '<option value="all">全部记录</option>' + list.map(function (m) {
      return '<option value="' + m + '">' + m.replace('-', ' 年 ') + ' 月</option>';
    }).join('');
    $('monthFilter').value = S.month;
  }

  function renderRecords() {
    var rows = S.month === 'all' ? S.rows : S.rows.filter(function (r) { return r.date.slice(0, 7) === S.month; });
    var sum = summarize(rows);
    $('rRate').textContent = rows.length ? sum.rate + '%' : '—';
    $('rPresent').textContent = sum.p;
    $('rAbsent').textContent = sum.a;
    $('rOther').textContent = sum.l + ' / ' + sum.lv;
    $('recSub').textContent = S.month === 'all' ? '全部 ' + rows.length + ' 条' : S.month.replace('-', ' 年 ') + ' 月 · ' + rows.length + ' 条';

    var box = $('recordList');
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><b>这段时间没有记录</b><span>老师的点名和你的签到都会出现在这里</span></div>';
      return;
    }
    box.innerHTML = '<div class="tl">' + rows.map(function (r) {
      var tone = r.status === 'absent' ? 'chip--bad' : r.status === 'late' ? 'chip--warn' : r.status === 'leave' ? '' : 'chip--ok';
      return '<div class="tl__row">' +
        '<span class="tl__date">' + r.date.slice(5) + '</span>' +
        '<span class="tl__dot ' + r.status + '"></span>' +
        '<span class="tl__what"><b>' + esc(r.slot) + ' · ' + (S.cls.subject || '课程') + '</b>' +
        '<span>' + dateCN(r.date) + (r.at ? ' · ' + hhmm(r.at) : '') + (r.self ? ' · 自己签到' : '') + '</span></span>' +
        '<span class="chip ' + tone + '">' + STATUS_TEXT[r.status] + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- 课表 ---------------- */
  function renderTimetable() {
    var wd = UI.weekdayNum(S.today);
    var box = $('timetable');
    if (!S.courses.length) {
      box.innerHTML = '<div class="empty"><b>课表还是空的</b><span>老师排好课后会同步过来</span></div>';
      return;
    }
    var html = '';
    for (var w = 1; w <= 7; w++) {
      var list = S.courses.filter(function (c) { return c.weekday === w; });
      if (!list.length) continue;
      html += '<div style="display:flex;align-items:center;gap:8px;margin:16px 0 6px">' +
        '<b style="font-size:13px">' + WEEK[w] + '</b>' +
        (w === wd ? '<span class="chip chip--gold">今天</span>' : '') +
        '<span style="flex:1;height:1px;background:var(--line)"></span></div>';
      html += list.sort(function (a, b) { return a.slot.localeCompare(b.slot); }).map(function (c) {
        return '<div class="course"><div class="course__slot"><b>' + c.slot.replace('第 ', '').replace(' 节', '') + '</b>节</div>' +
          '<div><b>' + esc(c.name) + '</b><span>' + esc(c.room || '') + '</span></div></div>';
      }).join('');
    }
    box.innerHTML = html;
  }

  /* ---------------- 启动 ---------------- */
  function greeting(name) {
    var h = new Date().getHours();
    var g = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    return g + '，' + name;
  }

  function boot() {
    Store.ready()
      .then(function () {
        if (window.DIANMAO && DIANMAO.seedDemo) return Store.seed();
      })
      .then(function () { return Cloud.init(); })
      .then(function () { return UI.guard('student'); })
      .then(function (user) {
        if (!user) return;
        S.user = user;
        S.today = Store.dateStr(new Date());
        return Promise.all([
          Store.get('classes', user.classCode),
          Store.all('courses')
        ]).then(function (r) {
          S.cls = r[0] || { code: user.classCode, name: '我的班级', subject: '' };
          S.courses = r[1].filter(function (c) { return c.classCode === S.cls.code; });

          $('className').textContent = S.cls.name;
          $('classMeta').textContent = '学生 · ' + user.no;
          $('meName').textContent = user.name;
          $('meAvatar').textContent = initial(user.name);
          $('greeting').textContent = greeting(user.name);
          $('todayLine').textContent = '今天是 ' + dateCN(S.today);

          UI.mountSync($('syncHost'));
          return loadRows();
        });
      })
      .then(function () {
        renderMonths();
        renderHome();
        renderRecords();
        renderTimetable();
      })
      .catch(function (e) { UI.toast('加载失败：' + (e.message || e), 'bad'); });
  }

  function bind() {
    document.querySelectorAll('.nav__btn, .tabbar button').forEach(function (b) {
      b.addEventListener('click', function () {
        switchPage(b.dataset.page);
        if (b.dataset.page === 'records') { renderMonths(); renderRecords(); }
        if (b.dataset.page === 'timetable') renderTimetable();
      });
    });
    $('checkSlot').addEventListener('change', function () { S.slot = this.value; paintCheckState(); });
    $('checkBtn').addEventListener('click', checkIn);
    $('monthFilter').addEventListener('change', function () { S.month = this.value; renderRecords(); });
    window.addEventListener('dianmao:data', function () {
      loadRows().then(function () {
        renderMonths();
        renderRecords();
        renderHomeStats();
        paintCheckState();
      });
    });
    $('logout').addEventListener('click', function () {
      Auth.logout().then(function () { location.href = 'index.html'; });
    });
  }

  function init() { bind(); boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
