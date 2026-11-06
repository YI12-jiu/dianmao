/* 云同步引擎
 * 本地永远是主副本：任何写操作先落本地，再进 outbox 队列；
 * 有网络 + 配了接口地址时才回传，失败自动退避重试，不影响使用。 */
(function (global) {
  'use strict';

  var cfg = (global.DIANMAO && global.DIANMAO.cloud) || {};
  var ENDPOINT_KEY = 'dianmao.cloud.endpoint';
  var TOKEN_KEY = 'dianmao.cloud.token';

  var state = {
    online: navigator.onLine !== false,
    endpoint: '',
    pending: 0,
    lastSync: 0,
    syncing: false,
    error: '',
    backoff: 0
  };

  var subs = [];
  var timer = null;

  function emit() {
    var snap = snapshot();
    subs.forEach(function (fn) { try { fn(snap); } catch (e) { } });
  }
  function snapshot() {
    return {
      online: state.online,
      mode: state.endpoint ? 'cloud' : 'local',
      endpoint: state.endpoint,
      pending: state.pending,
      lastSync: state.lastSync,
      syncing: state.syncing,
      error: state.error,
      label: label(),
      short: shortLabel()
    };
  }
  function shortLabel() {
    if (!state.endpoint) return '本地模式';
    if (!state.online) return '离线 · ' + state.pending;
    if (state.syncing) return '同步中';
    if (state.error) return '待同步 ' + state.pending;
    if (state.pending) return '待同步 ' + state.pending;
    return '已同步';
  }
  function label() {
    if (!state.endpoint) return '本地模式';
    if (!state.online) return '离线 · 待同步 ' + state.pending;
    if (state.syncing) return '同步中…';
    if (state.error) return '同步失败 · 待同步 ' + state.pending;
    if (state.pending) return '待同步 ' + state.pending;
    return state.lastSync ? '已同步' : '已连接云端';
  }

  /* 接口地址可能带查询串（如 ?sharecode=xxx），路径要插在查询串之前 */
  function joinUrl(endpoint, path) {
    var q = '';
    var i = endpoint.indexOf('?');
    if (i >= 0) { q = endpoint.slice(i + 1); endpoint = endpoint.slice(0, i); }
    var params = q ? q.split('&').filter(Boolean) : [];
    /* 部分托管网关会去掉 Authorization 头，令牌额外拼进查询参数 */
    if (state._token && !params.some(function (p) { return p.indexOf('token=') === 0; })) {
      params.push('token=' + encodeURIComponent(state._token));
    }
    var url = endpoint.replace(/\/+$/, '') + path;
    return params.length ? url + '?' + params.join('&') : url;
  }

  function refreshPending() {
    return Store.count('outbox').then(function (n) {
      state.pending = n;
      emit();
      return n;
    });
  }

  function loadConf() {
    return Promise.all([
      Store.metaGet(ENDPOINT_KEY, cfg.endpoint || ''),
      Store.metaGet(TOKEN_KEY, cfg.token || ''),
      Store.metaGet('cloud.cursor', 0),
      Store.metaGet('cloud.lastSync', 0)
    ]).then(function (r) {
      state.endpoint = r[0] || '';
      state._token = r[1] || '';
      state._cursor = r[2] || 0;
      state.lastSync = r[3] || 0;
    });
  }

  /* 把别台设备的改动合并进本地（本地更新的不覆盖） */
  function applyChanges(changes, mine) {
    if (!changes || !changes.length) return Promise.resolve(0);
    var list = changes.filter(function (c) { return !(mine && mine[c.opId]); });
    if (!list.length) return Promise.resolve(0);

    var wantUser = [], wantDel = [], attOps = [];
    list.forEach(function (c) {
      var p = c.payload || {};
      if (c.type === 'user.create') wantUser.push(p);
      else if (c.type === 'user.delete') wantDel.push(p);
      else if (c.type === 'attendance.bulk') attOps.push(c);
    });

    var applied = 0;
    return Store.all('users').then(function (users) {
      var byId = {};
      users.forEach(function (u) { byId[u.id] = u; });
      return Promise.all(wantUser.map(function (p) {
        if (!p.id || byId[p.id] || p.role !== 'student') return null;
        applied++;
        return Store.put('users', {
          id: p.id, role: 'student', name: p.name || '学生',
          account: p.account, no: p.account, classCode: p.classCode,
          title: '', pwd: null, remote: true, createdAt: Date.now()
        });
      }).concat(wantDel.map(function (p) {
        if (!p.id || !byId[p.id]) return null;
        applied++;
        return Store.del('users', p.id);
      })));
    }).then(function () {
      if (!attOps.length) return applied;
      return Store.all('attendance').then(function (rows) {
        var byId = {};
        rows.forEach(function (r) { byId[r.id] = r; });
        var puts = [];
        attOps.forEach(function (c) {
          var p = c.payload || {};
          if (!p.classCode || !p.date || !p.slot) return;
          (p.records || []).forEach(function (rec) {
            if (!rec || !rec.studentId) return;
            var id = p.classCode + '|' + p.date + '|' + p.slot + '|' + rec.studentId;
            var local = byId[id];
            var ts = rec.at || c.ts || Date.now();
            if (local && (local.updatedAt || 0) >= ts) return;
            applied++;
            puts.push({
              id: id, classCode: p.classCode, date: p.date, slot: p.slot,
              studentId: rec.studentId,
              studentName: rec.studentName || (local && local.studentName) || '',
              status: rec.status, by: 'remote', at: ts, updatedAt: ts
            });
          });
        });
        return puts.length ? Store.bulkPut('attendance', puts).then(function () { return applied; }) : applied;
      });
    });
  }

  function createCloud() {
    var api = {
      init: function () {
        return loadConf().then(refreshPending).then(function () {
          global.addEventListener('online', function () {
            state.online = true; state.backoff = 0; state.error = ''; emit();
            api.syncNow();
          });
          global.addEventListener('offline', function () {
            state.online = false; emit();
          });
          api._tick();
          return snapshot();
        });
      },

      _tick: function () {
        clearTimeout(timer);
        var wait = state.backoff ? Math.min(state.backoff, 120000) : (cfg.autoSyncMs || 20000);
        timer = setTimeout(function () {
          api.syncNow().then(function () { api._tick(); });
        }, wait);
      },

      state: snapshot,
      on: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },

      enqueue: function (type, payload) {
        var op = {
          type: type,
          payload: payload,
          ts: Date.now(),
          opId: 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
        };
        return Store.put('outbox', op).then(function () {
          return refreshPending();
        }).then(function () {
          if (state.endpoint && state.online) api.syncNow();
          return op;
        });
      },

      pendingList: function () {
        return Store.all('outbox');
      },

      setEndpoint: function (url, token) {
        var raw = String(url || '').trim();
        var qs = '';
        var qi = raw.indexOf('?');
        if (qi >= 0) { qs = raw.slice(qi); raw = raw.slice(0, qi); }
        state.endpoint = raw.replace(/\/+$/, '') + qs;
        state._token = String(token || '').trim();
        state.error = '';
        state.backoff = 0;
        return Promise.all([
          Store.metaSet(ENDPOINT_KEY, state.endpoint),
          Store.metaSet(TOKEN_KEY, state._token)
        ]).then(function () { emit(); return snapshot(); });
      },

      test: function () {
        if (!state.endpoint) return Promise.resolve({ ok: false, code: 'no-endpoint' });
        return api._post('/ping', { app: 'dianmao', at: Date.now() })
          .then(function (r) { return { ok: true, data: r }; })
          .catch(function (e) { return { ok: false, code: 'network', message: String(e.message || e) }; });
      },

      syncNow: function () {
        if (state.syncing) return Promise.resolve(snapshot());
        if (!state.endpoint) return refreshPending().then(snapshot);
        if (!state.online) return refreshPending().then(snapshot);

        return Store.all('outbox').then(function (ops) {
          if (ops.length) { state.syncing = true; state.error = ''; emit(); }

          return api._post('/sync', {
            app: 'dianmao',
            version: (global.DIANMAO && DIANMAO.version) || '1',
            cursor: state._cursor || 0,
            ops: ops.map(function (o) {
              return { opId: o.opId, type: o.type, payload: o.payload, ts: o.ts };
            })
          }).then(function (res) {
            var accepted = (res && res.accepted) || ops.map(function (o) { return o.opId; });
            var mine = {};
            accepted.forEach(function (id) { mine[id] = 1; });
            return applyChanges(res && res.changes, mine).then(function (applied) {
              state._applied = applied;
              return Promise.all(ops.filter(function (o) {
                return accepted.indexOf(o.opId) >= 0;
              }).map(function (o) { return Store.del('outbox', o.id); })).then(function () {
                state._cursor = (res && res.cursor) || state._cursor;
                state.lastSync = Date.now();
                state.backoff = 0;
                return Promise.all([
                  Store.metaSet('cloud.cursor', state._cursor),
                  Store.metaSet('cloud.lastSync', state.lastSync)
                ]);
              }).then(function () {
                if (applied > 0) {
                  try {
                    global.dispatchEvent(new CustomEvent('dianmao:data', { detail: { applied: applied } }));
                  } catch (e) { }
                }
              });
            });
          }).then(function () {
            state.syncing = false;
            return refreshPending();
          }).then(function () {
            emit();
            return snapshot();
          }).catch(function (err) {
            state.syncing = false;
            state.error = String(err.message || err);
            state.backoff = state.backoff ? Math.min(state.backoff * 2, 120000) : 15000;
            emit();
            return snapshot();
          });
        });
      },

      _post: function (path, body) {
        var ctrl = new AbortController();
        var to = setTimeout(function () { ctrl.abort(); }, 9000);
        var headers = { 'Content-Type': 'application/json' };
        if (state._token) headers['Authorization'] = 'Bearer ' + state._token;

        return fetch(joinUrl(state.endpoint, path), {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: ctrl.signal,
          mode: 'cors',
          credentials: 'omit'
        }).then(function (res) {
          clearTimeout(to);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json().catch(function () { return {}; });
        }).catch(function (e) {
          clearTimeout(to);
          throw e;
        });
      }
    };
    return api;
  }

  global.Cloud = createCloud();
})(window);
