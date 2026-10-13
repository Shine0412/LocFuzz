// 执行 + 特征采集 agent：一次运行同时拿到
//   1) CPU profile 采样 → 函数调用序列（按时间序取栈顶函数，折叠连续重复）
//   2) PreciseCoverage → 函数覆盖集合（Jaccard 用）
// 用法: node coverage_agent.js <test.js> <out.json> [timeout_ms]
// 状态分类: ok / syntax_error / runtime_error / timeout / crash(无 out.json)
'use strict';
const inspector = require('inspector');
const fs = require('fs');
const vm = require('vm');

const [, , testFileRaw, outFile, timeoutArg] = process.argv;
const TIMEOUT = parseInt(timeoutArg || '5000', 10);
// Windows 下 coverage 上报的 url 会把反斜杠规范为正斜杠、绝对路径变为
// file:// URL 并做百分号编码，因此同时兼容原始路径与 file:// 形式
const normUrl = (u) => (u || '').replace(/\\/g, '/');
const { pathToFileURL } = require('url');
const fileUrl = pathToFileURL(testFileRaw).href;
const matches = (u) => u === testFileRaw || normUrl(u) === normUrl(testFileRaw) || u === fileUrl;
const testFile = testFileRaw;

const session = new inspector.Session();
session.connect();
const post = (method, params) =>
  new Promise((res, rej) => session.post(method, params, (e, r) => (e ? rej(e) : res(r))));

// 函数身份只用函数名（不含文件路径/行号）：路径会使变异文件名不同而
// 人为归零相似度，行号会因插入/删除代码而漂移
const fid = (cf) => cf.functionName || '(anon)';

(async () => {
  const code = fs.readFileSync(testFile, 'utf8');
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 200 });
  await post('Profiler.start');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

  let status = 'ok', error = '';
  try {
    new vm.Script(code, { filename: testFile });          // 语法检查
  } catch (e) {
    status = 'syntax_error';
    error = String(e).slice(0, 300);
  }
  if (status === 'ok') {
    try {
      vm.runInThisContext(code, { filename: testFile, timeout: TIMEOUT });
    } catch (e) {
      if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') status = 'timeout';
      else { status = 'runtime_error'; error = String(e).slice(0, 300); }
    }
  }

  const { profile } = await post('Profiler.stop');
  const cov = await post('Profiler.takePreciseCoverage').catch(() => null);
  session.disconnect();

  // —— 调用序列：样本按时间序 → 栈顶函数，折叠连续重复 ——
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
  const seq = [];
  for (const sid of profile.samples || []) {
    const n = nodeById.get(sid);
    if (!n) continue;
    if (!matches(n.callFrame.url)) continue;   // 只保留被测代码的帧
    const f = fid(n.callFrame);
    if (seq.length === 0 || seq[seq.length - 1] !== f) seq.push(f);
  }

  // —— 覆盖集合：只统计测试文件内的函数 ——
  const covered = new Set();
  if (cov && cov.result) {
    for (const entry of cov.result) {
      if (!matches(entry.url)) continue;
      for (const fn of entry.functions) {
        if (fn.ranges.some((r) => r.count > 0)) {
          covered.add(fn.functionName || '(anon)');
        }
      }
    }
  }

  fs.writeFileSync(outFile, JSON.stringify({
    status, error, call_sequence: seq, covered_functions: [...covered],
  }));
  process.exit(0);
})().catch((e) => {
  console.error('agent error:', e);
  process.exit(1);
});
