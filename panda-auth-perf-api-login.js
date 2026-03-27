#!/usr/bin/env node
/**
 * Panda Scratch 全站移动端性能检查脚本
 * 使用 Supabase API 登录 + Puppeteer + Lighthouse
 * 
 * 安装依赖: npm install puppeteer lighthouse
 * 使用方法: 
 *   node panda-auth-perf-api-login.js
 *   PANDA_EMAIL=user@test.com PANDA_PASSWORD=pass node panda-auth-perf-api-login.js
 */

const puppeteer = require('puppeteer');
const lighthouseModule = require('lighthouse');
const lighthouse = lighthouseModule.default || lighthouseModule;
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 配置
const CONFIG = {
  baseUrl: 'https://panda-scratch.com',
  supabaseUrl: 'https://xtgtlzmpqydwxitcqyst.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0Z3Rsem1wcXlkd3hpdGNxeXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MDQ2MTcsImV4cCI6MjA4NDQ4MDYxN30.iXVU6LmwHJKqqRUdot6O-bi1M68GekRtUzwHVM4OJHI',
  credentials: {
    email: process.env.PANDA_EMAIL || 'ptest3@test.com',
    password: process.env.PANDA_PASSWORD || '11111111'
  }
};

// 公开页面（无需登录）
const PUBLIC_PAGES = [
  { name: '首页', path: '/' },
  { name: '个人资料', path: '/profile' },
  { name: '关于', path: '/about' },
  { name: '条款', path: '/terms' },
  { name: '隐私', path: '/privacy' },
  { name: '奖励条款', path: '/bonus-terms' },
  { name: '游戏-vibe-beleza', path: '/play/vibe-beleza' },
  { name: '游戏-festa-das-motos', path: '/play/festa-das-motos' },
  { name: '游戏-premio-tech', path: '/play/premio-tech' },
  { name: '游戏-pix-na-hora', path: '/play/pix-na-hora' },
  { name: '登录页', path: '/login' },
  { name: '注册页', path: '/register' },
  { name: '找回密码', path: '/forgot-password' }
];

// 需登录页面
const AUTH_PAGES = [
  { name: '推荐', path: '/referral' },
  { name: '充值', path: '/recharge' },
  { name: '钱包', path: '/wallet' },
  { name: '提现', path: '/withdraw' },
  { name: '钱包奖励', path: '/wallet/rewards' },
  { name: '钱包资金-bonus', path: '/wallet/funds?asset=bonus' },
  { name: '钱包资金-recharge', path: '/wallet/funds?asset=recharge' }
];

// 性能目标
// 性能目标（支持环境变量覆盖）
const TARGETS = {
  performance: parseInt(process.env.TARGET_PERFORMANCE) || 60,
  fcp: parseInt(process.env.TARGET_FCP) || 2500,
  lcp: parseInt(process.env.TARGET_LCP) || 10500,
  tbt: parseInt(process.env.TARGET_TBT) || 200,
  cls: parseFloat(process.env.TARGET_CLS) || 0.1,
  si: parseInt(process.env.TARGET_SI) || 3400
};

// 调用 Supabase API 登录
async function apiLogin() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      email: CONFIG.credentials.email,
      password: CONFIG.credentials.password,
      gotrue_meta_security: {}
    });
    const options = {
      hostname: 'xtgtlzmpqydwxitcqyst.supabase.co',
      port: 443,
      path: '/auth/v1/token?grant_type=password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'apikey': CONFIG.supabaseAnonKey
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.error) reject(new Error(json.error_description || json.error));
          else resolve(json);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.write(data);
    req.end();
  });
}

// 构造 Supabase session
function buildSession(authData) {
  return {
    access_token: authData.access_token,
    refresh_token: authData.refresh_token,
    expires_in: authData.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + authData.expires_in,
    token_type: 'bearer',
    user: authData.user
  };
}

