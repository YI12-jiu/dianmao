# 点卯 · 课堂考勤工作台

按 `http://39.96.199.164/app.html`（考勤工作台网页版）的功能脉络重做的登录入口与双端工作台：
老师端点名、学生端签到，离线可用，联网自动回传云端。

**线上地址：<https://yi12-jiu.github.io/dianmao/>** · 仓库：<https://github.com/YI12-jiu/dianmao>

> GitHub Pages 是纯静态托管：HTTPS 下 Service Worker 正常注册，**完全断网也能打开和点名**。
> 但它跑不了 Node，所以云端同步由独立的同步服务承担，已经部署好并写进 `assets/js/config.js` 的默认值：
> **<https://dianmao-sync.app.workbuddy.host/?sharecode=SVNQA3BL4F>**
> 打开页面就能直接同步，不用填任何地址；老师端「设置」里也能改掉它。
>
> 也可以把 `sync-service/` 部署到自己的机器，把 `config.js` 里的 `endpoint` 换成你的地址：
> 一台有 HTTPS 的机器（见下文「部署到服务器」），再把接口地址填进老师端设置里。
> 注意：HTTPS 页面不能调用 http:// 接口，接口地址也必须是 https。

## 快速开始

```bash
# 任选一种静态服务器
python -m http.server 8777
# 或 npx serve .
```

打开 `http://127.0.0.1:8777/index.html`。

首次打开会自动写入 **15 位老师、15 个班、92 名学生**（全部在本机，离线可用）。口令统一为 `123456`。

| 账号 | 姓名 | 班级 | 班级码 | 学科 | 名单 |
|---|---|---|---|---|---|
| `t1001` | 王砚秋 | 高一（3）班 | `880123` | 语文 | 8 |
| `t1002` | 李清和 | 高一（1）班 | `880124` | 数学 | 6 |
| `t1003` | 陈知远 | 高一（2）班 | `880125` | 英语 | 6 |
| `t1004` | 周砚舟 | 高一（4）班 | `880126` | 物理 | 6 |
| `t1005` | 沈书棠 | 高一（5）班 | `880127` | 化学 | 6 |
| `t1006` | 许南枝 | 高一（6）班 | `880128` | 生物 | 6 |
| `t1007` | 林见山 | 高一（7）班 | `880129` | 历史 | 6 |
| `t1008` | 苏晚舟 | 高二（1）班 | `880130` | 地理 | 6 |
| `t1009` | 顾清川 | 高二（2）班 | `880131` | 政治 | 6 |
| `t1010` | 何岑 | 高二（3）班 | `880132` | 语文 | 6 |
| `t1011` | 江照白 | 高二（4）班 | `880133` | 数学 | 6 |
| `t1012` | 闻雪 | 高三（1）班 | `880134` | 英语 | 6 |
| `t1013` | 段云起 | 高三（2）班 | `880135` | 物理 | 6 |
| `t1014` | 白露 | 高三（3）班 | `880136` | 化学 | 6 |
| `t1015` | 温言 | 高三（4）班 | `880137` | 生物 | 6 |

- 每位老师对应一个独立班级，互不干扰，名单可直接点名。
- 学生账号是 `2026001` 到 `2026092`，按班级顺序分配，口令同为 `123456`。
  例如高一（1）班的 6 人是 `2026009` 至 `2026014`。
- 也支持学生自助注册：登录页「用班级码加入」，填班级码 + 姓名 + 学号 + 自设口令。
- 完整清单见 [`教师账号清单.csv`](教师账号清单.csv)。

## 页面

| 文件 | 作用 |
|---|---|
| `index.html` | 登录页：老师端 / 学生端切换、记住设备、忘记口令、班级码加入、离线与同步状态 |
| `teacher.html` | 老师端：点名册、统计、学生名单、云端设置 |
| `student.html` | 学生端：今日签到、我的记录、课表 |
| `assets/css/` | `tokens.css` 设计令牌，`login.css` 登录页，`app.css` 工作台 |
| `assets/js/` | `config.js` 配置，`db.js` 本地库，`auth.js` 鉴权，`cloud.js` 同步，`ui.js` 通用件 |
| `sw.js` / `manifest.webmanifest` | 离线缓存与安装到桌面 |
| `sync-service/` | 云端同步服务（零依赖 Node），可直接发布或部署 |

