/**
 * Minimal MCP Apps view for `xunji_training_overview`.
 *
 * One self-contained HTML document, no external requests, no third-party
 * scripts. It reads the same `structuredContent` the text result already
 * carries, so the UI adds no data access and no new privacy surface. The host
 * enforces the sandbox; the document only formats numbers.
 */

export const OVERVIEW_UI_URI = 'ui://xunji/overview';
export const OVERVIEW_UI_MIME = 'text/html;profile=mcp-app';

export const OVERVIEW_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--fg:var(--color-text-primary,#111);--muted:var(--color-text-secondary,#666);--bg:var(--color-background-primary,transparent);--line:var(--color-border-primary,#e5e5e5);--accent:#2f7d5b;--warn:#b4690e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}
main{padding:14px 16px 12px;border:1px solid var(--line);border-radius:12px;max-width:720px}
header{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
h1{font-size:15px;margin:0;font-weight:650}
h2{font-size:12px;margin:0;color:var(--muted);font-weight:600;letter-spacing:.02em}
p{margin:2px 0 0;color:var(--muted);font-size:12px}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.badge.ok{color:var(--accent);border-color:var(--accent)}
.badge.warn{color:var(--warn);border-color:var(--warn)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0 14px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.kpi span{display:block;font-size:11px;color:var(--muted)}
.kpi strong{display:block;font-size:18px;font-weight:650;margin-top:2px;font-variant-numeric:tabular-nums}
.chart-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px}
.chart{display:flex;align-items:flex-end;gap:4px;height:110px;border-bottom:1px solid var(--line);padding-bottom:2px}
.bar-wrap{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}
.bar{width:70%;background:var(--accent);opacity:.85;border-radius:3px 3px 0 0;min-height:2px}
.bar-label{font-size:9px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.empty{font-size:12px;color:var(--muted);margin:8px 0 0}
footer{margin-top:10px;font-size:10px;color:var(--muted)}
@media (max-width:420px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
</head>
<body>
<main>
<header>
  <div><h1>训记 · 训练概览</h1><p id="range">等待数据…</p></div>
  <span id="coverage" class="badge">—</span>
</header>
<section class="kpis">
  <div class="kpi"><span>训练次数</span><strong id="kpi-sessions">—</strong></div>
  <div class="kpi"><span>总组数</span><strong id="kpi-sets">—</strong></div>
  <div class="kpi"><span>总容量</span><strong id="kpi-volume">—</strong></div>
  <div class="kpi"><span>训练天数</span><strong id="kpi-days">—</strong></div>
</section>
<section>
  <div class="chart-head"><h2>月度容量</h2><span class="badge">kg</span></div>
  <div id="chart" class="chart"></div>
</section>
<footer id="foot">数据源：训记（派生索引）</footer>
</main>
<script>
(function () {
  var nextId = 1;
  function post(message) { window.parent.postMessage(message, '*'); }
  function rpc(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 4000);
      function cleanup() { clearTimeout(timer); window.removeEventListener('message', on); }
      function on(event) {
        if (event.source !== window.parent) return;
        var data = event.data;
        if (!data || data.id !== id) return;
        cleanup();
        if (data.error) reject(new Error((data.error && data.error.message) || 'error'));
        else resolve(data.result);
      }
      window.addEventListener('message', on);
      post({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }
  function fmt(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
  }
  function set(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }
  function theme(context) {
    if (!context) return;
    document.documentElement.style.colorScheme = context.theme === 'dark' ? 'dark' : 'light';
    var vars = context.styles && context.styles.variables;
    if (vars) {
      for (var key in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, key)) {
          document.documentElement.style.setProperty(key, vars[key]);
        }
      }
    }
  }
  function render(data) {
    if (!data || data.status !== 'ok') { set('range', '暂无可用数据'); return; }
    var kpis = data.kpis || {};
    set('kpi-sessions', fmt(kpis.sessions));
    set('kpi-sets', fmt(kpis.sets));
    set('kpi-volume', fmt(kpis.volumeKg));
    set('kpi-days', fmt(kpis.trainingDays));
    var range = data.range || {};
    set('range', (range.from || '') + ' 至 ' + (range.to || ''));
    var coverage = data.coverage || {};
    var badge = document.getElementById('coverage');
    if (badge) {
      badge.textContent = coverage.complete ? '覆盖完整' : fmt(coverage.scannedDays) + '/' + fmt(coverage.days) + ' 天已扫描';
      badge.className = 'badge ' + (coverage.complete ? 'ok' : 'warn');
    }
    var monthly = data.monthly || {};
    var columns = monthly.columns || [];
    var rows = monthly.rows || [];
    var bucket = columns.indexOf('bucket');
    if (bucket < 0) bucket = 0;
    var volume = columns.indexOf('volume_kg');
    var chart = document.getElementById('chart');
    chart.textContent = '';
    if (volume < 0 || rows.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '该区间没有可绘制的月度数据。';
      chart.appendChild(empty);
      return;
    }
    var values = rows.map(function (row) { return Number(row[volume]) || 0; });
    var max = Math.max.apply(null, values);
    if (!(max > 0)) max = 1;
    rows.forEach(function (row, index) {
      var wrap = document.createElement('div');
      wrap.className = 'bar-wrap';
      wrap.title = String(row[bucket]) + ' · ' + fmt(values[index]) + ' kg';
      var bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = Math.max(2, Math.round((values[index] / max) * 100)) + '%';
      wrap.appendChild(bar);
      var label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = String(row[bucket] || '').slice(2);
      wrap.appendChild(label);
      chart.appendChild(wrap);
    });
    var generated = data.meta && data.meta.generatedAt ? new Date(data.meta.generatedAt) : null;
    set('foot', '数据源：训记（派生索引）' + (generated ? ' · 生成于 ' + generated.toLocaleString('zh-CN') : ''));
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data.method !== 'string') return;
    if (data.method === 'ui/notifications/tool-result') {
      var params = data.params || {};
      render(params.structuredContent || params);
    } else if (data.method === 'ui/notifications/host-context-changed') {
      theme(data.params);
    }
  });
  (async function () {
    try {
      var result = await rpc('ui/initialize', {
        appCapabilities: { availableDisplayModes: ['inline'] },
        appInfo: { name: 'xunji-overview', version: '1.0.0' },
        protocolVersion: '2026-01-26'
      });
      theme(result && result.hostContext);
      post({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    } catch (error) {
      /* Text fallback still works when the host does not implement MCP Apps. */
    }
  })();
})();
</script>
</body>
</html>`;
