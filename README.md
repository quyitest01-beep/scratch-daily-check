# Panda Scratch 全站性能定时检查

每天自动检测 [panda-scratch.com](https://panda-scratch.com) 全站移动端性能，并将报告推送到飞书群。

## 检测内容

- **公开页面（13个）**：首页、关于、条款、隐私、游戏页面、登录/注册等
- **需登录页面（7个）**：推荐、充值、钱包、提现等

## 性能指标目标

| 指标 | 目标 | 说明 |
|------|------|------|
| Performance | ≥ 60 | Lighthouse 综合评分 |
| FCP | < 2.5s | 首次内容绘制 |
| LCP | < 10.5s | 最大内容绘制 |
| TBT | < 200ms | 总阻塞时间 |
| CLS | < 0.1 | 累积布局偏移 |
| SI | < 3.4s | 速度指数 |

## 测试策略

- 移动端模拟（Moto G4, 慢速 4G）
- Puppeteer 无头浏览器 + Lighthouse
- Supabase API 登录获取认证态

## 定时运行

通过 GitHub Actions 每天北京时间 9:00 自动运行，也支持手动触发。

## 配置

在仓库 Settings → Secrets and variables → Actions 中添加：

- `PANDA_EMAIL` - 登录邮箱
- `PANDA_PASSWORD` - 登录密码

## 本地运行

```bash
npm install
node panda-auth-perf-api-login.js
```

或指定账号：

```bash
PANDA_EMAIL=user@test.com PANDA_PASSWORD=123456 node panda-auth-perf-api-login.js
```