// 通过 CDP 注入登录态
async function injectAuthViaCDP(browser, authData) {
  const session = buildSession(authData);
  const sessionStr = JSON.stringify(session);
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((data) => {
    localStorage.setItem('supabase.auth.token', data);
    localStorage.setItem('sb-xtgtlzmpqydwxitcqyst-auth-token', data);
  }, sessionStr);
  await client.send('Network.setCookie', {
    name: 'supabase-auth-token',
    value: encodeURIComponent(sessionStr),
    domain: '.panda-scratch.com',
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'Lax'
  });
  await page.close();
  console.log('✅ 登录态已通过 CDP 注入');
}

// Lighthouse 测试单个页面
async function testPage(browser, url, name, authData) {
  const page = await browser.newPage();
  try {
    const browserWSEndpoint = browser.wsEndpoint();
    const port = parseInt(new URL(browserWSEndpoint).port);

    // 需要登录的页面注入 auth
    if (authData) {
      const sessionStr = JSON.stringify(buildSession(authData));
      await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate((data) => {
        localStorage.setItem('supabase.auth.token', data);
        localStorage.setItem('sb-xtgtlzmpqydwxitcqyst-auth-token', data);
      }, sessionStr);
    }

    // 访问目标页面验证可达
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    if (authData) {
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        throw new Error('未登录，被重定向到登录页');
      }
    }

    // 关闭 page 让 Lighthouse 独占
    await page.close();

    const result = await lighthouse(url, {
      port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
      throttling: {
        rttMs: 150,
        throughputKbps: 1638.4,
        cpuSlowdownMultiplier: 4
      },
      screenEmulation: {
        mobile: true,
        width: 412,
        height: 823,
        deviceScaleFactor: 1.75,
        disabled: false
      },
      emulatedUserAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36'
    });

    const audits = result.lhr.audits || {};
    const categories = result.lhr.categories || {};
    return {
      name, url,
      performance: Math.round((categories.performance?.score || 0) * 100),
      fcp: Math.round(audits['first-contentful-paint']?.numericValue || 0),
      lcp: Math.round(audits['largest-contentful-paint']?.numericValue || 0),
      tbt: Math.round(audits['total-blocking-time']?.numericValue || 0),
      cls: audits['cumulative-layout-shift']?.numericValue || 0,
      si: Math.round(audits['speed-index']?.numericValue || 0)
    };
  } catch (e) {
    if (!page.isClosed()) await page.close();
    return { name, url, error: e.message };
  }
}

// 判断指标状态图标
function icon(pass) { return pass ? '✅' : '❌'; }
function fcpIcon(val) {
  if (val < TARGETS.fcp) return '✅';
  if (val <= TARGETS.fcp * 1.05) return '⚠️';
  return '❌';
}

// 生成表格行
function tableRow(r) {
  if (r.error) {
    return `| ${r.name} | ❌ 错误: ${r.error} | | | | | | ❌ |`;
  }
  const perfOk = r.performance >= TARGETS.performance;
  const fcpOk = r.fcp < TARGETS.fcp;
  const lcpOk = r.lcp < TARGETS.lcp;
  const tbtOk = r.tbt < TARGETS.tbt;
  const clsOk = r.cls < TARGETS.cls;
  const siOk = r.si < TARGETS.si;
  const allOk = perfOk && fcpOk && lcpOk && tbtOk && clsOk && siOk;

  const fmtFcp = `${(r.fcp / 1000).toFixed(1)}s ${fcpIcon(r.fcp)}`;
  const fmtLcp = `${(r.lcp / 1000).toFixed(1)}s ${icon(lcpOk)}`;
  const fmtTbt = `${r.tbt}ms ${icon(tbtOk)}`;
  const fmtCls = `${r.cls.toFixed(r.cls < 0.01 ? 2 : 3)} ${icon(clsOk)}`;
  const fmtSi = `${(r.si / 1000).toFixed(1)}s ${icon(siOk)}`;

  return `| ${r.name} | ${r.performance} ${icon(perfOk)} | ${fmtFcp} | ${fmtLcp} | ${fmtTbt} | ${fmtCls} | ${fmtSi} | ${icon(allOk)} |`;
}