## 角色区分

- 登录时必须选择老师端或学生端。账号若属于另一端，会提示并自动切换，避免「对了口令却进错门」。
- 老师只能进 `teacher.html`，学生只能进 `student.html`，跨端访问会被 `UI.guard()` 弹回自己的页面。
- 学生只读取 `studentId === 自己学号` 的记录，拿不到全班数据。

## 离线怎么工作

1. 所有写操作先落 **IndexedDB**（环境不支持时自动退回 localStorage 快照），页面渲染只读本地。
2. 每次写操作同时进 `outbox` 队列，队列项带 `opId`，服务端可据此幂等去重。
3. 有网络且配置了接口地址时，`cloud.js` 每 20 秒尝试回传一次，失败按 15s / 30s / 60s 退避重试，不阻塞任何操作。
4. `sw.js` 预缓存全部外壳文件，断网冷启动也能打开（**需要 https 或 localhost**）。

> 纯 IP + http 环境下浏览器不允许注册 Service Worker，此时应用仍可正常登录、点名、查记录，只是无法在完全关闭浏览器后离线打开。要完整离线能力，请配 HTTPS（见下文）。

## 多设备怎么同步

同步是双向的：

- **上行**：本机操作进 `outbox`，联网后批量推送。
- **下行**：服务端把「你上次同步游标之后、且不是你刚提交的」改动回推，客户端合并进本机。
  合并规则保守：本地记录比云端新就不覆盖。
- 学生在自己手机用班级码注册后，老师端下一次同步就能在「学生」里看到这个人和一条
  `待激活` 标记（口令在学生本人设备上，老师这边只拿到名单）。
- 老师正在点名且未保存时，云端改动不会打断你，只提示「先保存当前点名再看」。

## 接上你自己的云端

默认是「本地模式」：数据只在这台设备。两步开启同步：

1. 老师端 → 设置 → 云端同步，填接口地址（例如 `https://你的域名/api/attendance`），可选填 Token，保存。
2. 后端实现下面两个接口即可。

### 接口契约

`POST {endpoint}/ping`

```json
{ "app": "dianmao", "at": 1730000000000 }
```
返回 `{ "ok": true }` 即视为可达。用于「测试连接」。

`POST {endpoint}/sync`

```json
{
  "app": "dianmao",
  "version": "1.0.0",
  "cursor": 128,
  "ops": [
    {
      "opId": "op-m3k9-8f2a1c",
      "type": "attendance.bulk",
      "ts": 1730000000000,
      "payload": {
        "classCode": "880123",
        "date": "2026-11-07",
        "slot": "第 1 节",
        "records": [{ "studentId": "2026001", "status": "present", "at": 1730000000000 }],
        "removed": []
      }
    }
  ]
}
```

成功返回：

```json
{
  "ok": true,
  "accepted": ["op-m3k9-8f2a1c"],
  "cursor": 129,
  "changes": [
    { "seq": 129, "opId": "op-x7k2", "type": "user.create",
      "ts": 1730000001000,
      "payload": { "id": "u-...", "role": "student", "name": "张小明",
                   "account": "2026099", "classCode": "880123" } }
  ]
}
```

- `accepted` 里的 `opId` 会从本地队列删除；未确认的留待下轮重试。
- `cursor` 由服务端自增，前端下次把它原样回传。
- `changes` 可选。返回「客户端游标之后、且不在本次 accepted 里」的改动，客户端会合并进本机。
  不实现它就退化为纯备份：数据只上传，多端不互通。
- 请求头会带 `Authorization: Bearer <Token>`（填了 Token 时）。

### 事件类型

| type | payload 关键字段 |
|---|---|
| `attendance.bulk` | `classCode` `date` `slot` `records[]` `removed[]` |
| `user.create` | `id` `role` `name` `account` `classCode` |
| `user.delete` | `id` `account` `classCode` |
| `user.password` | `id` `updatedAt` |

### 本地跑通链路

```bash
node sync-service/server.js        # http://127.0.0.1:8788
```

