/* 站点配置：部署后只需要改这一个文件 */
window.DIANMAO = {
  /* 产品 */
  name: '点卯',
  subtitle: '课堂考勤工作台',
  version: '1.0.0',

  /* 云端同步：填上你自己的接口地址即可（留空 = 纯本地模式，功能不受影响）
   * 接口契约见 README.md「云端同步契约」 */
  cloud: {
    /* 已部署的同步服务；换成你自己的地址即可覆盖。
     * 带 ?sharecode= 是托管平台的访问参数，换成自有域名时不需要。 */
    endpoint: 'https://dianmao-sync.app.workbuddy.host?sharecode=SVNQA3BL4F',
    /* 共享令牌，只挡随手扫描，不是真正的身份验证。认真用于教学请上 HTTPS 域名 + 真实鉴权。 */
    token: 'v9UnVgKQANfdUzRoTy8QgxU7',
    autoSyncMs: 20000      // 有网络时每隔多久尝试回传一次
  },

  /* 演示数据：首次打开会自动写入一个班级 8 位学生 + 1 位老师 */
  seedDemo: true
};