// 格式化完整报告
function formatReport(publicResults, authResults) {
  const all = [...publicResults, ...authResults];
  const valid = all.filter(r => !r.error);
  let report = '';

  report += `## 🔍 全站移动端性能检查结果\n\n`;
  report += `**策略:** 移动端 (Moto G4, 慢速4G)  \n`;
  report += `**目标:** Performance≥${TARGETS.performance} | FCP<${TARGETS.fcp / 1000}s | LCP<${TARGETS.lcp / 1000}s | TBT<${TARGETS.tbt}ms | CLS<${TARGETS.cls} | SI<${TARGETS.si / 1000}s\n`;
  report += `**检测时间:** ${new Date().toLocaleString('zh-CN')}\n\n`;
  report += `---\n\n`;

  // 公开页面表
  report += `### 📊 公开页面性能汇总\n\n`;
  report += `| 页面 | Performance | FCP | LCP | TBT | CLS | SI | 达标 |\n`;
  report += `|------|-------------|-----|-----|-----|-----|-----|------|\n`;
  for (const r of publicResults) {
    report += tableRow(r) + '\n';
  }
  report += '\n';

  // 需登录页面表
  report += `### 🔒 需登录页面性能汇总\n\n`;
  report += `| 页面 | Performance | FCP | LCP | TBT | CLS | SI | 达标 |\n`;
  report += `|------|-------------|-----|-----|-----|-----|-----|------|\n`;
  for (const r of authResults) {
    report += tableRow(r) + '\n';
  }
  report += '\n';

  report += `---\n\n`;

  // 汇总统计
  const total = valid.length;
  const stats = {
    performance: valid.filter(r => r.performance >= TARGETS.performance).length,
    fcp: valid.filter(r => r.fcp < TARGETS.fcp).length,
    lcp: valid.filter(r => r.lcp < TARGETS.lcp).length,
    tbt: valid.filter(r => r.tbt < TARGETS.tbt).length,
    cls: valid.filter(r => r.cls < TARGETS.cls).length,
    si: valid.filter(r => r.si < TARGETS.si).length
  };
  const allPass = valid.filter(r => {
    return r.performance >= TARGETS.performance && r.fcp < TARGETS.fcp &&
      r.lcp < TARGETS.lcp && r.tbt < TARGETS.tbt && r.cls < TARGETS.cls && r.si < TARGETS.si;
  }).length;

  function statRow(label, target, pass, total) {
    const fail = total - pass;
    const rate = total > 0 ? Math.round(pass / total * 100) : 0;
    const alert = rate === 0 ? ' 🚨' : '';
    const bold = rate === 0;
    if (bold) return `| **${label}** | ✅ | **${pass}** | **${fail}** | **${rate}%**${alert} |`;
    return `| ${label} | ✅ | ${pass} | ${fail} | ${rate}% |`;
  }

  report += `### 📈 汇总统计（全部页面）\n\n`;
  report += `| 指标 | 目标 | 达标 | 未达标 | 达标率 |\n`;
  report += `|------|------|------|--------|--------|\n`;
  report += statRow(`Performance ≥ ${TARGETS.performance}`, '', stats.performance, total) + '\n';
  report += statRow(`FCP < ${TARGETS.fcp / 1000}s`, '', stats.fcp, total) + '\n';
  report += statRow(`LCP < ${TARGETS.lcp / 1000}s`, '', stats.lcp, total) + '\n';
  report += statRow(`TBT < ${TARGETS.tbt}ms`, '', stats.tbt, total) + '\n';
  report += statRow(`CLS < ${TARGETS.cls}`, '', stats.cls, total) + '\n';
  report += statRow(`SI < ${TARGETS.si / 1000}s`, '', stats.si, total) + '\n';
  const allPassRate = total > 0 ? Math.round(allPass / total * 100) : 0;
  const allBold = allPassRate === 0;
  if (allBold) {
    report += `| **全部达标** | - | **${allPass}** | **${total - allPass}** | **${allPassRate}%** |\n`;
  } else {
    report += `| 全部达标 | - | ${allPass} | ${total - allPass} | ${allPassRate}% |\n`;
  }
  report += '\n---\n\n';

  // 关键问题分析
  report += `### 🚨 关键问题\n\n`;

  // LCP 问题分析
  const lcpFails = valid.filter(r => r.lcp >= TARGETS.lcp);
  if (lcpFails.length > 0) {
    report += `**LCP 超标页面 (${lcpFails.length}/${total})：**\n\n`;

    // 按类型分组
    const groups = {};
    for (const r of lcpFails) {
      let type = '其他';
      if (r.url.includes('/play/')) type = '游戏页面';
      else if (['/login', '/register', '/forgot-password'].some(p => r.url.endsWith(p))) type = '表单页面';
      else if (['/referral', '/recharge', '/wallet', '/withdraw'].some(p => r.url.includes(p))) type = '需登录页面';
      else type = '静态页面';
      if (!groups[type]) groups[type] = [];
      groups[type].push(r);
    }

    report += `| 页面类型 | LCP 范围 | 超标倍数 |\n`;
    report += `|---------|---------|----------|\n`;
    for (const [type, pages] of Object.entries(groups)) {
      const lcps = pages.map(r => r.lcp);
      const min = Math.min(...lcps);
      const max = Math.max(...lcps);
      const minX = (min / TARGETS.lcp).toFixed(1);
      const maxX = (max / TARGETS.lcp).toFixed(1);
      const range = min === max ? `${(min / 1000).toFixed(1)}s` : `${(min / 1000).toFixed(1)}-${(max / 1000).toFixed(1)}s`;
      const mult = minX === maxX ? `${minX}x` : `${minX}-${maxX}x`;
      const bold = type === '游戏页面' || type === '需登录页面';
      if (bold) report += `| **${type}** | **${range}** | **${mult}** |\n`;
      else report += `| ${type} | ${range} | ${mult} |\n`;
    }
    report += '\n';
  }

  // CLS 问题
  const clsFails = valid.filter(r => r.cls >= TARGETS.cls);
  if (clsFails.length > 0) {
    report += `**CLS 问题（${clsFails.length}个页面）：**\n`;
    for (const r of clsFails) {
      report += `- ${r.name}: ${r.cls.toFixed(r.cls < 0.01 ? 2 : 2)} ❌\n`;
    }
    report += '\n';
  }

  // FCP 问题
  const fcpFails = valid.filter(r => r.fcp >= TARGETS.fcp);
  if (fcpFails.length > 0) {
    report += `**FCP 问题（${fcpFails.length}个页面）：**\n`;
    for (const r of fcpFails) {
      const fcpS = (r.fcp / 1000).toFixed(1);
      const warn = r.fcp <= TARGETS.fcp * 1.05 ? '⚠️' : '❌';
      report += `- ${r.name}: ${fcpS}s ${warn}\n`;
    }
    report += '\n';
  }

  // TBT 问题
  const tbtFails = valid.filter(r => r.tbt >= TARGETS.tbt);
  if (tbtFails.length > 0) {
    report += `**TBT 问题（${tbtFails.length}个页面）：**\n`;
    for (const r of tbtFails) {
      report += `- ${r.name}: ${r.tbt}ms ❌\n`;
    }
    report += '\n';
  }

  return report;
}

