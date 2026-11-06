/* ============================================================
   结果大屏 · 本项目全部被试数据的实时分析
   内容：实测图 / 与原文对比 / "你"在所有被试中的位置 / 易懂结论
   数据源：GET /api/hw2/data?project=项目码（被试自动匿名）
   兜底：接口暂无数据时使用本机 localStorage 的个人记录
   ============================================================ */
(function () {
  Lab.renderNav('results');
  Lab.kineticTitle(document.getElementById('page-title'));

  const INK = '#563E79';
  const C = { feature: '#3ECF8E', conj: '#F28482', cued: '#B388EB', pred: '#8A76A6', num: '#FF6B9D', gra: '#38BDF8', you: '#FF6B9D', other: '#B4A6C7' };
  const baseTextStyle = { color: INK, fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif', fontWeight: 700 };
  const baseGrid = { left: 64, right: 78, top: 50, bottom: 50 };

  /* ---------------- 数据 ---------------- */
  function flatten(records) {
    const out = { search: [], search_cued: [], cm: [], cm_graphic: [] };
    (records || []).forEach(rec => {
      let exp = rec.experiment || '';
      if (exp.startsWith('test_')) return;
      if (!out[exp]) return;
      (rec.trials || []).forEach(t => {
        const c = Object.assign({}, t);
        c._pid = rec.participant || 'anon';
        out[exp].push(c);
      });
    });
    return out;
  }

  function localData() {
    return {
      search: Lab.loadLocal('local_search').filter(t => !String(t.cond).endsWith('_cued')),
      search_cued: Lab.loadLocal('local_search').filter(t => String(t.cond).endsWith('_cued')),
      cm: Lab.loadLocal('local_cm').filter(t => t.response === 'number'),
      cm_graphic: Lab.loadLocal('local_cm').filter(t => t.response === 'graphic'),
    };
  }

  async function loadData() {
    try {
      const r = await fetch(Lab.CONFIG.API + '/api/hw2/data?project=' + encodeURIComponent(Lab.CONFIG.PROJECT));
      const j = await r.json();
      const records = j.records || j.data || (Array.isArray(j) ? j : null);
      if (j.ok && records && records.length) return { src: '本项目所有被试（' + records.length + ' 份记录）', data: flatten(records) };
      throw new Error(j.msg || 'empty');
    } catch (e) {
      const local = localData();
      const hasAny = Object.values(local).some(a => a.length);
      return hasAny
        ? { src: '暂时只有你的数据（更多被试完成后会自动汇总进来）', data: flatten([{ experiment: 'search', participant: '你', trials: local.search }, { experiment: 'search_cued', participant: '你', trials: local.search_cued }, { experiment: 'cm', participant: '你', trials: local.cm }, { experiment: 'cm_graphic', participant: '你', trials: local.cm_graphic }]) }
        : { src: null, data: { search: [], search_cued: [], cm: [], cm_graphic: [] } };
    }
  }

  /* ---------------- 统计工具 ---------------- */
  function groupBy(arr, keyFn) {
    const m = {};
    arr.forEach(t => { const k = keyFn(t); (m[k] = m[k] || []).push(t); });
    return m;
  }
  function slope(xs, ys) {
    const mx = Lab.mean(xs), my = Lab.mean(ys);
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
    return den ? num / den : 0;
  }
  function sd(a) {
    if (a.length < 2) return 0;
    const m = Lab.mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }
  /* 配对样本效应量：均差 / Cohen's dz / t 值 / 双侧 .05 显著性 */
  const T_CRIT = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function pairedStats(diffs) {
    const n = diffs.length;
    if (n < 2) return { n, mean: n ? Lab.mean(diffs) : null };
    const m = Lab.mean(diffs), s = sd(diffs);
    const dz = s > 0 ? m / s : null;
    const t = s > 0 ? m / (s / Math.sqrt(n)) : null;
    const df = n - 1;
    const crit = df <= 30 ? T_CRIT[df - 1] : 1.96 + 2.6 / df;
    return { n, mean: m, sd: s, dz, t, df, sig: t !== null ? Math.abs(t) > crit : null };
  }
  function dWord(d) { const a = Math.abs(d); return a >= 0.8 ? '大效应' : a >= 0.5 ? '中等效应' : a >= 0.2 ? '小效应' : '微弱'; }
  const SIZES = [4, 12, 24];
  // 某条件下某被试的搜索斜率（仅用正确且目标在场的试次）
  function slopeOf(trials) {
    const ok = trials.filter(t => Number(t.correct) === 1 && Number(t.present) === 1);
    const ys = SIZES.map(s => {
      const cell = ok.filter(t => Number(t.set) === s);
      return cell.length ? Lab.mean(cell.map(t => Number(t.rt))) : null;
    });
    if (ys.some(v => v === null)) return null;
    return slope(SIZES, ys);
  }
  function meanErr(trials) { return trials.length ? Lab.mean(trials.map(t => Number(t.error))) : null; }
  // 某条件下正确试次的群体平均反应时（先按被试求均值再平均，避免被试间试次数不等带来权重偏斜）
  function groupMeanRT(trials) {
    const ok = trials.filter(t => Number(t.correct) === 1);
    const per = Object.values(groupBy(ok, t => t._pid)).map(ts => Lab.mean(ts.map(t => Number(t.rt))));
    return per.length ? Lab.mean(per) : null;
  }

  /* ---------------- 顶部统计 ---------------- */
  function renderStats(src, d) {
    const pids = new Set();
    Object.values(d).forEach(arr => arr.forEach(t => pids.add(t._pid)));
    const total = Object.values(d).reduce((s, a) => s + a.length, 0);
    const boxes = [
      { num: pids.size, lab: '已收集被试', bg: 'var(--mint)' },
      { num: total, lab: '累计试次', bg: 'var(--aqua)' },
      { num: d.search.length + d.search_cued.length, lab: '实验一试次', bg: 'var(--peach)' },
      { num: d.cm.length + d.cm_graphic.length, lab: '实验二试次', bg: 'var(--lavender)' },
    ];
    document.getElementById('stat-grid').innerHTML = boxes.map(b =>
      `<div class="stat-box" style="background:${b.bg}"><div class="num">${b.num}</div><div class="lab">${b.lab}</div></div>`).join('');
    document.getElementById('msg-box').innerHTML = src
      ? `<p class="note" style="margin-bottom:22px">📡 当前展示：<b>${src}</b></p>`
      : `<p class="note" style="margin-bottom:22px">📡 还没有任何数据。点上方导航去做实验，或把链接发给同学收集数据后回来看看！</p>`;
  }

  /* ---------------- 实验一 · 实测 ---------------- */
  function renderSearch(d) {
    const chart = echarts.init(document.getElementById('chart-search'));
    function seriesFor(trials) {
      const ok = trials.filter(t => Number(t.correct) === 1);
      return SIZES.map(s => {
        const byP = Object.values(groupBy(ok.filter(t => Number(t.set) === s), t => t._pid));
        const perP = byP.map(ts => Lab.mean(ts.map(t => Number(t.rt))));
        return perP.length ? Math.round(Lab.mean(perP)) : null;
      });
    }
    const featY = seriesFor(d.search.filter(t => t.cond === 'feature'));
    const conjY = seriesFor(d.search.filter(t => t.cond === 'conjunction'));
    const cuedY = seriesFor(d.search_cued);

    const anchor = conjY.filter(v => v !== null);
    const base = anchor.length ? Lab.mean(anchor) : 800;
    const predFeat = SIZES.map(s => Math.round(base * 0.75 + (s - 4) * 5));
    const predConj = SIZES.map(s => Math.round(base + (s - 12) * 28));
    const predCued = SIZES.map(s => Math.round(base * 0.92 + (s - 12) * 12));

    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: baseTextStyle },
      grid: baseGrid,
      xAxis: { type: 'category', data: SIZES.map(s => s + ' 个'), name: '集合大小', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } } },
      yAxis: { type: 'value', name: '反应时 (ms)', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      series: [
        { name: '特征搜索（实测）', type: 'line', data: featY, symbolSize: 11, lineStyle: { width: 4, color: C.feature }, itemStyle: { color: C.feature } },
        { name: '联合搜索（实测）', type: 'line', data: conjY, symbolSize: 11, lineStyle: { width: 4, color: C.conj }, itemStyle: { color: C.conj } },
        { name: '联合+预提示（实测·改进）', type: 'line', data: cuedY, symbolSize: 11, lineStyle: { width: 4, color: C.cued }, itemStyle: { color: C.cued } },
        { name: '预测·特征（FIT）', type: 'line', data: predFeat, symbol: 'none', lineStyle: { width: 2.5, type: 'dashed', color: C.pred }, itemStyle: { color: C.pred } },
        { name: '预测·联合（FIT）', type: 'line', data: predConj, symbol: 'none', lineStyle: { width: 2.5, type: 'dashed', color: C.pred }, itemStyle: { color: C.pred } },
        { name: '预测·联合+提示（引导搜索）', type: 'line', data: predCued, symbol: 'none', lineStyle: { width: 2.5, type: 'dashed', color: C.cued, opacity: .6 }, itemStyle: { color: C.cued } },
      ],
    });
    return { featY, conjY, cuedY };
  }

  /* ---------------- 实验一 · 与原文对比 + 你的位置 ---------------- */
  const SELF_IDS = ['你', Lab.getParticipant() || ''];
  function renderSearchVs(d) {
    const chart = echarts.init(document.getElementById('chart-search-vs'));
    // 每名被试的斜率 → 群体均值
    function groupSlope(trials) {
      const ss = Object.values(groupBy(trials, t => t._pid)).map(slopeOf).filter(v => v !== null);
      return ss.length ? Lab.mean(ss) : null;
    }
    const ours = [
      groupSlope(d.search.filter(t => t.cond === 'feature')),
      groupSlope(d.search.filter(t => t.cond === 'conjunction')),
      groupSlope(d.search_cued),
    ];
    const lit = [5, 25, null]; // Treisman & Gelade (1980) 经典量级（约值）

    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: baseTextStyle },
      grid: baseGrid,
      xAxis: { type: 'category', data: ['特征搜索', '联合搜索', '联合+预提示'], axisLine: { lineStyle: { color: INK } } },
      yAxis: { type: 'value', name: '斜率 (ms/项)', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      series: [
        { name: '本研究', type: 'bar', data: ours.map(v => v === null ? null : +v.toFixed(1)), barWidth: 42, itemStyle: { color: C.conj, borderRadius: [10, 10, 0, 0], borderColor: INK, borderWidth: 2.5 } },
        { name: 'T&G (1980) 原文（约值）', type: 'bar', data: lit, barWidth: 42, itemStyle: { color: C.other, borderRadius: [10, 10, 0, 0], borderColor: INK, borderWidth: 2.5, opacity: .75 } },
      ],
    });
    return ours;
  }

  function renderYouSearch(d, local) {
    const chart = echarts.init(document.getElementById('chart-you-search'));
    const perP = Object.entries(groupBy(d.search.filter(t => t.cond === 'conjunction'), t => t._pid))
      .filter(([pid]) => SELF_IDS.indexOf(pid) === -1)
      .map(([pid, ts]) => ({ pid, s: slopeOf(ts) })).filter(o => o.s !== null);
    const yourSlope = slopeOf(local.search.filter(t => t.cond === 'conjunction'));

    const others = perP.map(p => +p.s.toFixed(1));
    const series = [{
      name: '其他被试', type: 'scatter', symbolSize: 16,
      data: others.map(v => [v, 1 + (Math.random() * 0.5 - 0.25)]),
      itemStyle: { color: C.other, borderColor: INK, borderWidth: 2 },
    }];
    if (yourSlope !== null) {
      series.push({
        name: '你', type: 'scatter', symbolSize: 26,
        data: [[+yourSlope.toFixed(1), 1]],
        itemStyle: { color: C.you, borderColor: INK, borderWidth: 3 },
        label: { show: true, formatter: '你', position: 'top', fontWeight: 900, color: INK, fontSize: 15 },
      });
    }
    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { formatter: p => (p.seriesName === '你' ? '你：' : '被试：') + p.value[0] + ' ms/项' },
      grid: { left: 60, right: 40, top: 40, bottom: 56 },
      xAxis: { type: 'value', name: '联合搜索斜率 (ms/项)', nameLocation: 'middle', nameGap: 30, nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      yAxis: { show: false, min: 0.4, max: 1.6 },
      series,
    });

    if (yourSlope !== null && others.length) {
      const below = others.filter(v => v > yourSlope).length;   // 斜率比你大 = 比你慢
      const pct = Math.round(below / others.length * 100);
      return `你的联合搜索斜率为 <b>${yourSlope.toFixed(1)} ms/项</b>，在 ${others.length + 1} 名被试中比 ${pct}% 的人更快（斜率越小越快）。`;
    }
    return yourSlope !== null
      ? `你的联合搜索斜率为 <b>${yourSlope.toFixed(1)} ms/项</b>。等项目里收集到更多被试后，这里会显示你在所有人中的位置。`
      : '你还没做过实验一（或本机没有记录）。完成后这里会显示你在所有被试中的位置。';
  }

  /* ---------------- 实验二 · 实测 ---------------- */
  const ENC = ['position', 'length', 'angle', 'area'];
  const ENC_CN = { position: '📍位置', length: '📏长度', angle: '🍕角度', area: '🫧面积' };

  function renderCM(d) {
    const chart = echarts.init(document.getElementById('chart-cm'));
    function errBy(enc, trials) {
      const byP = Object.values(groupBy(trials.filter(t => t.encoding === enc), t => t._pid));
      const perP = byP.map(meanErr).filter(v => v !== null);
      return perP.length ? +(Lab.mean(perP) * 100).toFixed(1) : null;
    }
    const num = ENC.map(e => errBy(e, d.cm));
    const gra = ENC.map(e => errBy(e, d.cm_graphic));

    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: baseTextStyle },
      grid: baseGrid,
      xAxis: { type: 'category', data: ENC.map(e => ENC_CN[e]), axisLine: { lineStyle: { color: INK } } },
      yAxis: { type: 'value', name: '平均误差 (%)', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      series: [
        { name: '数字作答（原版）', type: 'bar', data: num, barWidth: 34, itemStyle: { color: C.num, borderRadius: [10, 10, 0, 0], borderColor: INK, borderWidth: 2.5 } },
        { name: '图形作答（改进）', type: 'bar', data: gra, barWidth: 34, itemStyle: { color: C.gra, borderRadius: [10, 10, 0, 0], borderColor: INK, borderWidth: 2.5 } },
      ],
    });
    return { num, gra };
  }

  /* ---------------- 实验二 · 与原文排名对比 ---------------- */
  function renderCMVs(cmNum) {
    const chart = echarts.init(document.getElementById('chart-cm-vs'));
    // C&M (1984) 精度排名（1=最准）：位置 1、长度 2、角度 3、面积 4
    const litRank = { position: 1, length: 2, angle: 3, area: 4 };
    let oursRank = null;
    if (cmNum.every(v => v !== null)) {
      const order = ENC.map((e, i) => ({ e, v: cmNum[i] })).sort((a, b) => a.v - b.v);
      oursRank = {};
      order.forEach((o, i) => oursRank[o.e] = i + 1);
    }
    const colors = { position: '#3ECF8E', length: '#38BDF8', angle: '#B388EB', area: '#F28482' };
    const series = ENC.map(e => ({
      name: ENC_CN[e], type: 'line', symbolSize: 14,
      lineStyle: { width: 4, color: colors[e] }, itemStyle: { color: colors[e], borderColor: INK, borderWidth: 2 },
      data: [litRank[e], oursRank ? oursRank[e] : null],
      label: { show: true, formatter: () => ENC_CN[e], position: 'top', distance: 8, fontWeight: 800, color: INK, fontSize: 12 },
    }));
    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { trigger: 'axis' },
      grid: { left: 110, right: 110, top: 40, bottom: 50 },
      xAxis: { type: 'category', data: ['C&M (1984)', '本研究'], axisLine: { lineStyle: { color: INK } } },
      yAxis: { type: 'value', inverse: true, min: 1, max: 4, interval: 1, axisLabel: { formatter: v => '第' + v + '名', color: INK, fontWeight: 700 }, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      series,
    });
    return { litRank, oursRank };
  }

  function renderYouCM(d, local) {
    const chart = echarts.init(document.getElementById('chart-you-cm'));
    const all = d.cm.concat(d.cm_graphic);
    const perP = Object.entries(groupBy(all, t => t._pid))
      .filter(([pid]) => SELF_IDS.indexOf(pid) === -1)
      .map(([pid, ts]) => ({ pid, e: meanErr(ts) })).filter(o => o.e !== null);
    const yourErr = meanErr(local.cm.concat(local.cm_graphic));

    const others = perP.map(p => +(p.e * 100).toFixed(1));
    const series = [{
      name: '其他被试', type: 'scatter', symbolSize: 16,
      data: others.map(v => [v, 1 + (Math.random() * 0.5 - 0.25)]),
      itemStyle: { color: C.other, borderColor: INK, borderWidth: 2 },
    }];
    if (yourErr !== null) {
      series.push({
        name: '你', type: 'scatter', symbolSize: 26,
        data: [[+(yourErr * 100).toFixed(1), 1]],
        itemStyle: { color: C.you, borderColor: INK, borderWidth: 3 },
        label: { show: true, formatter: '你', position: 'top', fontWeight: 900, color: INK, fontSize: 15 },
      });
    }
    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { formatter: p => (p.seriesName === '你' ? '你：' : '被试：') + p.value[0] + '%' },
      grid: { left: 60, right: 40, top: 40, bottom: 56 },
      xAxis: { type: 'value', name: '平均误差 (%)', nameLocation: 'middle', nameGap: 30, nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      yAxis: { show: false, min: 0.4, max: 1.6 },
      series,
    });

    if (yourErr !== null && others.length) {
      const better = others.filter(v => v > yourErr * 100).length;
      const pct = Math.round(better / others.length * 100);
      return `你的平均误差为 <b>${(yourErr * 100).toFixed(1)}%</b>，在 ${others.length + 1} 名被试中比 ${pct}% 的人更准。`;
    }
    return yourErr !== null
      ? `你的平均误差为 <b>${(yourErr * 100).toFixed(1)}%</b>。等项目里收集到更多被试后，这里会显示你在所有人中的位置。`
      : '你还没做过实验二（或本机没有记录）。完成后这里会显示你在所有被试中的位置。';
  }

  /* ---------------- 效应量计算 ---------------- */
  function effBox(name, st, unit, bg, extra) {
    if (!st.n || st.dz == null || st.t == null) {
      const desc = (st.n === 1 && st.mean !== null)
        ? `<span class="eff-val">${st.mean.toFixed(2)} ${unit}</span>目前只有 1 名被试，这是ta的差值；满 2 名后才能算效应量与显著性。`
        : `至少需要 2 名被试的数据才能计算（现在 n = ${st.n || 0}），先把链接发给同学吧！`;
      return `<div class="eff-box" style="background:${bg}"><span class="eff-name">${name}</span>${desc}</div>`;
    }
    return `<div class="eff-box" style="background:${bg}"><span class="eff-name">${name}</span>
      <span class="eff-val">${st.mean.toFixed(2)} ${unit}</span>
      n = ${st.n}，Cohen's d<sub>z</sub> = ${st.dz.toFixed(2)}（${dWord(st.dz)}），t(${st.df}) = ${st.t.toFixed(2)}，${st.sig ? '<b>p &lt; .05 ✅</b>' : 'n.s.'}${extra || ''}</div>`;
  }
  function perPSlopes(trials) {
    const m = {};
    Object.entries(groupBy(trials, t => t._pid)).forEach(([p, ts]) => {
      const s = slopeOf(ts);
      if (s !== null) m[p] = s;
    });
    return m;
  }
  function renderEffectSearch(d) {
    const el = document.getElementById('effect-search');
    const f = perPSlopes(d.search.filter(t => t.cond === 'feature'));
    const c = perPSlopes(d.search.filter(t => t.cond === 'conjunction'));
    const cu = perPSlopes(d.search_cued);
    const diffs1 = Object.keys(f).filter(p => c[p] != null).map(p => c[p] - f[p]);       // 联合 − 特征
    const diffs2 = Object.keys(c).filter(p => cu[p] != null).map(p => c[p] - cu[p]);     // 无提示 − 有提示
    el.innerHTML = '<div class="eff-grid">' +
      effBox('复现效应：联合 − 特征 的斜率差', pairedStats(diffs1), 'ms/项', 'var(--mint)') +
      effBox('改进效应：提示减少的斜率', pairedStats(diffs2), 'ms/项', 'var(--lavender)') +
      '</div>' +
      '<p class="eff-note">对应原文：Treisman &amp; Gelade (1980) 报告特征搜索斜率接近 0（约 0–10 ms/项，并行加工），联合搜索约 20–30 ms/项（序列加工）。本研究「联合 − 特征」差值若落在 15–25 ms/项 附近即为成功复现；「提示减少的斜率」若显著大于 0，则支持引导搜索模型——本设计中一半干扰子可被颜色通道直接排除，理想降幅约为原斜率的一半。</p>';
  }
  function renderEffectCM(d) {
    const el = document.getElementById('effect-cm');
    // 编码误差比（群体均值，以位置为 1，数字作答）
    function gErr(enc, trials) {
      const per = Object.values(groupBy(trials.filter(t => t.encoding === enc), t => t._pid)).map(meanErr).filter(v => v !== null);
      return per.length ? Lab.mean(per) : null;
    }
    const base = gErr('position', d.cm);
    const ratioBox = (enc, name) => {
      const v = gErr(enc, d.cm);
      const ok = base && v;
      return `<div class="eff-box" style="background:var(--aqua)"><span class="eff-name">${name} ÷ 位置</span>` +
        (ok ? `<span class="eff-val">${(v / base).toFixed(2)}×</span>误差是位置的 ${(v / base).toFixed(2)} 倍`
            : '数据还不够') + '</div>';
    };
    // 配对：每名被试 数字作答误差 − 图形作答误差（>0 = 图形更准）
    const byN = groupBy(d.cm, t => t._pid), byG = groupBy(d.cm_graphic, t => t._pid);
    const diffs = Object.keys(byN).filter(p => byG[p]).map(p => meanErr(byN[p]) - meanErr(byG[p]));
    el.innerHTML = '<div class="eff-grid g2">' +
      ratioBox('length', '长度误差') + ratioBox('angle', '角度误差') + ratioBox('area', '面积误差') +
      effBox('改进效应：数字 − 图形 的误差差', pairedStats(diffs), '(比例)', 'var(--lavender)') +
      '</div>' +
      '<p class="eff-note">对应原文：Cleveland &amp; McGill (1984) 报告判断误差按「位置 &lt; 长度 &lt; 角度 &lt; 面积」递增，面积的误差可达位置的数倍；本研究的误差比若单调递增即为一致。「数字 − 图形」差若显著大于 0，说明图形作答更准，支持兼容性原理。</p>';
  }

  /* ---------------- 注视轨迹热图 ---------------- */
  function renderGaze() {
    const wrap = document.getElementById('gaze-panels');
    const boxC = document.getElementById('concl-gaze');
    const g = Gaze.read();
    if (!g || !g.trials || !g.trials.length) {
      wrap.style.display = 'none';
      boxC.innerHTML = conclusionBox('wait', '暂无注视数据', '本机还没有注视轨迹。做实验一时选择「摄像头眼动」或「鼠标代替」，完成后这里会出现你的注视热图。');
      return;
    }
    const base = g.trials.filter(t => t.b === 'base' && t.c === 'conjunction');
    const cued = g.trials.filter(t => t.b === 'cued');
    wrap.style.display = 'grid';
    requestAnimationFrame(() => {
      [['gaze-base', base], ['gaze-cued', cued]].forEach(([id, ts]) => {
        const cv = document.getElementById(id);
        const w = cv.clientWidth || 520, h = cv.clientHeight || 325;
        cv.width = w * 2; cv.height = h * 2;
        const heat = simpleheat(cv);
        const pts = [];
        ts.forEach(t => t.pts.forEach(p => pts.push([p[0] * cv.width, p[1] * cv.height, 1])));
        heat.data(pts);
        heat.radius(30, 18);
        heat.max(Math.max(3, pts.length / 50));
        heat.draw(0.05);
      });
    });
    const avg = ts => ts.length ? Lab.mean(ts.map(t => t.pts.length)) : null;
    const a = avg(base), b = avg(cued);
    let txt;
    if (a !== null && b !== null) {
      const less = b < a * 0.95;
      txt = `联合搜索里，你<b>无提示</b>时平均每幕留下 <b>${a.toFixed(1)}</b> 个注视采样点，<b>有提示</b>时 <b>${b.toFixed(1)}</b> 个${less ? '——提示让你的扫视范围变小了，和反应时的改善互相印证' : '，两者接近'}。` +
        `（记录方式：${g.mode === 'cam' ? '摄像头眼动' : '鼠标轨迹'}；采样点越多，大致说明眼睛扫过的范围越广。注视坐标只保存在你自己的浏览器里，没有上传。）`;
    } else {
      txt = '注视数据还不够做对比，再完成一些联合搜索试次后回来看看。';
    }
    boxC.innerHTML = conclusionBox('imp', '注视轨迹解读', txt);
  }

  /* ---------------- 数字偏好 ---------------- */
  function renderRound(d) {
    const chart = echarts.init(document.getElementById('chart-round'));
    function roundRate(trials) {
      if (trials.length < 5) return null;
      const r = trials.filter(t => Math.round(Number(t.estimate) * 100) % 5 === 0).length;
      return +(r / trials.length * 100).toFixed(1);
    }
    function hist(trials) {
      const bins = new Array(10).fill(0);
      trials.forEach(t => {
        const p = Math.min(99, Math.max(0, Math.round(Number(t.estimate) * 100)));
        bins[Math.floor(p / 10)]++;
      });
      return bins;
    }
    const rn = roundRate(d.cm), rg = roundRate(d.cm_graphic);
    chart.setOption({
      textStyle: baseTextStyle,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: baseTextStyle },
      grid: baseGrid,
      xAxis: { type: 'category', data: ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'], name: '估计值 (%)', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } } },
      yAxis: { type: 'value', name: '次数', nameTextStyle: baseTextStyle, axisLine: { lineStyle: { color: INK } }, splitLine: { lineStyle: { color: 'rgba(86,62,121,.12)' } } },
      series: [
        { name: '数字作答分布', type: 'bar', data: hist(d.cm), itemStyle: { color: C.num, opacity: .85, borderRadius: [8, 8, 0, 0] } },
        { name: '图形作答分布', type: 'bar', data: hist(d.cm_graphic), itemStyle: { color: C.gra, opacity: .85, borderRadius: [8, 8, 0, 0] } },
      ],
    });
    return { rn, rg };
  }

  /* ---------------- 结论（易懂、无比喻） ---------------- */
  function conclusionBox(kind, tagline, html) {
    return `<div class="conclusion ${kind}"><b class="tagline">${tagline}</b><br>${html}</div>`;
  }

  function renderConclusions(d, ctx) {
    const boxS = document.getElementById('concl-search');
    const boxC = document.getElementById('concl-cm');
    const boxR = document.getElementById('concl-round');

    /* 实验一 */
    const { featY, conjY, cuedY } = ctx.search;
    if (featY.every(v => v !== null) && conjY.every(v => v !== null)) {
      const sF = slope(SIZES, featY), sC = slope(SIZES, conjY);
      const repl = sC > sF + 3;
      let html = conclusionBox('rep', '复现结论',
        `所有被试的平均搜索斜率：特征搜索 <b>${sF.toFixed(1)} ms/项</b>，联合搜索 <b>${sC.toFixed(1)} ms/项</b>。` +
        (repl
          ? `联合搜索明显更慢，与 Treisman & Gelade（1980）的结果一致。这说明：当目标只靠单一颜色就能区分时，视觉系统可以同时处理画面里的所有项目，项目再多也几乎不增加搜索时间（并行加工）；而当目标由"颜色 + 形状"两个特征组合定义时，注意必须逐个检查项目，项目每多一个，搜索时间就稳定增加一段（序列加工）。`
          : `两者的差异目前不明显，与 Treisman & Gelade（1980）的预期不一致，可能是数据量还不足。`));
      if (cuedY.every(v => v !== null)) {
        const sCu = slope(SIZES, cuedY);
        const mC = groupMeanRT(d.search.filter(t => t.cond === 'conjunction'));
        const mCu = groupMeanRT(d.search_cued);
        const dSlope = sC - sCu;                                    // >0 = 斜率下降（效率提升）
        const dRT = (mC !== null && mCu !== null) ? mC - mCu : null; // >0 = 总反应时变快
        const slopeOK = dSlope > 3;
        const rtOK = dRT !== null && dRT > 0;
        let verdict;
        if (slopeOK && rtOK)
          verdict = '✅ <b>支持引导搜索模型</b>：斜率下降说明每多一个干扰项的代价真的变小了（效率提升），总反应时的同步变快与此一致。';
        else if (slopeOK)
          verdict = '✅ 斜率下降<b>支持引导搜索模型</b>（搜索效率提升）；总反应时未同步变快，可能是提示条件下被试更谨慎等"固定成本"因素抵消了效率收益。';
        else if (rtOK)
          verdict = '⚠️ 总反应时变快、但斜率没有下降：变快主要来自与搜索效率无关的成分（任务更熟悉、作答更利落）。由于有提示区块固定安排在实验后半段，练习效应与提示效应天然混杂，这种情况<b>不能算作</b>引导搜索的证据。';
        else
          verdict = '⏳ 暂未观察到提示的收益。可能的解释：①目标（红甜甜圈）自始至终固定，被试本就一直保持着目标模板，预提示带来的新信息有限；②被试量还小，斜率估计的噪声大，微小的提示收益容易被淹没；③练习效应与提示效应方向相反时互相抵消。';
        html += conclusionBox('imp', '改进条件检验',
          `判断搜索是否「变高效」要看<b>斜率</b>（集合每多 1 个项目多花的时间），而不是总反应时——后者还包含按键速度、任务熟悉度等与搜索过程无关的固定成分。` +
          `引导搜索模型的预测是：预提示目标特征后，注意被引导到带该特征的项目上，需要逐个检查的项目变少，因此<b>联合搜索的斜率应当下降</b>（本设计中一半干扰子是薄荷绿甜甜圈，可被颜色通道直接排除，理想情况下斜率约减半），而特征搜索本就接近并行加工、不受影响。<br>` +
          `本数据：联合搜索斜率 无提示 <b>${sC.toFixed(1)}</b> → 有提示 <b>${sCu.toFixed(1)} ms/项</b>（${dSlope >= 0 ? '下降' : '上升'} ${Math.abs(dSlope).toFixed(1)}）；平均反应时 ${mC !== null ? Math.round(mC) : '—'} → ${mCu !== null ? Math.round(mCu) : '—'} ms（${dRT !== null ? (dRT >= 0 ? '减少 ' + Math.abs(Math.round(dRT)) : '增加 ' + Math.abs(Math.round(dRT))) : '—'}）。<br>${verdict}`);
      }
      html += conclusionBox('imp', '你的位置', ctx.youSearch);
      boxS.innerHTML = html;
    } else {
      boxS.innerHTML = conclusionBox('wait', '等待数据', '实验一的数据还不够生成结论。');
    }

    /* 实验二 */
    const { num, gra } = ctx.cm;
    if (num.every(v => v !== null)) {
      const orderOK = num[0] <= num[1] && num[1] <= num[2] && num[2] <= num[3];
      let html = conclusionBox('rep', '复现结论',
        `数字作答下四种编码的平均误差：位置 <b>${num[0]}%</b>、长度 <b>${num[1]}%</b>、角度 <b>${num[2]}%</b>、面积 <b>${num[3]}%</b>。` +
        (orderOK
          ? `误差排序为"位置 &lt; 长度 &lt; 角度 &lt; 面积"，与 Cleveland &amp; McGill（1984）完全一致。这说明人眼读数的准确度取决于图表使用的视觉编码：沿共同标尺的位置最容易准确比较，长度次之，角度和面积最难。设计图表时，重要数值应优先用位置和长度呈现。`
          : `排序与 Cleveland &amp; McGill（1984）不完全一致（原文：位置 &lt; 长度 &lt; 角度 &lt; 面积），具体顺序见上方排名对比图。`));
      if (gra.every(v => v !== null)) {
        const gain = Lab.mean(num) - Lab.mean(gra);
        const gainWeak = (Lab.mean([num[2], num[3]]) - Lab.mean([gra[2], gra[3]]));
        html += conclusionBox('imp', '改进条件检验',
          `图形作答的平均误差为 <b>${Lab.mean(gra).toFixed(1)}%</b>，数字作答为 <b>${Lab.mean(num).toFixed(1)}%</b>` +
          `（图形作答${gain > 0 ? '更准' : '更差'} ${Math.abs(gain).toFixed(1)} 个百分点）；在角度和面积这两种较弱编码上，图形作答${gainWeak > 0 ? '的获益更大（' + gainWeak.toFixed(1) + ' 个百分点）' : '未显示出更大获益'}。` +
          (gain > 0
            ? `这支持兼容性原理的预测：用图形直接表达估计值，省掉了"把感觉转换成数字"这一步，误差随之减小。`
            : `这暂未支持兼容性原理的预测——图形作答没有更准，可能因为拖拽操作本身引入了操作误差，抵消了省去的数字转换。`));
      }
      html += conclusionBox('imp', '你的位置', ctx.youCM);
      boxC.innerHTML = html;
    } else {
      boxC.innerHTML = conclusionBox('wait', '等待数据', '实验二的数据还不够生成结论。');
    }

    /* 数字偏好 */
    const { rn, rg } = ctx.round;
    if (rn !== null && rg !== null) {
      boxR.innerHTML = conclusionBox('imp', '数字偏好检验结论',
        `数字作答中，<b>${rn}%</b> 的答案恰好落在 5 的倍数上；图形作答中只有 <b>${rg}%</b>。` +
        (rn > rg
          ? `这说明用数字报告比例时，人们不会给出连续精细的数值，而是倾向于就近取整；这种"取整"本身就是一种额外的误差来源。图形作答不存在这一步，因此分布更平滑。`
          : `两种作答方式的取整程度接近，取整偏差在本数据中不明显。`));
    } else {
      boxR.innerHTML = conclusionBox('wait', '等待数据', '实验二的数据还不够分析数字偏好。');
    }
  }

  /* ---------------- 启动 ---------------- */
  async function refresh() {
    const { src, data } = await loadData();
    const local = localData();
    renderStats(src, data);
    const search = renderSearch(data);
    renderSearchVs(data);
    const youSearch = renderYouSearch(data, local);
    const cm = renderCM(data);
    renderCMVs(cm.num);
    const youCM = renderYouCM(data, local);
    const round = renderRound(data);
    renderEffectSearch(data);
    renderEffectCM(data);
    renderGaze();
    renderConclusions(data, { search, cm, round, youSearch, youCM });
  }
  addEventListener('resize', () => {
    document.querySelectorAll('.chart').forEach(el => {
      const inst = echarts.getInstanceByDom(el);
      if (inst) inst.resize();
    });
  });
  refresh();
  setInterval(refresh, 30000);
})();