然后在设置里把接口地址填成 `http://127.0.0.1:8788`，保存后点「测试连接」。
记录会落到 `server/data/ops-YYYY-MM-DD.jsonl`，一天一个文件。
`TOKEN=abc node sync-service/server.js` 可开启令牌校验。

## 部署到服务器

### 方式一：一条命令（推荐，Linux + nginx）

把整个目录传到服务器（`scp -r . root@IP:/root/dianmao`），然后：

```bash
cd /root/dianmao
sudo bash deploy/install.sh
```

它做四件事，都不动你已有的站点：

1. 静态文件复制到 `/var/www/dianmao`，对外挂在 `http://你的IP/dianmao/` 子路径下；
2. 同步服务（`sync-service/`）复制到 `/opt/dianmao`，注册为 systemd 服务 `dianmao-sync`，只监听 `127.0.0.1:8788`；
3. 写 `/etc/nginx/conf.d/dianmao.conf`（含 `/dianmao/api/` 反代），`nginx -t` 通过后 reload；
4. 顺手把部署副本里 `config.js` 的接口地址指到同源 `/dianmao/api`，所以前端不需要你手动填地址。

常用参数：

```bash
sudo bash deploy/install.sh --prefix /kaoqin      # 换访问路径
sudo bash deploy/install.sh --token 你的口令       # 接口加 Bearer 校验（不给会随机生成一个并打印）
sudo bash deploy/install.sh --static-only         # 只放静态站，不起同步服务
```

同步服务状态与日志：

```bash
systemctl status dianmao-sync
journalctl -u dianmao-sync -f
ls /opt/dianmao/data            # 每天的 ops-YYYY-MM-DD.jsonl
```

### 方式二：只有宝塔 / FTP 面板

上传 `dist/dianmao-site.zip`，解压到一个子目录（例如 `dianmao`），访问 `http://你的域名/dianmao/` 即可。
这种方式下没有云端同步，前端处于本地模式；想开同步再单独跑 `node sync-service/server.js` 并把接口地址填成它。

### 方式三：只放静态文件

整目录丢进任意站点子目录即可，纯静态无构建。注意所有路径都是相对路径，放子目录不需要改任何东西。

配了 HTTPS 后，离线缓存在首次访问时自动生效。改过前端文件后记得把 `sw.js` 里的 `VERSION` 改个号，否则老用户会拿到缓存里的旧壳。

### 安全提醒

- 现用的托管同步服务带一个**共享令牌**（写在 `config.js` 和 `sync-service/package.json` 里）。它只能挡掉随手扫的脚本，
  挡不住愿意读源码的人；而且这个仓库是公开的。真要给真实班级长期用，请换到自有域名 + 自己的鉴权。
- 同步数据落在托管环境的文件系统里（`sync-service/data/*.jsonl`），重新发布这个服务时可能重建目录。
  需要长期留存请导出备份，或换成云数据库。
- 同步服务默认只监听 `127.0.0.1`，通过 nginx 的 `/dianmao/api/` 暴露，别直接 `0.0.0.0:8788` 对外。
- 自建时务必配 `--token`，否则任何人知道地址就能往接口写数据。
- 一定要上 HTTPS。没有 HTTPS，口令散列会降级，Service Worker 也不会注册，离线能力等于没有。

## 安全边界

- 口令以加盐散列存储，不存明文。HTTPS 下用 PBKDF2-SHA256（12 万轮）。
- 明文 HTTP 下浏览器不提供 `crypto.subtle`，会降级为内置散列。**这不是生产级强度**，只用于离线演示与内网；正式上线请配 HTTPS。
- 连续 5 次输错锁定 60 秒，计数存在本地。
- 前端校验只解决「谁能进哪个门」。真实防篡改需要后端校验 Token 并把权限写进接口。

## 导出备份

老师端 → 设置 → 导出备份，得到一个 JSON（班级、账号、课表、全部考勤记录），可用于换设备或离线归档。

## 开发脚本（可选）

`scripts/shot.js` 截图回归，`scripts/sync-test.js` 同步链路测试。它们依赖 `playwright-core`：

```bash
npm i --no-save playwright-core@1.49.1
node scripts/sync-test.js
```

不装也不影响应用本身运行。