// 飞书 Webhook 配置
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK || 'https://open.feishu.cn/open-apis/bot/v2/hook/be86b9e1-c8a7-489a-a1c9-f01b9a3459ca';

// 构建飞书卡片消息
function buildFeishuCard(publicResults, authResults) {
  const all = [...publicResults, ...authResults];
  const valid = all.filter(r => !r.error);
  const errors = all.filter(r => r.error);
  const total = valid.length;

  const stats = {
    performance: valid.filter(r => r.performance >= TARGETS.performance).length,
    fcp: valid.filter(r => r.fcp < TARGETS.fcp).length,
    lcp: valid.filter(r => r.lcp < TARGETS.lcp).length,
    tbt: valid.filter(r => r.tbt < TARGETS.tbt).length,
    cls: valid.filter(r => r.cls < TARGETS.cls).length,
    si: valid.filter(r => r.si < TARGETS.si).length
  };
  const allPass = valid.filter(r =>
    r.performance >= TARGETS.performance && r.fcp < TARGETS.fcp &&
    r.lcp < TARGETS.lcp && r.tbt < TARGETS.tbt && r.cls < TARGETS.cls && r.si < TARGETS.si
  ).length;
  const allPassRate = total > 0 ? Math.round(allPass / total * 100) : 0;

  const headerColor = allPassRate >= 80 ? 'green' : allPassRate >= 50 ? 'orange' : 'red';

  // 构建表格列定义
  const columns = [
    { name: 'page', display_name: '页面', data_type: 'text', width: 'auto' },
    { name: 'perf', display_name: 'Performance', data_type: 'text', width: 'auto' },
    { name: 'fcp', display_name: 'FCP', data_type: 'text', width: 'auto' },
    { name: 'lcp', display_name: 'LCP', data_type: 'text', width: 'auto' },
    { name: 'tbt', display_name: 'TBT', data_type: 'text', width: 'auto' },
    { name: 'cls', display_name: 'CLS', data_type: 'text', width: 'auto' },
    { name: 'si', display_name: 'SI', data_type: 'text', width: 'auto' },
    { name: 'pass', display_name: '达标', data_type: 'text', width: 'auto' }
  ];

  // 构建表格行数据
  function buildRow(r) {
    if (r.error) {
      return { page: r.name, perf: '❌ 错误', fcp: '-', lcp: '-', tbt: '-', cls: '-', si: '-', pass: '❌' };
    }
    const perfOk = r.performance >= TARGETS.performance;
    const fcpOk = r.fcp < TARGETS.fcp;
    const lcpOk = r.lcp < TARGETS.lcp;
    const tbtOk = r.tbt < TARGETS.tbt;
    const clsOk = r.cls < TARGETS.cls;
    const siOk = r.si < TARGETS.si;
    const allOk = perfOk && fcpOk && lcpOk && tbtOk && clsOk && siOk;
    return {
      page: r.name,
      perf: `${r.performance} ${perfOk ? '✅' : '❌'}`,
      fcp: `${(r.fcp / 1000).toFixed(1)}s ${fcpOk ? '✅' : '❌'}`,
      lcp: `${(r.lcp / 1000).toFixed(1)}s ${lcpOk ? '✅' : '❌'}`,
      tbt: `${r.tbt}ms ${tbtOk ? '✅' : '❌'}`,
      cls: `${r.cls.toFixed(2)} ${clsOk ? '✅' : '❌'}`,
      si: `${(r.si / 1000).toFixed(1)}s ${siOk ? '✅' : '❌'}`,
      pass: allOk ? '✅' : '❌'
    };
  }

  const elements = [];

  // 汇总信息
  elements.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `📊 **检测时间:** ${new Date().toLocaleString('zh-CN')}\n**策略:** 移动端 (Moto G4, 慢速4G)\n**目标:** Performance≥${TARGETS.performance} | FCP<${TARGETS.fcp/1000}s | LCP<${TARGETS.lcp/1000}s | TBT<${TARGETS.tbt}ms | CLS<${TARGETS.cls} | SI<${TARGETS.si/1000}s`
    }
  });

  elements.push({ tag: 'hr' });

  // 达标率统计表格
  const statsColumns = [
    { name: 'metric', display_name: '指标', data_type: 'text', width: 'auto' },
    { name: 'pass_count', display_name: '达标', data_type: 'text', width: 'auto' },
    { name: 'fail_count', display_name: '未达标', data_type: 'text', width: 'auto' },
    { name: 'rate', display_name: '达标率', data_type: 'text', width: 'auto' }
  ];
  function statRate(pass) { return total > 0 ? Math.round(pass / total * 100) + '%' : '0%'; }
  const statsRows = [
    { metric: `Performance ≥ ${TARGETS.performance}`, pass_count: `${stats.performance}`, fail_count: `${total - stats.performance}`, rate: statRate(stats.performance) },
    { metric: `FCP < ${TARGETS.fcp/1000}s`, pass_count: `${stats.fcp}`, fail_count: `${total - stats.fcp}`, rate: statRate(stats.fcp) },
    { metric: `LCP < ${TARGETS.lcp/1000}s`, pass_count: `${stats.lcp}`, fail_count: `${total - stats.lcp}`, rate: statRate(stats.lcp) },
    { metric: `TBT < ${TARGETS.tbt}ms`, pass_count: `${stats.tbt}`, fail_count: `${total - stats.tbt}`, rate: statRate(stats.tbt) },
    { metric: `CLS < ${TARGETS.cls}`, pass_count: `${stats.cls}`, fail_count: `${total - stats.cls}`, rate: statRate(stats.cls) },
    { metric: `SI < ${TARGETS.si/1000}s`, pass_count: `${stats.si}`, fail_count: `${total - stats.si}`, rate: statRate(stats.si) },
    { metric: '🏆 全部达标', pass_count: `${allPass}`, fail_count: `${total - allPass}`, rate: `${allPassRate}%` }
  ];

  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: '**📈 达标率统计**' }
  });
  elements.push({
    tag: 'table',
    page_size: 10,
    row_height: 'low',
    header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true },
    columns: statsColumns,
    rows: statsRows
  });

  elements.push({ tag: 'hr' });

  // 公开页面表格
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: `**� 公开页面性能汇总 (${publicResults.length}个)**` }
  });
  elements.push({
    tag: 'table',
    page_size: 20,
    row_height: 'low',
    header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true },
    columns: columns,
    rows: publicResults.map(r => buildRow(r))
  });

  elements.push({ tag: 'hr' });

  // 需登录页面表格
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: `**� 需登录页面性能汇总 (${authResults.length}个)**` }
  });
  elements.push({
    tag: 'table',
    page_size: 10,
    row_height: 'low',
    header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true },
    columns: columns,
    rows: authResults.map(r => buildRow(r))
  });

  // 关键问题
  const worstPerf = valid.length > 0 ? valid.reduce((a, b) => a.performance < b.performance ? a : b) : null;
  const worstLcp = valid.length > 0 ? valid.reduce((a, b) => a.lcp > b.lcp ? a : b) : null;
  const issues = [];
  if (worstPerf && worstPerf.performance < TARGETS.performance) {
    issues.push(`最低 Performance: ${worstPerf.name} (${worstPerf.performance}分)`);
  }
  if (worstLcp && worstLcp.lcp >= TARGETS.lcp) {
    issues.push(`最高 LCP: ${worstLcp.name} (${(worstLcp.lcp/1000).toFixed(1)}s)`);
  }
  const fcpFails = valid.filter(r => r.fcp >= TARGETS.fcp);
  if (fcpFails.length > 0) issues.push(`FCP 超标: ${fcpFails.length} 个页面`);
  const tbtFails = valid.filter(r => r.tbt >= TARGETS.tbt);
  if (tbtFails.length > 0) issues.push(`TBT 超标: ${tbtFails.length} 个页面`);
  const clsFails = valid.filter(r => r.cls >= TARGETS.cls);
  if (clsFails.length > 0) issues.push(`CLS 超标: ${clsFails.length} 个页面`);
  if (errors.length > 0) issues.push(`错误页面: ${errors.map(r => r.name).join(', ')}`);

  if (issues.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**🚨 关键问题**\n${issues.map(i => `• ${i}`).join('\n')}`
      }
    });
  }

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: `🐼 Panda Scratch 性能报告 | 达标率 ${allPassRate}%`
        },
        template: headerColor
      },
      elements
    }
  };
}

// 发送飞书通知
async function sendFeishuNotification(publicResults, authResults) {
  const card = buildFeishuCard(publicResults, authResults);
  const data = JSON.stringify(card);

  return new Promise((resolve, reject) => {
    const url = new URL(FEISHU_WEBHOOK_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.code === 0 || json.StatusCode === 0) {
            resolve(json);
          } else {
            reject(new Error(`飞书 API 错误: ${json.msg || json.StatusMessage || responseData}`));
          }
        } catch (e) {
          reject(new Error(`飞书响应解析失败: ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('飞书通知超时')));
    req.write(data);
    req.end();
  });
}

