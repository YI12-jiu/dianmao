/* 登录页交互 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var role = 'teacher';
  var busy = false;

  var COPY = {
    teacher: {
      account: '工号 / 手机号',
      accountHint: '请填写工号',
      submit: '进入老师工作台',
      welcome: '请选择身份，再输入你的账号',
      wipe: '正在进入老师工作台',
      page: 'teacher.html'
    },
    student: {
      account: '学号 / 手机号',
      accountHint: '请填写学号',
      submit: '进入我的考勤',
      welcome: '登录后只看得到自己的考勤记录',
      wipe: '正在载入我的考勤',
      page: 'student.html'
    }
  };

  /* ---------------- 点阵 ---------------- */
  function paintRollcall() {
    var box = $('rollcall');
    if (!box) return;
    var cols = 24, rows = 3, html = '';
    box.style.setProperty('--cols', cols);
    for (var i = 0; i < cols * rows; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      var delay = (col * 0.06 + row * 0.19).toFixed(2);
      var miss = (i * 7) % 31 === 0;
      html += '<i class="' + (miss ? 'miss' : '') + '" style="--d:' + delay + 's"></i>';
    }
    box.innerHTML = html;
  }

  /* ---------------- 状态 ---------------- */
  function paintNet() {
    var online = navigator.onLine !== false;
    var el = $('netState');
    el.classList.toggle('off', !online);
    el.querySelector('b').textContent = online ? '在线' : '离线可用';
  }

  function paintCloud(s) {
    $('syncState').textContent = s.mode === 'local' ? '本地存储' : s.label;
  }

  /* ---------------- 角色 ---------------- */
  function setRole(next, silent) {
    role = next;
    var seg = $('seg');
    seg.dataset.role = next;
    seg.querySelectorAll('.seg__btn').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.role === next));
      b.tabIndex = b.dataset.role === next ? 0 : -1;
    });
    $('accountLabel').textContent = COPY[next].account;
    $('accountHint').textContent = COPY[next].accountHint;
    $('submitLabel').textContent = COPY[next].submit;
    $('welcomeSub').textContent = COPY[next].welcome;
    $('wipeText').textContent = COPY[next].wipe;
    if (!silent) hideError();
  }

  /* ---------------- 错误 ---------------- */
  function hideError() {
    $('gateErr').classList.remove('on');
    $('fAccount').classList.remove('err');
    $('fPassword').classList.remove('err');
  }
  function showError(msg, field) {
    $('gateErrText').textContent = msg;
    $('gateErr').classList.remove('on');
    void $('gateErr').offsetWidth;
    $('gateErr').classList.add('on');
    if (field === 'account') $('fAccount').classList.add('err');
    if (field === 'password') $('fPassword').classList.add('err');
  }

  /* ---------------- 转场 ---------------- */
  function enterPage(page, btn) {
    var wipe = $('wipe');
    var r = btn ? btn.getBoundingClientRect() : null;
    var wx = r ? ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%' : '72%';
    var wy = r ? ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%' : '62%';
    wipe.style.setProperty('--wx', wx);
    wipe.style.setProperty('--wy', wy);
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    wipe.classList.add('on');
    setTimeout(function () { location.href = page; }, reduce ? 30 : 620);
  }

  /* ---------------- 登录 ---------------- */
  function setLoading(on) {
    busy = on;
    var btn = $('submit');
    btn.classList.toggle('loading', on);
    btn.disabled = on;
  }

  function doLogin() {
    if (busy) return;
    var account = $('account').value.trim();
    var pwd = $('password').value;
    hideError();

    if (!account) { showError(role === 'teacher' ? '请先填写工号' : '请先填写学号', 'account'); $('account').focus(); return; }
    if (!pwd) { showError('请填写登录口令', 'password'); $('password').focus(); return; }

    setLoading(true);
    Auth.login(account, pwd, role, $('remember').checked).then(function (res) {
      if (res.ok) {
        enterPage(COPY[res.user.role].page, $('submit'));
        return;
      }
      setLoading(false);

      if (res.code === 'role-mismatch') {
        var other = res.actual === 'teacher' ? 'teacher' : 'student';
        setRole(other, true);
        UI.toast('这是' + (other === 'teacher' ? '老师' : '学生') + '账号，已为你切换身份', 'ok');
        $('password').focus();
        $('password').select();
        return;
      }
      if (res.code === 'no-pwd') {
        showError('这个账号还没有在这台设备上设置口令，请在自己的设备登录，或让老师重置', 'password');
        return;
      }
      if (res.code === 'no-account') { showError('没有找到这个账号，检查一下' + (role === 'teacher' ? '工号' : '学号'), 'account'); return; }
      if (res.code === 'bad-password') { showError('口令不正确，再试一次', 'password'); $('password').select(); return; }
      if (res.code === 'locked') {
        showError('尝试次数过多，请 ' + Math.ceil(res.left / 1000) + ' 秒后再试', 'password');
        return;
      }
      showError('登录失败，请重试');
    }).catch(function (e) {
      setLoading(false);
      showError('本机存储不可用：' + (e.message || '未知错误'));
    });
  }

  /* ---------------- 上次登录 ---------------- */
  function paintResume(user) {
    var box = $('resume');
    if (!user) { box.hidden = true; return; }
    $('resumeAvatar').textContent = (user.name || '?').slice(0, 1);
    $('resumeName').textContent = user.name;
    $('resumeMeta').textContent = (user.role === 'teacher' ? '老师' : '学生') + ' · ' +
      (user.title || user.classCode || '');
    box.hidden = false;
    $('resumeGo').onclick = function () {
      enterPage(user.role === 'teacher' ? 'teacher.html' : 'student.html', $('resumeGo'));
    };
    $('resumeDrop').onclick = function () {
      Auth.logout().then(function () { box.hidden = true; $('account').focus(); });
    };
  }

  /* ---------------- 弹层 ---------------- */
  function bindSheets() {
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { $(b.dataset.close).hidden = true; });
    });
    document.querySelectorAll('.scrim').forEach(function (s) {
      s.addEventListener('click', function (e) { if (e.target === s) s.hidden = true; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.scrim').forEach(function (s) { s.hidden = true; });
      }
    });

    $('forgot').addEventListener('click', function () {
      $('forgotAccount').value = $('account').value.trim();
      $('forgotMsg').style.display = 'none';
      $('forgotSheet').hidden = false;
      setTimeout(function () { ($('forgotAccount').value ? $('forgotPwd') : $('forgotAccount')).focus(); }, 80);
    });
    $('joinClass').addEventListener('click', function () {
      $('joinMsg').style.display = 'none';
      $('joinSheet').hidden = false;
      setTimeout(function () { $('joinCode').focus(); }, 80);
    });

    $('forgotDo').addEventListener('click', function () {
      var acc = $('forgotAccount').value.trim();
      var p1 = $('forgotPwd').value, p2 = $('forgotPwd2').value;
      var msg = $('forgotMsg');
      var fail = function (t) { msg.textContent = t; msg.style.display = 'block'; };
      if (!acc) return fail('请填写账号');
      if (p1.length < 6) return fail('新口令至少 6 位');
      if (p1 !== p2) return fail('两次输入的口令不一致');
      Auth.resetPassword(acc, p1).then(function (r) {
        if (r.ok) {
          $('forgotSheet').hidden = true;
          $('account').value = acc;
          $('password').value = p1;
          UI.toast('口令已更新，可以直接登录', 'ok');
        } else if (r.code === 'no-account') {
          fail('这台设备上没有这个账号，请让班主任帮你重置');
        } else {
          fail('新口令至少 6 位');
        }
      });
    });

    $('joinDo').addEventListener('click', function () {
      var msg = $('joinMsg');
      var fail = function (t) { msg.textContent = t; msg.style.display = 'block'; };
      var payload = {
        classCode: $('joinCode').value.trim(),
        name: $('joinName').value.trim(),
        no: $('joinNo').value.trim(),
        pwd: $('joinPwd').value
      };
      if (!payload.classCode || !payload.name || !payload.no) return fail('班级码、姓名、学号都要填');
      msg.style.display = 'none';
      var btn = $('joinDo');
      btn.disabled = true;
      Auth.registerStudent(payload).then(function (r) {
        btn.disabled = false;
        if (r.ok) {
          $('joinSheet').hidden = true;
          UI.toast('已加入班级，正在进入', 'ok');
          setRole('student', true);
          enterPage('student.html', $('submit'));
        } else if (r.code === 'no-class') {
          fail('没有这个班级码，和班主任再核对一下');
        } else if (r.code === 'duplicate') {
          fail('这个学号已经注册过，直接登录即可');
        } else if (r.code === 'weak') {
          fail('口令至少 6 位');
        } else {
          fail('信息不完整，请检查');
        }
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    paintRollcall();
    paintNet();
    window.addEventListener('online', paintNet);
    window.addEventListener('offline', paintNet);

    var seg = $('seg');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn');
      if (!b || b.dataset.role === role) return;
      setRole(b.dataset.role);
    });
    seg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setRole(role === 'teacher' ? 'student' : 'teacher');
        seg.querySelector('.seg__btn[aria-selected="true"]').focus();
      }
    });

    $('togglePwd').addEventListener('click', function () {
      var input = $('password');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? '隐藏口令' : '显示口令');
      input.focus();
    });

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
    ['account', 'password'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        $(id === 'account' ? 'fAccount' : 'fPassword').classList.remove('err');
        $('gateErr').classList.remove('on');
      });
    });

    document.querySelectorAll('.quick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = btn.dataset.demo;
        setRole(r, true);
        $('account').value = r === 'teacher' ? 't1001' : '2026001';
        $('password').value = '123456';
        doLogin();
      });
    });

    bindSheets();
    setRole('teacher');

    Store.ready()
      .then(function () {
        if (window.DIANMAO && DIANMAO.seedDemo) return Store.seed();
      })
      .then(function () { return Cloud.init(); })
      .then(function () {
        paintCloud(Cloud.state());
        Cloud.on(paintCloud);
        return Auth.currentUser();
      })
      .then(function (u) {
        if (u) paintResume(u);
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduce && window.innerWidth > 900 && !u) $('account').focus();
      })
      .catch(function (e) {
        showError('初始化失败：' + (e && e.message ? e.message : '未知错误'));
      });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
