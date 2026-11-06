/* 老师端工作台 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SLOTS = ['第 1 节', '第 2 节', '第 3 节', '第 4 节', '第 5 节', '第 6 节', '第 7 节', '第 8 节', '晚自习'];
  var STATUS = { present: '到场', late: '迟到', absent: '缺勤', leave: '请假' };

  var S = {
    user: null,
    cls: null,
    students: [],
    courses: [],
    date: '',
    slot: SLOTS[0],
    marks: {},        // no -> status
    savedMarks: {},   // 已落库的
    stats: null,
    q: ''
  };

  /* ---------------- 小工具 ---------------- */
  function initial(name) { return (name || '?').slice(0, 1); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
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

  /* ---------------- 导航 ---------------- */
  function switchPage(page) {
    ['attend', 'stats', 'roster', 'set'].forEach(function (p) {
      $('page-' + p).hidden = p !== page;
    });
    document.querySelectorAll('.nav__btn, .tabbar button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.page === page);
    });
    if (page === 'stats') renderStats();
    if (page === 'roster') renderRoster();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ---------------- 点名 ---------------- */
  function currentAttendance() {
    return Store.attendanceOf(S.cls.code, S.date).then(function (rows) {
      return rows.filter(function (r) { return r.slot === S.slot; });
    });
  }

  function loadMarks() {
    return currentAttendance().then(function (rows) {
      S.marks = {};
      S.savedMarks = {};
      rows.forEach(function (r) { S.marks[r.studentId] = r.status; });
      S.savedMarks = clone(S.marks);
      renderRows();
      renderKpi();
      renderSaveState();
    });
  }

  function renderKpi() {
    var total = S.students.length;
    var marked = Object.keys(S.marks).length;
    var present = Object.keys(S.marks).filter(function (k) {
      return S.marks[k] === 'present' || S.marks[k] === 'late';
    }).length;
    $('kTotal').textContent = total;
    $('kPresent').textContent = present;
    $('kPending').textContent = total - marked;
    var rateEl = $('kRate');
    var capEl = document.querySelector('.kpi--hero span');
    if (capEl) capEl.textContent = (marked && marked < S.students.length) ? '出勤率（已点名）' : '出勤率';
    if (marked) {
      rateEl.textContent = pct(present, marked) + '%';
      rateEl.classList.remove('is-idle');
    } else {
      rateEl.textContent = '待点名';
      rateEl.classList.add('is-idle');
    }
  }

  function renderSaveState() {
    var dirty = JSON.stringify(S.marks) !== JSON.stringify(S.savedMarks);
    var chip = $('saveState');
    chip.className = 'chip ' + (dirty ? 'chip--warn' : (Object.keys(S.savedMarks).length ? 'chip--ok' : ''));
    chip.textContent = dirty
      ? '有未保存的改动'
      : (Object.keys(S.savedMarks).length ? '已保存 · ' + dateCN(S.date) + ' ' + S.slot : '未保存');
    $('attendSub').textContent = S.students.length
      ? dateCN(S.date) + ' · ' + S.slot + ' · 应到 ' + S.students.length + ' 人'
      : '名单还是空的，先去「学生」里添加';
  }

  function renderRows() {
    var list = S.students.filter(function (s) {
      if (!S.q) return true;
      var k = S.q.toLowerCase();
      return s.name.toLowerCase().indexOf(k) >= 0 || String(s.no).toLowerCase().indexOf(k) >= 0;
    });

    var box = $('stuList');
    if (!S.students.length) {
      box.innerHTML = '<div class="empty"><b>还没有学生</b><span>在「学生」页添加，或让学生用班级码 ' + S.cls.code + ' 自行加入</span></div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty"><b>没有匹配的学生</b><span>换个关键词试试</span></div>';
      return;
    }

    box.innerHTML = list.map(function (s) {
      var st = S.marks[s.no];
      return '<div class="stu' + (st ? ' stu--' + (st === 'late' ? 'late' : st === 'absent' ? 'absent' : st === 'present' ? 'present' : 'leave') : '') + '" data-no="' + s.no + '">' +
        '<div class="stu__av">' + initial(s.name) + '</div>' +
        '<div class="stu__who"><b>' + esc(s.name) + '</b><span>' + esc(s.no) + '</span></div>' +
        '<div class="segmini" role="group" aria-label="' + esc(s.name) + ' 的出勤状态">' +
        ['present', 'late', 'absent', 'leave'].map(function (k) {
          return '<button type="button" data-st="' + k + '" title="' + STATUS[k] + '" aria-label="' + STATUS[k] + '" aria-pressed="' + (st === k) + '">' + STATUS[k] + '</button>';
        }).join('') +
        '</div></div>';
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bindRowEvents() {
    $('stuList').addEventListener('click', function (e) {
      var b = e.target.closest('.segmini button');
      if (!b) return;
      var row = b.closest('.stu');
      var no = row.dataset.no;
      var st = b.dataset.st;
      if (S.marks[no] === st) delete S.marks[no];
      else S.marks[no] = st;

      var cls = 'stu';
      if (S.marks[no]) cls += ' stu--' + (S.marks[no] === 'late' ? 'late' : S.marks[no] === 'absent' ? 'absent' : S.marks[no] === 'present' ? 'present' : 'leave');
      row.className = cls;
      row.querySelectorAll('.segmini button').forEach(function (x) {
        x.setAttribute('aria-pressed', String(S.marks[no] === x.dataset.st));
      });
      renderKpi();
      renderSaveState();
    });
  }

  function saveAttendance() {
    var records = Object.keys(S.marks).map(function (no) {
      var stu = S.students.filter(function (s) { return s.no === no; })[0] || {};
      return {
        id: S.cls.code + '|' + S.date + '|' + S.slot + '|' + no,
        classCode: S.cls.code,
        date: S.date,
        slot: S.slot,
        studentId: no,
        studentName: stu.name || '',
        status: S.marks[no],
        by: S.user.id,
        at: Date.now(),
        updatedAt: Date.now()
      };
    });

    var removed = Object.keys(S.savedMarks).filter(function (no) { return !S.marks[no]; });

    var work = Promise.all([
      Store.bulkPut('attendance', records),
      Promise.all(removed.map(function (no) {
        return Store.del('attendance', S.cls.code + '|' + S.date + '|' + S.slot + '|' + no);
      }))
    ]);

    return work.then(function () {
      return Cloud.enqueue('attendance.bulk', {
        classCode: S.cls.code,
        date: S.date,
        slot: S.slot,
        records: records.map(function (r) {
          return { studentId: r.studentId, status: r.status, at: r.at };
        }),
        removed: removed
      });
    }).then(function () {
      S.savedMarks = clone(S.marks);
      renderSaveState();
      UI.toast('已保存 ' + records.length + ' 条记录', 'ok');
    });
  }

  /* ---------------- 统计 ---------------- */
  function renderStats() {
    Store.attendanceOf(S.cls.code).then(function (rows) {
      var bySession = {};
      rows.forEach(function (r) {
        var key = r.date + '|' + r.slot;
        (bySession[key] = bySession[key] || []).push(r);
      });
      var keys = Object.keys(bySession).sort();

      var total = 0, present = 0, absent = 0, late = 0;
      keys.forEach(function (k) {
        bySession[k].forEach(function (r) {
          total++;
          if (r.status === 'present') present++;
          else if (r.status === 'late') { present++; late++; }
          else if (r.status === 'absent') absent++;
        });
      });

      $('sRate').textContent = total ? pct(present, total) + '%' : '—';
      $('sSessions').textContent = keys.length;
      $('sAbsent').textContent = absent;
      $('sLate').textContent = late;

      /* 图表：最近 7 场 */
      var last = keys.slice(-7);
      var chart = $('chart');
      if (!last.length) {
        chart.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>还没有考勤记录</b><span>先到「点名」保存一次</span></div>';
        chart.style.gridTemplateColumns = '1fr';
      } else {
        chart.style.gridTemplateColumns = 'repeat(' + last.length + ', minmax(0, 1fr))';
        chart.innerHTML = last.map(function (k) {
          var recs = bySession[k];
          var p = recs.filter(function (r) { return r.status === 'present' || r.status === 'late'; }).length;
          var rate = pct(p, recs.length);
          var h = Math.max(Math.round(rate / 100 * 118), 3);
          var d = k.split('|')[0].slice(5).replace('-', '/');
          return '<div class="chart__col" title="' + k + ' · ' + rate + '%">' +
            '<span class="chart__val">' + rate + '</span>' +
            '<div class="chart__plot"><div class="chart__bar" data-zero="' + (rate === 0 ? 1 : 0) + '" style="height:' + h + 'px"></div></div>' +
            '<span class="chart__lb">' + d + '</span></div>';
        }).join('');
      }

      /* 明细 */
      var per = {};
      S.students.forEach(function (s) { per[s.no] = { name: s.name, total: 0, p: 0, a: 0, l: 0, lv: 0 }; });
      rows.forEach(function (r) {
        var row = per[r.studentId];
        if (!row) return;
        row.total++;
        if (r.status === 'present') row.p++;
        else if (r.status === 'late') { row.p++; row.l++; }
        else if (r.status === 'absent') row.a++;
        else row.lv++;
      });

      var body = $('statRows');
      if (!S.students.length) {
        body.innerHTML = '<div class="empty"><b>暂无学生</b><span>添加学生后才会有明细</span></div>';
        return;
      }
      body.innerHTML = S.students.map(function (s) {
        var d = per[s.no];
        var rate = pct(d.p, d.total);
        var tone = rate >= 90 ? 'chip--ok' : rate >= 75 ? 'chip--gold' : 'chip--bad';
        return '<div class="stu" style="grid-template-columns:34px minmax(0,1fr) auto">' +
          '<div class="stu__av">' + initial(s.name) + '</div>' +
          '<div class="stu__who"><b>' + esc(s.name) + '</b><span>出勤 ' + d.p + ' · 缺勤 ' + d.a + ' · 迟到 ' + d.l + ' · 请假 ' + d.lv + '</span></div>' +
          '<span class="chip ' + tone + '">' + (d.total ? rate + '%' : '—') + '</span>' +
          '</div>';
      }).join('');
    });
  }

  /* ---------------- 名单 ---------------- */
  function renderRoster() {
    var q = ($('rosterQ').value || '').toLowerCase();
    var list = S.students.filter(function (s) {
      return !q || s.name.toLowerCase().indexOf(q) >= 0 || String(s.no).indexOf(q) >= 0;
    });
    $('rosterCount').textContent = S.students.length;

    var box = $('rosterList');
    if (!list.length) {
      box.innerHTML = '<div class="empty"><b>没有学生</b><span>在上方输入姓名和学号添加</span></div>';
      return;
    }
    box.innerHTML = list.map(function (s) {
      return '<div class="stu" data-id="' + s.id + '" style="grid-template-columns:34px minmax(0,1fr) auto auto">' +
        '<div class="stu__av">' + initial(s.name) + '</div>' +
        '<div class="stu__who"><b>' + esc(s.name) + '</b><span>' + esc(s.no) + ' · 加入于 ' + UI.fmtDate(new Date(s.createdAt || Date.now())) + '</span></div>' +
        (s.pwd ? '' : '<span class="chip chip--warn" title="该账号在学生自己的设备上设置口令">待激活</span>') +
        '<button type="button" class="btn btn--quiet btn--sm" data-del="' + s.id + '">移除</button>' +
        '</div>';
    }).join('');
  }

  function addStudent() {
    var name = $('newName').value.trim();
    var no = $('newNo').value.trim();
    if (!name || !no) { UI.toast('姓名和学号都要填', 'bad'); return; }

    Auth.findByAccount(no).then(function (exists) {
      if (exists) { UI.toast('这个学号已经存在', 'bad'); return; }
      return Auth.hash('123456').then(function (p) {
        var user = {
          id: Store.uid(),
          role: 'student',
          name: name,
          account: no,
          no: no,
          classCode: S.cls.code,
          title: S.cls.name,
          pwd: p,
          createdAt: Date.now()
        };
        return Store.put('users', user).then(function () {
          Cloud.enqueue('user.create', { id: user.id, role: 'student', name: name, account: no, classCode: S.cls.code });
          S.students.push(user);
          S.students.sort(function (a, b) { return String(a.no).localeCompare(String(b.no)); });
          $('newName').value = '';
          $('newNo').value = '';
          renderRoster();
          renderRows();
          renderKpi();
          UI.toast('已添加 ' + name + '，初始口令 123456', 'ok');
        });
      });
    });
  }

  function removeStudent(id) {
    var stu = S.students.filter(function (s) { return s.id === id; })[0];
    if (!stu) return;
    Store.del('users', id).then(function () {
      Cloud.enqueue('user.delete', { id: id, account: stu.no, classCode: S.cls.code });
      S.students = S.students.filter(function (s) { return s.id !== id; });
      delete S.marks[stu.no];
      renderRoster();
      renderRows();
      renderKpi();
      UI.toast('已移除 ' + stu.name, 'bad');
    });
  }

  /* ---------------- 云端设置 ---------------- */
  function paintCloud() {
    var s = Cloud.state();
    $('cloudMode').textContent = s.mode === 'local' ? '本地模式' : (s.online ? '云端已连接' : '离线中');
    $('cloudMode').className = 'chip ' + (s.mode === 'local' ? 'chip--gold' : s.online ? 'chip--ok' : 'chip--warn');
    $('cloudDetail').textContent = s.mode === 'local'
      ? '尚未配置接口，所有记录只保存在这台设备'
      : !s.online
        ? '当前离线，' + s.pending + ' 条操作排队，联网后自动回传'
        : s.error
          ? '上次同步失败：' + s.error
          : (s.lastSync ? '上次同步 ' + UI.relTime(s.lastSync) : '已配置，等待首次同步');
    $('queueCount').textContent = s.pending + ' 条';

    Store.count('outbox').then(function (n) { $('queueCount').textContent = n + ' 条'; });
  }

  function bindCloud() {
    $('endpoint').value = Cloud.state().endpoint || (window.DIANMAO ? DIANMAO.cloud.endpoint : '');
    Cloud.on(paintCloud);
    paintCloud();

    $('saveCloud').addEventListener('click', function () {
      Cloud.setEndpoint($('endpoint').value, $('token').value).then(function (s) {
        UI.toast(s.mode === 'local' ? '已清空接口，回到本地模式' : '接口已保存', 'ok');
        paintCloud();
        if (s.mode !== 'local') Cloud.syncNow();
      });
    });
    $('testCloud').addEventListener('click', function () {
      if (!$('endpoint').value.trim()) { UI.toast('先填接口地址', 'bad'); return; }
      Cloud.setEndpoint($('endpoint').value, $('token').value).then(function () {
        UI.toast('正在测试…');
        return Cloud.test();
      }).then(function (r) {
        UI.toast(r.ok ? '接口可达' : '连不上：' + (r.message || r.code), r.ok ? 'ok' : 'bad');
      });
    });
    $('flushNow').addEventListener('click', function () {
      Cloud.syncNow().then(function (s) {
        UI.toast(s.mode === 'local' ? '本地模式无需同步' : (s.pending ? '仍有 ' + s.pending + ' 条待回传' : '同步完成'), s.pending ? 'bad' : 'ok');
        paintCloud();
      });
    });

    $('showQueue').addEventListener('click', function () {
      Store.all('outbox').then(function (ops) {
        var body = $('queueBody');
        body.innerHTML = ops.length ? ops.slice(-20).reverse().map(function (o) {
          return '<div style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px">' +
            '<b style="font-weight:500">' + o.type + '</b>' +
            '<span style="color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(JSON.stringify(o.payload)).slice(0, 60) + '</span>' +
            '<span style="color:var(--muted-2)">' + UI.relTime(o.ts) + '</span></div>';
        }).join('') : '<div class="empty"><b>队列是空的</b><span>所有操作都已处理</span></div>';
        $('queueSheet').hidden = false;
      });
    });
    $('queueSync').addEventListener('click', function () {
      Cloud.syncNow().then(function (s) {
        UI.toast(s.pending ? '仍有 ' + s.pending + ' 条' : '同步完成', s.pending ? 'bad' : 'ok');
        $('queueSheet').hidden = true;
      });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { $(b.dataset.close).hidden = true; });
    });
  }

  /* ---------------- 导出 / 清空 ---------------- */
  function exportJSON() {
    Promise.all([Store.all('users'), Store.all('attendance'), Store.all('courses'), Store.all('classes')])
      .then(function (r) {
        var dump = {
          app: 'dianmao',
          version: (window.DIANMAO && DIANMAO.version) || '1',
          exportedAt: new Date().toISOString(),
          classes: r[3], users: r[0], courses: r[2], attendance: r[1]
        };
        var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '点卯备份-' + UI.fmtDate(new Date()) + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        UI.toast('已导出备份', 'ok');
      });
  }

  /* ---------------- 启动 ---------------- */
  function greeting() {
    var h = new Date().getHours();
    var g = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    return g + '，' + (S.user.name || '老师');
  }

  function boot() {
    Store.ready()
      .then(function () {
        if (window.DIANMAO && DIANMAO.seedDemo) return Store.seed();
      })
      .then(function () { return Cloud.init(); })
      .then(function () { return UI.guard('teacher'); })
      .then(function (user) {
        if (!user) return;
        S.user = user;
        return Promise.all([
          Store.get('classes', user.classCode),
          Auth.usersOfClass(user.classCode, 'student'),
          Store.all('courses'),
          Store.metaGet('cloud.endpoint', '')
        ]).then(function (r) {
          S.cls = r[0] || { code: user.classCode, name: '我的班级', subject: '' };
          S.students = r[1].sort(function (a, b) { return String(a.no).localeCompare(String(b.no)); });
          S.courses = r[2].filter(function (c) { return c.classCode === S.cls.code; });
          S.cloudEndpointStored = r[3];

          /* 头部 */
          $('className').textContent = S.cls.name;
          $('classMeta').textContent = (S.cls.subject || '班级') + ' · ' + S.cls.code;
          $('meName').textContent = user.name;
          $('meAvatar').textContent = initial(user.name);
          $('greeting').textContent = greeting();

          var today = Store.dateStr(new Date());
          var wd = UI.weekdayNum(today);
          var todayCourses = S.courses.filter(function (c) { return c.weekday === wd; });
          $('todayLine').textContent = '今天是 ' + dateCN(today) +
            (todayCourses.length ? ' · 今日 ' + todayCourses.length + ' 节课：' + todayCourses.map(function (c) { return c.name.split(' · ')[0] + ' ' + c.slot; }).join('，') : ' · 今天没有排课');

          /* 日期与节次 */
          S.date = today;
          $('date').value = today;
          $('date').max = today;
          $('slot').innerHTML = SLOTS.map(function (s) {
            return '<option value="' + s + '">' + s + '</option>';
          }).join('');
          if (todayCourses.length) S.slot = todayCourses[0].slot;
          $('slot').value = S.slot;
          $('verTxt').textContent = 'v' + ((window.DIANMAO && DIANMAO.version) || '1.0.0');

          mountSync();
          bindRowEvents();
          bindCloud();
          return loadMarks();
        });
      })
      .then(function () { renderStats(); })
      .catch(function (e) { UI.toast('加载失败：' + (e.message || e), 'bad'); });
  }

  function mountSync() {
    UI.mountSync($('syncHost'));
  }

  function bind() {
    document.querySelectorAll('.nav__btn, .tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { switchPage(b.dataset.page); });
    });

    $('date').addEventListener('change', function () {
      S.date = this.value || Store.dateStr(new Date());
      loadMarks();
    });
    $('slot').addEventListener('change', function () {
      S.slot = this.value;
      loadMarks();
    });
    $('q').addEventListener('input', function () { S.q = this.value.trim(); renderRows(); });

    $('allPresent').addEventListener('click', function () {
      S.students.forEach(function (s) { S.marks[s.no] = 'present'; });
      renderRows(); renderKpi(); renderSaveState();
      UI.toast('已全部标为到场，记得保存');
    });
    $('clearAll').addEventListener('click', function () {
      S.marks = {};
      renderRows(); renderKpi(); renderSaveState();
    });
    [$('saveAttend'), $('saveAttend2')].forEach(function (b) {
      b.addEventListener('click', function () {
        if (!S.students.length) { UI.toast('名单是空的', 'bad'); return; }
        b.disabled = true;
        saveAttendance().then(function () { b.disabled = false; })
          .catch(function (e) { b.disabled = false; UI.toast('保存失败：' + (e.message || e), 'bad'); });
      });
    });

    $('addStu').addEventListener('click', addStudent);
    $('newNo').addEventListener('keydown', function (e) { if (e.key === 'Enter') addStudent(); });
    $('rosterQ').addEventListener('input', renderRoster);
    $('rosterList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-del]');
      if (b) removeStudent(b.dataset.del);
    });

    $('exportBtn').addEventListener('click', exportJSON);
    $('logout').addEventListener('click', function () {
      Auth.logout().then(function () { location.href = 'index.html'; });
    });
    $('logout2').addEventListener('click', function () {
      Auth.logout().then(function () { location.href = 'index.html'; });
    });
    $('wipeBtn').addEventListener('click', function () {
      if (!confirm('将删除这台设备上的全部账号与考勤记录，确定吗？')) return;
      Store.wipe().then(function () { return Auth.logout(); }).then(function () {
        location.reload();
      });
    });

    /* 云端拉回别的设备的改动 */
    window.addEventListener('dianmao:data', function (e) {
      var dirty = JSON.stringify(S.marks) !== JSON.stringify(S.savedMarks);
      if (dirty) {
        UI.toast('云端有 ' + e.detail.applied + ' 条更新，先保存当前点名再看', 'bad');
        return;
      }
      Auth.usersOfClass(S.cls.code, 'student').then(function (list) {
        S.students = list.sort(function (a, b) { return String(a.no).localeCompare(String(b.no)); });
        return loadMarks();
      }).then(function () {
        renderRoster();
        renderStats();
      });
    });

    /* 安装状态 */
    var sw = $('swState');
    if (!('serviceWorker' in navigator)) {
      sw.textContent = '当前环境不支持';
      sw.className = 'chip';
    } else if (location.protocol === 'file:') {
      sw.textContent = '需通过 http(s) 打开';
      sw.className = 'chip chip--warn';
    } else {
      navigator.serviceWorker.getRegistration().then(function (r) {
        sw.textContent = r ? (r.active ? '离线缓存已就绪' : '注册中…') : '首次加载后可用';
        sw.className = 'chip ' + (r && r.active ? 'chip--ok' : 'chip--warn');
      });
    }
  }

  /* 页面初始化顺序：DOM 就绪 → 绑定 → 启动 */
  function init() {
    bind();
    boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