// 主函数
async function main() {
  console.log('🚀 Panda Scratch 全站移动端性能检查\n');
  console.log(`账号: ${CONFIG.credentials.email}`);
  console.log(`公开页面: ${PUBLIC_PAGES.length} 个`);
  console.log(`需登录页面: ${AUTH_PAGES.length} 个`);
  console.log(`总计: ${PUBLIC_PAGES.length + AUTH_PAGES.length} 个页面\n`);

  let browser;
  let authData;

  try {
    // 1. API 登录
    console.log('🔐 步骤 1: API 登录...');
    authData = await apiLogin();
    console.log(`✅ 登录成功! Token: ${authData.access_token?.substring(0, 30)}...\n`);

    // 2. 启动浏览器
    console.log('🌐 步骤 2: 启动浏览器...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    console.log('✅ 浏览器已启动\n');

    // 3. 注入登录态
    console.log('🔐 步骤 3: 注入登录态...');
    await injectAuthViaCDP(browser, authData);
    console.log('');

    const totalPages = PUBLIC_PAGES.length + AUTH_PAGES.length;
    let idx = 0;

    // 4. 测试公开页面
    console.log('📊 步骤 4: 检查公开页面...\n');
    const publicResults = [];
    for (const p of PUBLIC_PAGES) {
      idx++;
      const url = `${CONFIG.baseUrl}${p.path}`;
      process.stdout.write(`[${idx}/${totalPages}] ${p.name}... `);
      const result = await testPage(browser, url, p.name, null);
      publicResults.push(result);
      if (result.error) console.log(`❌ ${result.error}`);
      else console.log(`✅ P:${result.performance} FCP:${(result.fcp/1000).toFixed(1)}s LCP:${(result.lcp/1000).toFixed(1)}s TBT:${result.tbt}ms CLS:${result.cls.toFixed(2)} SI:${(result.si/1000).toFixed(1)}s`);
    }

    // 5. 测试需登录页面
    console.log('\n🔒 步骤 5: 检查需登录页面...\n');
    const authResults = [];
    for (const p of AUTH_PAGES) {
      idx++;
      const url = `${CONFIG.baseUrl}${p.path}`;
      process.stdout.write(`[${idx}/${totalPages}] ${p.name}... `);
      const result = await testPage(browser, url, p.name, authData);
      authResults.push(result);
      if (result.error) console.log(`❌ ${result.error}`);
      else console.log(`✅ P:${result.performance} FCP:${(result.fcp/1000).toFixed(1)}s LCP:${(result.lcp/1000).toFixed(1)}s TBT:${result.tbt}ms CLS:${result.cls.toFixed(2)} SI:${(result.si/1000).toFixed(1)}s`);
    }

    // 输出报告
    const report = formatReport(publicResults, authResults);
    console.log('\n' + report);

    // 保存结果
    const outputFile = path.join(os.tmpdir(), `panda-perf-${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify({
      publicResults, authResults,
      timestamp: new Date().toISOString(),
      user: authData.user?.email
    }, null, 2));
    console.log(`💾 详细结果已保存: ${outputFile}`);

    // 同时保存 markdown 报告
    const mdFile = path.join(os.tmpdir(), `panda-perf-${Date.now()}.md`);
    fs.writeFileSync(mdFile, report);
    console.log(`📄 Markdown 报告: ${mdFile}`);

    // 6. 发送飞书通知
    console.log('\n📮 步骤 6: 发送飞书通知...');
    try {
      await sendFeishuNotification(publicResults, authResults);
      console.log('✅ 飞书通知已发送');
    } catch (feishuErr) {
      console.error(`⚠️ 飞书通知发送失败: ${feishuErr.message}`);
    }

  } catch (e) {
    console.error('\n❌ 检查失败:', e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

// 帮助
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
使用方法:
  node panda-auth-perf-api-login.js [选项]

选项:
  --help, -h     显示帮助

环境变量:
  PANDA_EMAIL        登录邮箱 (默认: ptest3@test.com)
  PANDA_PASSWORD     登录密码 (默认: 11111111)

示例:
  node panda-auth-perf-api-login.js
  PANDA_EMAIL=user@test.com PANDA_PASSWORD=123456 node panda-auth-perf-api-login.js
`);
  process.exit(0);
}

main();
