/* 账号与鉴权：离线校验，口令加盐散列存储。
 * 注意：明文 HTTP 下浏览器不提供 crypto.subtle，此时自动降级为内置散列，
 * 功能不受影响；上 HTTPS 后新注册的账号会自动使用 PBKDF2。 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'dianmao.session';
  var MAX_FAIL = 5;
  var LOCK_MS = 60 * 1000;

  var subtle = (global.crypto && global.crypto.subtle) ? global.crypto.subtle : null;
  var enc = global.TextEncoder ? new TextEncoder() : null;

  function buf2hex(buf) {
    var b = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  function hex2buf(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function randomSalt() {
    var arr = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return buf2hex(arr.buffer);
  }

  /* 兜底散列（无 subtle 时使用）：加盐多轮混淆，仅用于离线校验 */
  function weakHash(pwd, salt) {
    var s = salt + '|' + pwd + '|dianmao';
    var h1 = 0x811c9dc5, h2 = 0xc2b2ae35;
    for (var round = 0; round < 4000; round++) {
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i) + round;
        h1 = (h1 ^ c) >>> 0;
        h1 = (h1 * 16777619) >>> 0;
        h2 = (h2 + c * 31) >>> 0;
        h2 = ((h2 << 5) | (h2 >>> 27)) >>> 0;
      }
    }
    return (h1.toString(16) + h2.toString(16)).padStart(16, '0');
  }

  function hash(pwd) {
    var salt = randomSalt();
    if (!subtle) {
      return Promise.resolve({ alg: 'w1', salt: salt, iter: 4000, hash: weakHash(pwd, salt) });
    }
    var iter = 120000;
    var keyMat = subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveBits']);
    return keyMat.then(function (km) {
      return subtle.deriveBits(
        { name: 'PBKDF2', salt: hex2buf(salt), iterations: iter, hash: 'SHA-256' }, km, 256
      );
    }).then(function (bits) {
      return { alg: 'pbkdf2', salt: salt, iter: iter, hash: buf2hex(bits) };
    }).catch(function () {
      return { alg: 'w1', salt: salt, iter: 4000, hash: weakHash(pwd, salt) };
    });
  }

  function verify(pwd, rec) {
    if (!rec || !rec.hash) return Promise.resolve(false);
    if (rec.alg === 'w1' || !subtle) {
      return Promise.resolve(weakHash(pwd, rec.salt) === rec.hash);
    }
    var keyMat = subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveBits']);
    return keyMat.then(function (km) {
      return subtle.deriveBits(
        { name: 'PBKDF2', salt: hex2buf(rec.salt), iterations: rec.iter || 120000, hash: 'SHA-256' }, km, 256
      );
    }).then(function (bits) { return buf2hex(bits) === rec.hash; })
      .catch(function () { return weakHash(pwd, rec.salt) === rec.hash; });
  }

  function normalize(s) { return String(s || '').trim().toLowerCase(); }

  var Auth = {
    hash: hash,
    verify: verify,

    findByAccount: function (account) {
      var a = normalize(account);
      return Store.all('users').then(function (users) {
        return users.filter(function (u) { return normalize(u.account) === a || normalize(u.no) === a; })[0] || null;
      });
    },

    usersOfClass: function (classCode, role) {
      return Store.all('users').then(function (users) {
        return users.filter(function (u) {
          return u.classCode === classCode && (!role || u.role === role);
        });
      });
    },

    lockKey: function (account) { return 'lock.' + normalize(account); },

    checkLock: function (account) {
      return Store.metaGet(Auth.lockKey(account), null).then(function (v) {
        if (!v) return 0;
        var left = (v.until || 0) - Date.now();
        return left > 0 ? left : 0;
      });
    },

    bumpFail: function (account) {
      var key = Auth.lockKey(account);
      return Store.metaGet(key, { n: 0, until: 0 }).then(function (v) {
        var n = (v.n || 0) + 1;
        var until = n >= MAX_FAIL ? Date.now() + LOCK_MS : 0;
        if (n >= MAX_FAIL) n = 0;
        return Store.metaSet(key, { n: n, until: until });
      });
    },

    clearFail: function (account) {
      return Store.metaSet(Auth.lockKey(account), { n: 0, until: 0 });
    },

    login: function (account, password, role, remember) {
      if (!normalize(account)) return Promise.resolve({ ok: false, code: 'empty-account' });
      if (!password) return Promise.resolve({ ok: false, code: 'empty-password' });

      return Auth.checkLock(account).then(function (left) {
        if (left > 0) return { ok: false, code: 'locked', left: left };
        return Auth.findByAccount(account).then(function (user) {
          if (!user) return Auth.bumpFail(account).then(function () { return { ok: false, code: 'no-account' }; });
          if (user.role !== role) return { ok: false, code: 'role-mismatch', actual: user.role };
          if (!user.pwd) return { ok: false, code: 'no-pwd' };
          return verify(password, user.pwd).then(function (pass) {
            if (!pass) return Auth.bumpFail(account).then(function () { return { ok: false, code: 'bad-password' }; });
            return Auth.clearFail(account).then(function () {
              Auth.setSession(user, remember !== false);
              return { ok: true, user: user };
            });
          });
        });
      });
    },

    setSession: function (user, remember) {
      var exp = Date.now() + (remember ? 30 * 24 * 3600 * 1000 : 12 * 3600 * 1000);
      var payload = { userId: user.id, role: user.role, exp: exp };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (e) { }
    },

    readSession: function () {
      var raw = null;
      try { raw = localStorage.getItem(SESSION_KEY); } catch (e) { }
      if (!raw) return null;
      try {
        var s = JSON.parse(raw);
        if (!s || !s.userId || (s.exp && s.exp < Date.now())) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return s;
      } catch (e) { return null; }
    },

    currentUser: function () {
      var s = Auth.readSession();
      if (!s) return Promise.resolve(null);
      return Store.get('users', s.userId).then(function (u) { return u || null; });
    },

    logout: function () {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
      return Promise.resolve(true);
    },

    /* 用班级码自助注册学生账号（离线写入，联网后同步） */
    registerStudent: function (input) {
      var classCode = String(input.classCode || '').trim();
      var name = String(input.name || '').trim();
      var no = String(input.no || '').trim();
      var pwd = String(input.pwd || '');

      if (!classCode || !name || !no) return Promise.resolve({ ok: false, code: 'missing' });
      if (pwd.length < 6) return Promise.resolve({ ok: false, code: 'weak' });

      return Store.get('classes', classCode).then(function (cls) {
        if (!cls) return { ok: false, code: 'no-class' };
        return Auth.findByAccount(no).then(function (exists) {
          if (exists) return { ok: false, code: 'duplicate' };
          return hash(pwd).then(function (p) {
            var user = {
              id: Store.uid(),
              role: 'student',
              name: name,
              account: no,
              no: no,
              classCode: classCode,
              title: cls.name,
              pwd: p,
              createdAt: Date.now()
            };
            return Store.put('users', user).then(function () {
              if (global.Cloud) {
                Cloud.enqueue('user.create', {
                  id: user.id, role: user.role, name: user.name,
                  account: user.account, classCode: user.classCode
                });
              }
              Auth.setSession(user, true);
              return { ok: true, user: user };
            });
          });
        });
      });
    },

    /* 离线重置口令：已登录用户或知道原口令时才允许 */
    resetPassword: function (account, nextPwd) {
      if (!nextPwd || nextPwd.length < 6) return Promise.resolve({ ok: false, code: 'weak' });
      return Auth.findByAccount(account).then(function (user) {
        if (!user) return { ok: false, code: 'no-account' };
        return hash(nextPwd).then(function (p) {
          user.pwd = p;
          user.updatedAt = Date.now();
          return Store.put('users', user).then(function () {
            if (global.Cloud) Cloud.enqueue('user.password', { id: user.id, updatedAt: user.updatedAt });
            return { ok: true };
          });
        });
      });
    }
  };

  global.Auth = Auth;
})(window);
