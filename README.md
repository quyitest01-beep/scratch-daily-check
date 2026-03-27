# 全站性能定时检查

每天自动检测全站移动端性能，并将报告推送到飞书群。

## 环境

| 环境 | 域名 | 脚本 | 飞书群 |
|------|------|------|--------|
| 预发布 | panda-scratch.com | panda-auth-perf-api-login.js | 预发布群 |
| 正式 | fortuna.fast | fortuna-perf-check.js | 正式群 |

两个环境并行运行，互不影响。

## 检测内容

- 公开页面（13个）：首页、关于、条款、隐私、游戏页面、登录/注册等
- 需登录页面（7个）：推荐、充值、钱包、提现等

## 性能指标目标

| 指标 | 默认值 | 说明 |
|------|--------|------|
| Performance | ≥ 60 | Lighthouse 综合评分 |
| FCP | < 2500ms | 首次内容绘制 |
| LCP | < 10500ms | 最大内容绘制 |
| TBT | < 200ms | 总阻塞时间 |
| CLS | < 0.1 | 累积布局偏移 |
| SI | < 3400ms | 速度指数 |

指标达标值可通过 GitHub Variables 修改，无需改代码。

## 定时运行

通过 GitHub Actions 每天北京时间 9:00 自动运行，支持手动触发。

## 配置

### Secrets（Settings → Secrets and variables → Actions → Secrets）

| Name | 说明 |
|------|------|
| `PANDA_EMAIL` | 预发布环境登录邮箱 |
| `PANDA_PASSWORD` | 预发布环境登录密码 |
| `FORTUNA_EMAIL` | 正式环境登录邮箱 |
| `FORTUNA_PASSWORD` | 正式环境登录密码 |
| `STAGING_FEISHU_WEBHOOK` | 预发布环境飞书群 webhook 地址 |
| `PROD_FEISHU_WEBHOOK` | 正式环境飞书群 webhook 地址 |

### Variables（Settings → Secrets and variables → Actions → Variables）

| Name | 默认值 | 说明 |
|------|--------|------|
| `TARGET_PERFORMANCE` | 60 | Performance 最低分 |
| `TARGET_FCP` | 2500 | FCP 阈值（毫秒） |
| `TARGET_LCP` | 10500 | LCP 阈值（毫秒） |
| `TARGET_TBT` | 200 | TBT 阈值（毫秒） |
| `TARGET_CLS` | 0.1 | CLS 阈值 |
| `TARGET_SI` | 3400 | SI 阈值（毫秒） |

不配置 Variables 时使用脚本内的默认值。

## 本地运行

```bash
npm install

# 预发布环境
node panda-auth-perf-api-login.js

# 正式环境
node fortuna-perf-check.js
```
