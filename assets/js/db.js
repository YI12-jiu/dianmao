/* 本地数据层：优先 IndexedDB，不可用时退回 localStorage 快照。
 * 所有读写都在本地完成，断网照常工作。 */
(function (global) {
  'use strict';

  var DB_NAME = 'dianmao';
  var DB_VER = 1;
  var KEY_PATH = {
    users: 'id',
    classes: 'code',
    attendance: 'id',
    courses: 'id',
    outbox: 'id',
    meta: 'key'
  };
  var FALLBACK_KEY = 'dianmao.fallback.v1';

  var _db = null;
  var _fallback = null;
  var _ready = null;

  /* ---------- fallback（无 IndexedDB 时） ---------- */
  function loadFallback() {
    if (_fallback) return _fallback;
    var raw = null;
    try { raw = localStorage.getItem(FALLBACK_KEY); } catch (e) { }
    var base = {};
    Object.keys(KEY_PATH).forEach(function (s) { base[s] = {}; });
    try { _fallback = raw ? Object.assign(base, JSON.parse(raw)) : base; } catch (e) { _fallback = base; }
    return _fallback;
  }
  function saveFallback() {
    try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(_fallback)); } catch (e) { }
  }
  function fbKey(store, k) { return String(k); }

  /* ---------- IndexedDB ---------- */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('no-idb'));
      var req = global.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (ev) {
        var db = req.result;
        Object.keys(KEY_PATH).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var os = db.createObjectStore(name, { keyPath: KEY_PATH[name], autoIncrement: name === 'outbox' });
            if (name === 'attendance') {
              os.createIndex('by_class', 'classCode', { unique: false });
              os.createIndex('by_class_date', ['classCode', 'date'], { unique: false });
            }
            if (name === 'users') os.createIndex('by_role', 'role', { unique: false });
          }
        });
        if (ev.oldVersion < 1) { /* 首版无需迁移 */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
      req.onblocked = function () { reject(new Error('idb-blocked')); };
    });
  }

  function tx(store, mode) {
    return _db.transaction(store, mode).objectStore(store);
  }
  function wrap(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var Store = {
    isFallback: false,

    ready: function () {
      if (_ready) return _ready;
      _ready = openIDB().then(function (db) {
        _db = db;
        return true;
      }).catch(function () {
        Store.isFallback = true;
        loadFallback();
        return false;
      });
      return _ready;
    },

    get: function (store, key) {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          var s = loadFallback()[store] || {};
          return s[fbKey(store, key)] || null;
        }
        return wrap(tx(store, 'readonly').get(key)).then(function (v) { return v || null; });
      });
    },

    all: function (store) {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          var s = loadFallback()[store] || {};
          return Object.keys(s).map(function (k) { return s[k]; });
        }
        return wrap(tx(store, 'readonly').getAll());
      });
    },

    put: function (store, value) {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          var s = loadFallback();
          var k = value[KEY_PATH[store]];
          if (store === 'outbox' && k == null) {
            k = (Store._seq = (Store._seq || 0) + 1, Date.now() + '_' + Store._seq);
            value.id = k;
          }
          s[store][String(k)] = value;
          saveFallback();
          return value;
        }
        return wrap(tx(store, 'readwrite').put(value)).then(function () { return value; });
      });
    },

    bulkPut: function (store, list) {
      if (!list || !list.length) return Promise.resolve(list);
      return Store.ready().then(function () {
        if (Store.isFallback) {
          var s = loadFallback();
          list.forEach(function (v) {
            var k = v[KEY_PATH[store]];
            if (store === 'outbox' && k == null) {
              k = (Store._seq = (Store._seq || 0) + 1, Date.now() + '_' + Store._seq);
              v.id = k;
            }
            s[store][String(k)] = v;
          });
          saveFallback();
          return list;
        }
        return new Promise(function (resolve, reject) {
          var t = _db.transaction(store, 'readwrite');
          var os = t.objectStore(store);
          list.forEach(function (v) { os.put(v); });
          t.oncomplete = function () { resolve(list); };
          t.onerror = function () { reject(t.error); };
        });
      });
    },

    del: function (store, key) {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          var s = loadFallback();
          delete s[store][String(key)];
          saveFallback();
          return true;
        }
        return wrap(tx(store, 'readwrite').delete(key)).then(function () { return true; });
      });
    },

    count: function (store) {
      return Store.ready().then(function () {
        if (Store.isFallback) return Object.keys(loadFallback()[store] || {}).length;
        return wrap(tx(store, 'readonly').count());
      });
    },

    /* 复合索引查询：某班某天的记录 */
    attendanceOf: function (classCode, date) {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          return Store.all('attendance').then(function (rows) {
            return rows.filter(function (r) { return r.classCode === classCode && (!date || r.date === date); });
          });
        }
        return new Promise(function (resolve, reject) {
          var os = _db.transaction('attendance', 'readonly').objectStore('attendance');
          var req;
          if (date) {
            var range = IDBKeyRange.bound([classCode, date], [classCode, date + '\uffff']);
            req = os.index('by_class_date').getAll(range);
          } else {
            req = os.index('by_class').getAll(IDBKeyRange.only(classCode));
          }
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    metaGet: function (key, dflt) {
      return Store.get('meta', key).then(function (v) { return v ? v.value : dflt; });
    },
    metaSet: function (key, value) {
      return Store.put('meta', { key: key, value: value });
    },

    wipe: function () {
      return Store.ready().then(function () {
        if (Store.isFallback) {
          _fallback = null;
          try { localStorage.removeItem(FALLBACK_KEY); } catch (e) { }
          loadFallback();
          return true;
        }
        return Promise.all(Object.keys(KEY_PATH).map(function (s) {
          return wrap(tx(s, 'readwrite').clear());
        }));
      });
    },

    uid: function () {
      if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    }
  };

  /* ---------- 演示数据（15 位老师，各自一个班） ---------- */
  var SEED_CLASSES = [
    { code: '880123', name: '高一（3）班', subject: '语文' },
    { code: '880124', name: '高一（1）班', subject: '数学' },
    { code: '880125', name: '高一（2）班', subject: '英语' },
    { code: '880126', name: '高一（4）班', subject: '物理' },
    { code: '880127', name: '高一（5）班', subject: '化学' },
    { code: '880128', name: '高一（6）班', subject: '生物' },
    { code: '880129', name: '高一（7）班', subject: '历史' },
    { code: '880130', name: '高二（1）班', subject: '地理' },
    { code: '880131', name: '高二（2）班', subject: '政治' },
    { code: '880132', name: '高二（3）班', subject: '语文' },
    { code: '880133', name: '高二（4）班', subject: '数学' },
    { code: '880134', name: '高三（1）班', subject: '英语' },
    { code: '880135', name: '高三（2）班', subject: '物理' },
    { code: '880136', name: '高三（3）班', subject: '化学' },
    { code: '880137', name: '高三（4）班', subject: '生物' }
  ];

  var SEED_TEACHERS = [
    { account: 't1001', name: '王砚秋' },
    { account: 't1002', name: '李清和' },
    { account: 't1003', name: '陈知远' },
    { account: 't1004', name: '周砚舟' },
    { account: 't1005', name: '沈书棠' },
    { account: 't1006', name: '许南枝' },
    { account: 't1007', name: '林见山' },
    { account: 't1008', name: '苏晚舟' },
    { account: 't1009', name: '顾清川' },
    { account: 't1010', name: '何岑' },
    { account: 't1011', name: '江照白' },
    { account: 't1012', name: '闻雪' },
    { account: 't1013', name: '段云起' },
    { account: 't1014', name: '白露' },
    { account: 't1015', name: '温言' }
  ];

  /* 一号班的名单保留原来的 8 人，其余班级各 6 人 */
  var SEED_ROSTER_1 = ['林知远', '沈书鹤', '许清和', '周雨桐', '顾明澈', '陈叙白', '苏见月', '何砚舟'];
  var NAME_POOL = [
    '张望舒', '李怀瑾', '王与安', '赵南屿', '钱思远', '孙牧野',
    '周砚清', '吴子墨', '郑听白', '王行舟', '冯知微', '陈叠',
    '褚临川', '卫松月', '蒋见微', '韩青芜', '杨叙白', '朱望之',
    '秦照', '尤亦白', '许棠', '何遇', '陆时', '谢知非'
  ];

  var COURSE_TOPICS = ['古诗文精读', '现代文阅读', '随堂练习', '单元讲评', '答疑', '限时训练'];
  var COURSE_SLOTS = [
    { weekday: 1, slot: '第 1 节' },
    { weekday: 1, slot: '第 3 节' },
    { weekday: 2, slot: '第 2 节' },
    { weekday: 3, slot: '第 1 节' },
    { weekday: 4, slot: '第 4 节' },
    { weekday: 5, slot: '第 2 节' }
  ];

  function dateStr(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function shiftDays(n) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d;
  }

  /* 只给一号班造历史，其他班从空白开始，老师自己点名 */
  function buildSeedAttendance(teacherId) {
    var rows = [];
    var made = 0;
    var classCode = SEED_CLASSES[0].code;
    for (var back = 1; made < 5 && back < 30; back++) {
      var d = shiftDays(-back);
      var wd = d.getDay();
      if (wd === 0 || wd === 6) continue;
      made++;
      var date = dateStr(d);
      SEED_ROSTER_1.forEach(function (name, i) {
        var no = '2026' + String(i + 1).padStart(3, '0');
        var seed = (back * 37 + i * 13) % 23;
        var status = seed === 0 ? 'absent' : seed === 7 ? 'late' : 'present';
        rows.push({
          id: classCode + '|' + date + '|第 1 节|' + no,
          classCode: classCode,
          date: date,
          slot: '第 1 节',
          studentId: no,
          studentName: name,
          status: status,
          by: teacherId,
          at: d.getTime() + 8 * 3600 * 1000,
          updatedAt: d.getTime()
        });
      });
    }
    return rows;
  }

  function buildSeedData(now, pwd) {
    var users = [], classes = [], courses = [];
    var seq = 0;

    SEED_CLASSES.forEach(function (cls, ci) {
      var teacher = SEED_TEACHERS[ci];
      classes.push({ code: cls.code, name: cls.name, subject: cls.subject, createdAt: now });
      users.push({
        id: 'u-teacher-' + (ci + 1),
        role: 'teacher',
        name: teacher.name,
        account: teacher.account,
        no: teacher.account.toUpperCase(),
        classCode: cls.code,
        title: cls.subject + '教师 · ' + cls.name,
        pwd: pwd,
        createdAt: now
      });

      var roster;
      if (ci === 0) {
        roster = SEED_ROSTER_1.slice();
      } else {
        roster = [];
        for (var k = 0; k < 6; k++) roster.push(NAME_POOL[((ci - 1) * 6 + k) % NAME_POOL.length]);
      }

      roster.forEach(function (name) {
        seq += 1;
        var no = '2026' + String(seq).padStart(3, '0');
        users.push({
          id: 'u-student-' + no,
          role: 'student',
          name: name,
          account: no,
          no: no,
          classCode: cls.code,
          title: cls.name,
          pwd: pwd,
          createdAt: now
        });
      });

      COURSE_TOPICS.forEach(function (topic, i) {
        courses.push({
          id: cls.code + '-c' + i,
          classCode: cls.code,
          weekday: COURSE_SLOTS[i].weekday,
          slot: COURSE_SLOTS[i].slot,
          name: cls.subject + ' · ' + topic,
          room: '东教学楼 ' + (301 + ci)
        });
      });
    });

    return { users: users, classes: classes, courses: courses };
  }

  Store.SEED_VERSION = 2;

  Store.seed = function () {
    return Store.ready()
      .then(function () { return Store.metaGet('seedVersion', 0); })
      .then(function (v) {
        if (v >= Store.SEED_VERSION) return false;
        return Auth.hash('123456').then(function (pwd) {
          var data = buildSeedData(Date.now(), pwd);
          return Store.bulkPut('users', data.users)
            .then(function () { return Store.bulkPut('classes', data.classes); })
            .then(function () { return Store.bulkPut('courses', data.courses); })
            .then(function () { return Store.count('attendance'); })
            .then(function (n) {
              return n ? null : Store.bulkPut('attendance', buildSeedAttendance('u-teacher-1'));
            })
            .then(function () { return Store.metaSet('seedVersion', Store.SEED_VERSION); })
            .then(function () { return Store.metaSet('seeded', true); })
            .then(function () { return true; });
        });
      });
  };

  Store.dateStr = dateStr;
  Store.shiftDays = shiftDays;
  Store.SEED_CLASS = SEED_CLASSES[0];
  Store.SEED_CLASSES = SEED_CLASSES;
  Store.SEED_TEACHERS = SEED_TEACHERS;



  global.Store = Store;
})(window);
