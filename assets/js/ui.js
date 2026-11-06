/* 轻量 UI 工具：提示条、弹层、同步状态胶囊、日期格式、登录守卫 */
(function (global) {
  'use strict';

  var layer = null;
  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'toast-layer';
    document.body.appendChild(layer);
    return layer;
  }

  var UI = {
    toast: function (msg, type) {
      var l = ensureLayer();
      var el = document.createElement('div');
      el.className = 'toast' + (type ? ' toast--' + type : '');
      var icon = type === 'bad' ? '!' : type === 'ok' ? '✓' : 'i';
      el.innerHTML = '<span style="font-weight:700;opacity:.8">' + icon + '</span><span></span>';
      el.lastElementChild.textContent = msg;
      l.appendChild(el);
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { el.remove(); }, 240);
      }, 2600);
      return el;
    },

    sheet: function (id) {
      var el = document.getElementById(id);
      if (!el) return null;
      return {
        el: el,
        open: function () {
          el.hidden = false;
          var f = el.querySelector('input,button,select');
          if (f) setTimeout(function () { f.focus(); }, 60);
        },
        close: function () { el.hidden = true; }
      };
    },

    fmtDate: function (d) {
      var p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    weekdayCN: function (dateStr) {
      var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      var d = new Date(dateStr + 'T00:00:00');
      return isNaN(d) ? '' : names[d.getDay()];
    },
    weekdayNum: function (dateStr) {
      var d = new Date(dateStr + 'T00:00:00');
      return isNaN(d) ? 1 : (d.getDay() || 7);
    },
    relTime: function (ts) {
      if (!ts) return '从未';
      var diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      return UI.fmtDate(new Date(ts));
    },

    /* 同步状态胶囊：可挂到任意容器，自动跟随网络/队列变化 */
    mountSync: function (host) {
      if (!host) return;
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'chip sync-pill';
      pill.title = '点击立即同步';
      host.appendChild(pill);

      var render = function (s) {
        var cls = 'chip sync-pill';
        var dot = '<span class="chip__dot"></span>';
        if (s.mode === 'local') cls += ' chip--gold';
        else if (s.syncing) cls += '';
        else if (s.pending) cls += ' chip--warn';
        else if (s.error) cls += ' chip--bad';
        else cls += ' chip--ok';
        pill.className = cls;
        var text = window.innerWidth < 900 ? s.short : s.label;
        pill.innerHTML = dot + '<span>' + text + '</span>';
      };

      render(Cloud.state());
      Cloud.on(render);
      window.addEventListener('resize', function () { render(Cloud.state()); });

      pill.addEventListener('click', function () {
        if (!Cloud.state().endpoint) {
          UI.toast('当前是本地模式，未配置云端接口', 'bad');
          return;
        }
        UI.toast('正在同步…');
        Cloud.syncNow().then(function (s) {
          UI.toast(s.pending ? '仍有 ' + s.pending + ' 条待回传' : '同步完成', s.pending ? 'bad' : 'ok');
        });
      });
      return pill;
    },

    /* 登录守卫：无会话跳到登录页；角色不符跳回自己的页面 */
    guard: function (role) {
      return Auth.currentUser().then(function (u) {
        if (!u) {
          location.replace('index.html?next=' + encodeURIComponent(location.pathname.split('/').pop()));
          return null;
        }
        if (role && u.role !== role) {
          location.replace(u.role === 'teacher' ? 'teacher.html' : 'student.html');
          return null;
        }
        return u;
      });
    }
  };

  global.UI = UI;
})(window);
