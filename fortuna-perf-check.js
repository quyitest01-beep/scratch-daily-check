#!/usr/bin/env node
/**
 * Fortuna 正式环境 全站移动端性能检查脚本
 * 使用 Supabase API 登录 + Puppeteer + Lighthouse
 * 
 * 安装依赖: npm install puppeteer lighthouse
 * 使用方法: 
 *   node fortuna-perf-check.js
 *   FORTUNA_EMAIL=user@test.com FORTUNA_PASSWORD=pass node fortuna-perf-check.js
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
  baseUrl: 'https://fortuna.fast',
  supabaseUrl: 'https://hchtwvblwabbblraborw.supabase.co',
  supabaseAnonKey: 'sb_publishable_3ji6cLwbo8iVE35eXdfFxg_FYfLp6rA',
  credentials: {
    email: process.env.FORTUNA_EMAIL || 'ptest50@test.com',
    password: process.env.FORTUNA_PASSWORD || '11111111'
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
const TARGETS = {
  performance: 60,
  fcp: 2500,
  lcp: 10500,
  tbt: 200,
  cls: 0.1,
  si: 3400
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
      hostname: 'hchtwvblwabbblraborw.supabase.co',
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
    localStorage.setItem('sb-hchtwvblwabbblraborw-auth-token', data);
  }, sessionStr);
  await client.send('Network.setCookie', {
    name: 'supabase-auth-token',
    value: encodeURIComponent(sessionStr),
    domain: '.fortuna.fast',
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

    if (authData) {
      const sessionStr = JSON.stringify(buildSession(authData));
      await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate((data) => {
        localStorage.setItem('supabase.auth.token', data);
        localStorage.setItem('sb-hchtwvblwabbblraborw-auth-token', data);
      }, sessionStr);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    if (authData) {
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        throw new Error('未登录，被重定向到登录页');
      }
    }

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

function icon(pass) { return pass ? '✅' : '❌'; }
function fcpIcon(val) {
  if (val < TARGETS.fcp) return '✅';
  if (val <= TARGETS.fcp * 1.05) return '⚠️';
  return '❌';
}

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
  return `| ${r.name} | ${r.performance} ${icon(perfOk)} | ${(r.fcp / 1000).toFixed(1)}s ${fcpIcon(r.fcp)} | ${(r.lcp / 1000).toFixed(1)}s ${icon(lcpOk)} | ${r.tbt}ms ${icon(tbtOk)} | ${r.cls.toFixed(r.cls < 0.01 ? 2 : 3)} ${icon(clsOk)} | ${(r.si / 1000).toFixed(1)}s ${icon(siOk)} | ${icon(allOk)} |`;
}

function formatReport(publicResults, authResults) {
  const all = [...publicResults, ...authResults];
  const valid = all.filter(r => !r.error);
  let report = '';
  report += `## 🔍 Fortuna 正式环境 移动端性能检查结果\n\n`;
  report += `**策略:** 移动端 (Moto G4, 慢速4G)  \n`;
  report += `**目标:** Performance≥${TARGETS.performance} | FCP<${TARGETS.fcp / 1000}s | LCP<${TARGETS.lcp / 1000}s | TBT<${TARGETS.tbt}ms | CLS<${TARGETS.cls} | SI<${TARGETS.si / 1000}s\n`;
  report += `**检测时间:** ${new Date().toLocaleString('zh-CN')}\n\n`;
  report += `---\n\n`;
  report += `### 📊 公开页面性能汇总\n\n`;
  report += `| 页面 | Performance | FCP | LCP | TBT | CLS | SI | 达标 |\n`;
  report += `|------|-------------|-----|-----|-----|-----|-----|------|\n`;
  for (const r of publicResults) { report += tableRow(r) + '\n'; }
  report += '\n';
  report += `### 🔒 需登录页面性能汇总\n\n`;
  report += `| 页面 | Performance | FCP | LCP | TBT | CLS | SI | 达标 |\n`;
  report += `|------|-------------|-----|-----|-----|-----|-----|------|\n`;
  for (const r of authResults) { report += tableRow(r) + '\n'; }
  report += '\n---\n\n';
  const total = valid.length;
  const stats = {
    performance: valid.filter(r => r.performance >= TARGETS.performance).length,
    fcp: valid.filter(r => r.fcp < TARGETS.fcp).length,
    lcp: valid.filter(r => r.lcp < TARGETS.lcp).length,
    tbt: valid.filter(r => r.tbt < TARGETS.tbt).length,
    cls: valid.filter(r => r.cls < TARGETS.cls).length,
    si: valid.filter(r => r.si < TARGETS.si).length
  };
  const allPass = valid.filter(r => r.performance >= TARGETS.performance && r.fcp < TARGETS.fcp && r.lcp < TARGETS.lcp && r.tbt < TARGETS.tbt && r.cls < TARGETS.cls && r.si < TARGETS.si).length;
  const allPassRate = total > 0 ? Math.round(allPass / total * 100) : 0;
  function statRow(label, pass) {
    const fail = total - pass;
    const rate = total > 0 ? Math.round(pass / total * 100) : 0;
    return `| ${label} | ${pass} | ${fail} | ${rate}% |`;
  }
  report += `### 📈 汇总统计\n\n`;
  report += `| 指标 | 达标 | 未达标 | 达标率 |\n`;
  report += `|------|------|--------|--------|\n`;
  report += statRow(`Performance ≥ ${TARGETS.performance}`, stats.performance) + '\n';
  report += statRow(`FCP < ${TARGETS.fcp / 1000}s`, stats.fcp) + '\n';
  report += statRow(`LCP < ${TARGETS.lcp / 1000}s`, stats.lcp) + '\n';
  report += statRow(`TBT < ${TARGETS.tbt}ms`, stats.tbt) + '\n';
  report += statRow(`CLS < ${TARGETS.cls}`, stats.cls) + '\n';
  report += statRow(`SI < ${TARGETS.si / 1000}s`, stats.si) + '\n';
  report += `| **全部达标** | **${allPass}** | **${total - allPass}** | **${allPassRate}%** |\n`;
  report += '\n';
  return report;
}

// 飞书 Webhook 配置
const FEISHU_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/a9764473-129e-4cdc-95e2-4f20ce7dc218';

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
  const allPass = valid.filter(r => r.performance >= TARGETS.performance && r.fcp < TARGETS.fcp && r.lcp < TARGETS.lcp && r.tbt < TARGETS.tbt && r.cls < TARGETS.cls && r.si < TARGETS.si).length;
  const allPassRate = total > 0 ? Math.round(allPass / total * 100) : 0;
  const headerColor = allPassRate >= 80 ? 'green' : allPassRate >= 50 ? 'orange' : 'red';

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

  function buildRow(r) {
    if (r.error) return { page: r.name, perf: '❌ 错误', fcp: '-', lcp: '-', tbt: '-', cls: '-', si: '-', pass: '❌' };
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
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `📊 **检测时间:** ${new Date().toLocaleString('zh-CN')}\n**环境:** 正式环境 (fortuna.fast)\n**策略:** 移动端 (Moto G4, 慢速4G)\n**目标:** Performance≥${TARGETS.performance} | FCP<${TARGETS.fcp/1000}s | LCP<${TARGETS.lcp/1000}s | TBT<${TARGETS.tbt}ms | CLS<${TARGETS.cls} | SI<${TARGETS.si/1000}s` } });
  elements.push({ tag: 'hr' });

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
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**📈 达标率统计**' } });
  elements.push({ tag: 'table', page_size: 10, row_height: 'low', header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true }, columns: statsColumns, rows: statsRows });
  elements.push({ tag: 'hr' });

  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**📄 公开页面性能汇总 (${publicResults.length}个)**` } });
  elements.push({ tag: 'table', page_size: 20, row_height: 'low', header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true }, columns, rows: publicResults.map(r => buildRow(r)) });
  elements.push({ tag: 'hr' });

  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**🔒 需登录页面性能汇总 (${authResults.length}个)**` } });
  elements.push({ tag: 'table', page_size: 10, row_height: 'low', header_style: { text_align: 'center', text_size: 'normal', background_style: 'grey', bold: true }, columns, rows: authResults.map(r => buildRow(r)) });

  const worstPerf = valid.length > 0 ? valid.reduce((a, b) => a.performance < b.performance ? a : b) : null;
  const worstLcp = valid.length > 0 ? valid.reduce((a, b) => a.lcp > b.lcp ? a : b) : null;
  const issues = [];
  if (worstPerf && worstPerf.performance < TARGETS.performance) issues.push(`最低 Performance: ${worstPerf.name} (${worstPerf.performance}分)`);
  if (worstLcp && worstLcp.lcp >= TARGETS.lcp) issues.push(`最高 LCP: ${worstLcp.name} (${(worstLcp.lcp/1000).toFixed(1)}s)`);
  const fcpFails = valid.filter(r => r.fcp >= TARGETS.fcp);
  if (fcpFails.length > 0) issues.push(`FCP 超标: ${fcpFails.length} 个页面`);
  const tbtFails = valid.filter(r => r.tbt >= TARGETS.tbt);
  if (tbtFails.length > 0) issues.push(`TBT 超标: ${tbtFails.length} 个页面`);
  if (errors.length > 0) issues.push(`错误页面: ${errors.map(r => r.name).join(', ')}`);
  if (issues.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**🚨 关键问题**\n${issues.map(i => `• ${i}`).join('\n')}` } });
  }

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: `🎰 Fortuna 正式环境性能报告 | 达标率 ${allPassRate}%` }, template: headerColor },
      elements
    }
  };
}

async function sendFeishuNotification(publicResults, authResults) {
  const card = buildFeishuCard(publicResults, authResults);
  const data = JSON.stringify(card);
  return new Promise((resolve, reject) => {
    const url = new URL(FEISHU_WEBHOOK_URL);
    const options = { hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.code === 0 || json.StatusCode === 0) resolve(json);
          else reject(new Error(`飞书 API 错误: ${json.msg || json.StatusMessage || responseData}`));
        } catch (e) { reject(new Error(`飞书响应解析失败: ${responseData}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('飞书通知超时')));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🚀 Fortuna 正式环境 全站移动端性能检查\n');
  console.log(`账号: ${CONFIG.credentials.email}`);
  console.log(`公开页面: ${PUBLIC_PAGES.length} 个`);
  console.log(`需登录页面: ${AUTH_PAGES.length} 个`);
  console.log(`总计: ${PUBLIC_PAGES.length + AUTH_PAGES.length} 个页面\n`);

  let browser;
  let authData;

  try {
    console.log('🔐 步骤 1: API 登录...');
    authData = await apiLogin();
    console.log(`✅ 登录成功! Token: ${authData.access_token?.substring(0, 30)}...\n`);

    console.log('🌐 步骤 2: 启动浏览器...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    console.log('✅ 浏览器已启动\n');

    console.log('🔐 步骤 3: 注入登录态...');
    await injectAuthViaCDP(browser, authData);
    console.log('');

    const totalPages = PUBLIC_PAGES.length + AUTH_PAGES.length;
    let idx = 0;

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

    const report = formatReport(publicResults, authResults);
    console.log('\n' + report);

    const outputFile = path.join(os.tmpdir(), `fortuna-perf-${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify({ publicResults, authResults, timestamp: new Date().toISOString(), user: authData.user?.email }, null, 2));
    console.log(`💾 详细结果已保存: ${outputFile}`);

    const mdFile = path.join(os.tmpdir(), `fortuna-perf-${Date.now()}.md`);
    fs.writeFileSync(mdFile, report);
    console.log(`📄 Markdown 报告: ${mdFile}`);

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

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
使用方法:
  node fortuna-perf-check.js [选项]

环境变量:
  FORTUNA_EMAIL      登录邮箱 (默认: ptest50@test.com)
  FORTUNA_PASSWORD   登录密码 (默认: 11111111)
`);
  process.exit(0);
}

main();
