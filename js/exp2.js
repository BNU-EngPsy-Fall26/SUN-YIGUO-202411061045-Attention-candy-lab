/* ============================================================
   实验二 · 比例眼力（Cleveland & McGill 1984 图形知觉）
   复现：位置 / 长度 / 角度 / 面积 四种编码的比例判断精度排序
   改进条件：作答方式——数字输入 vs 图形化拖拽（兼容性原理）
   ------------------------------------------------------------
   设计：4 编码 × 2 作答方式 × 10 试次 = 80 试次
   作答方式分两轮（顺序被试间随机平衡），编码在轮内混合。
   因变量：|估计值 − 真值|、作答时间（performance.now()）
   ============================================================ */
(function () {
  const pid = Lab.requireParticipant();
  if (!pid) return;

  const ENC_NAMES = { position: '位置', length: '长度', angle: '角度', area: '面积' };
  const ENC_ICONS = { position: '📍', length: '📏', angle: '🍕', area: '🫧' };
  const ENCODINGS = ['position', 'length', 'angle', 'area'];
  const REPS = 10;                 // 每编码每作答方式 10 试次 → 每条件 ≥10
  const INK = '#563E79';
  const COLORS = { a: '#B388EB', b: '#F28482' };   // A=薰衣草紫 B=珊瑚红

  /* ---------------- 画布 ---------------- */
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  let cw = 0, ch = 0;
  function fitCanvas() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    cw = r.width; ch = r.height;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  addEventListener('resize', fitCanvas);

  /* ---------------- 当前试次状态 ---------------- */
  let trial = null;          // {encoding, response, ratio}
  let answerVal = 0.5;       // 图形作答当前值（0~1）
  let dragging = false;
  let t0 = 0;
  let acceptAnswer = false;  // 仅在正式呈现刺激后可作答

  /* ---------------- 试次序列 ---------------- */
  const modeOrder = Lab.shuffle(['number', 'graphic']);
  const blocks = modeOrder.map(m => {
    const cells = [];
    ENCODINGS.forEach(e => { for (let r = 0; r < REPS; r++) cells.push({ encoding: e, response: m }); });
    return { response: m, trials: Lab.shuffle(cells) };
  });
  // 练习：每种编码各 1 题，两种作答方式交替覆盖（位置/角度=数字，长度/面积=图形）
  const practiceTrials = [
    { encoding: 'position', response: 'number' },
    { encoding: 'length', response: 'graphic' },
    { encoding: 'angle', response: 'graphic' },
    { encoding: 'area', response: 'number' },
  ];
  const totalFormal = blocks.reduce((s, b) => s + b.trials.length, 0);

  const dataNumber = [];     // experiment: cm
  const dataGraphic = [];    // experiment: cm_graphic
  let doneFormal = 0;
  let phase = 'intro', curBlock = 0, curIdx = 0;

  /* ---------------- 随机比例 ---------------- */
  function randRatio() {
    // 0.10~0.90，两位小数；避开离 0.5 太近和太整的数，增加区分度
    let r;
    do { r = Math.round((0.10 + Math.random() * 0.80) * 100) / 100; }
    while (Math.abs(r - 0.5) < 0.03);
    return r;
  }

  /* ---------------- 绘制 ---------------- */
  function rr(x, y, w, h, r) {  // 圆角矩形路径
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shadow(on) {
    if (on) { ctx.shadowColor = 'rgba(86,62,121,.28)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5; }
    else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  }

  // 画一个编码图形：val∈(0,1]，参照值 ref（A 恒为 1 的满尺寸）
  function drawEncoding(enc, cx, cy, S, val, color, label) {
    ctx.save();
    shadow(true);
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    if (enc === 'position') {
      // 标尺线 + 圆点
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy - S); ctx.lineTo(cx, cy + S); ctx.stroke();
      [cy - S, cy + S].forEach(y => { ctx.beginPath(); ctx.moveTo(cx - 10, y); ctx.lineTo(cx + 10, y); ctx.stroke(); });
      const y = cy + S - val * 2 * S;
      shadow(true);
      ctx.beginPath(); ctx.arc(cx, y, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (enc === 'length') {
      const w = 2 * S * val;
      rr(cx - w / 2, cy - 16, w, 32, 16); ctx.fill(); ctx.stroke();
    } else if (enc === 'angle') {
      const a = val * Math.PI * 1.5;   // 满值 = 270°
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, S * 0.8, -Math.PI / 2, -Math.PI / 2 + a);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (enc === 'area') {
      const r = S * 0.8 * Math.sqrt(val);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 高光泡泡感
      shadow(false);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
    shadow(false);
    if (label) {
      ctx.fillStyle = INK;
      ctx.font = '900 17px ' + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, cy + S + 30);
    }
    ctx.restore();
  }

  function draw() {
    if (!cw) return;
    ctx.clearRect(0, 0, cw, ch);
    if (!trial) return;

    const hasAnswerPad = trial.response === 'graphic';
    const topH = hasAnswerPad ? ch * 0.52 : ch * 0.72;
    const S = Math.min(cw, topH) * 0.30;

    // 题面
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = '900 20px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(ENC_ICONS[trial.encoding] + '  红色的 B 是紫色的 A 的百分之几？', cw / 2, 34);

    drawEncoding(trial.encoding, cw * 0.32, topH / 2 + 16, S, 1.0, COLORS.a, 'A');
    drawEncoding(trial.encoding, cw * 0.68, topH / 2 + 16, S, trial.ratio, COLORS.b, 'B');

    // 图形作答区
    if (hasAnswerPad) {
      const ay = topH + (ch - topH) / 2;
      ctx.strokeStyle = 'rgba(86,62,121,.25)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(30, topH + 8); ctx.lineTo(cw - 30, topH + 8); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = INK;
      ctx.font = '800 15px ' + getComputedStyle(document.body).fontFamily;
      ctx.fillText('👇 拖动下面的图形，把它调成你的答案（它现在 = A 的 ' + Math.round(answerVal * 100) + '%）', cw / 2, topH + 38);
      drawEncoding(trial.encoding, cw / 2, ay + 14, S * 0.9, Math.max(answerVal, 0.02), '#3ECF8E', null);
      // 提示光圈
      ctx.strokeStyle = '#3ECF8E';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(cw / 2, ay + 14, S * 0.9 + 16, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ---------------- 图形作答：指针 → 比例 ---------------- */
  function pointerToVal(e) {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const topH = ch * 0.52;
    const ay = topH + (ch - topH) / 2 + 14;
    const cx = cw / 2;
    const S = Math.min(cw, topH) * 0.30 * 0.9;
    if (trial.encoding === 'position') {
      const top = ay - S, bot = ay + S;
      return Math.min(1, Math.max(0, (bot - y) / (2 * S)));
    } else if (trial.encoding === 'length') {
      // 作答条以 cx 为中心，右端在 cx + S*val
      return Math.min(1, Math.max(0, (x - cx) / S));
    } else if (trial.encoding === 'angle') {
      let a = Math.atan2(y - ay, x - cx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      return Math.min(1, Math.max(0, a / (Math.PI * 1.5)));
    } else { // area
      const d = Math.hypot(x - cx, y - ay);
      const v = (d / S) * (d / S);
      return Math.min(1, Math.max(0, v));
    }
  }

  cv.addEventListener('pointerdown', e => {
    if (!acceptAnswer || trial.response !== 'graphic') return;
    dragging = true;
    cv.setPointerCapture(e.pointerId);
    answerVal = pointerToVal(e);
    draw();
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging) return;
    answerVal = pointerToVal(e);
    draw();
  });
  cv.addEventListener('pointerup', () => { dragging = false; });

  /* ---------------- 数字作答 ---------------- */
  const numPanel = document.getElementById('num-panel');
  const numSlider = document.getElementById('num-slider');
  const numVal = document.getElementById('num-val');
  numSlider.addEventListener('input', () => { numVal.textContent = numSlider.value + '%'; });

  /* ---------------- 流程 ---------------- */
  const overlay = document.getElementById('overlay');
  const overlayCard = document.getElementById('overlay-card');
  const hudTrial = document.getElementById('hud-trial');
  const hudMode = document.getElementById('hud-mode');
  const progress = document.getElementById('progress');
  const modeHint = document.getElementById('mode-hint');

  function showOverlay(html) { overlayCard.innerHTML = html; overlay.style.display = 'flex'; }
  function hideOverlay() { overlay.style.display = 'none'; }

  /* 练习反馈横幅（大而明显） */
  const fbEl = document.getElementById('feedback');
  function showFeedback(kind, icon, title, sub) {
    fbEl.className = 'feedback-flash ' + kind;
    fbEl.querySelector('.fb-icon').textContent = icon;
    fbEl.querySelector('.fb-title').textContent = title;
    fbEl.querySelector('.fb-sub').textContent = sub;
    fbEl.style.display = 'flex';
  }
  function hideFeedback() { fbEl.style.display = 'none'; }

  function startTrial(t, isPractice) {
    trial = { encoding: t.encoding, response: t.response, ratio: randRatio(), practice: isPractice };
    acceptAnswer = false;
    numPanel.style.display = t.response === 'number' ? 'flex' : 'none';
    if (t.response === 'number') {
      numSlider.value = 50; numVal.textContent = '50%';
      modeHint.textContent = '⌨️ 本题用滑块 + 数字回答';
    } else {
      answerVal = 0.3 + Math.random() * 0.4;
      modeHint.textContent = '🖐 本题直接用手"画"出答案，调好后点绿色按钮确认';
    }
    document.getElementById('graphic-panel').style.display = t.response === 'graphic' ? 'flex' : 'none';
    hudTrial.textContent = isPractice ? `练习 ${curIdx + 1} / ${practiceTrials.length}` : `第 ${doneFormal + 1} / ${totalFormal} 次`;
    hudMode.textContent = ENC_NAMES[t.encoding] + '编码 · ' + (t.response === 'number' ? '数字作答' : '图形作答');
    progress.style.width = (doneFormal / totalFormal * 100) + '%';
    draw();
    t0 = performance.now();
    acceptAnswer = true;
  }

  function submitAnswer() {
    if (!acceptAnswer || !trial) return;
    acceptAnswer = false;
    dragging = false;
    const est = trial.response === 'number' ? (numSlider.value / 100) : answerVal;
    const rt = Math.round(performance.now() - t0);
    const rec = {
      n: doneFormal + 1,
      encoding: trial.encoding,
      response: trial.response,
      true_ratio: trial.ratio,
      estimate: Math.round(est * 1000) / 1000,
      error: Math.round(Math.abs(est - trial.ratio) * 1000) / 1000,
      rt: rt,
    };

    if (trial.practice) {
      const truePct = Math.round(trial.ratio * 100);
      const mine = Math.round(est * 100);
      const diff = Math.abs(truePct - mine);
      showFeedback(
        diff <= 8 ? 'good' : 'bad',
        diff <= 8 ? '🎯' : '📐',
        diff <= 8 ? '很接近！' : '差了一点',
        '真值 ' + truePct + '%，你的答案 ' + mine + '%（相差 ' + diff + ' 个百分点）'
      );
      curIdx++;
      setTimeout(() => {
        hideFeedback();
        if (curIdx < practiceTrials.length) startTrial(practiceTrials[curIdx], true);
        else showBlockIntro(0);
      }, 1500);
      return;
    }

    (trial.response === 'number' ? dataNumber : dataGraphic).push(rec);
    doneFormal++;
    progress.style.width = (doneFormal / totalFormal * 100) + '%';
    curIdx++;
    setTimeout(() => {
      const b = blocks[curBlock];
      if (curIdx < b.trials.length) startTrial(b.trials[curIdx], false);
      else if (curBlock + 1 < blocks.length) showBreak();
      else finish();
    }, 350);
  }

  document.getElementById('btn-confirm').addEventListener('click', submitAnswer);
  document.getElementById('btn-confirm-graphic').addEventListener('click', submitAnswer);
  // 图形作答：双击画布确认 / 回车确认
  cv.addEventListener('dblclick', () => { if (trial && trial.response === 'graphic') submitAnswer(); });
  addEventListener('keydown', e => {
    if (e.key === 'Enter' && overlay.style.display === 'none') submitAnswer();
  });

  function modeName(m) { return m === 'number' ? '数字作答（滑块）' : '图形作答（拖拽）'; }

  function showIntro() {
    showOverlay(`
      <h2>🎨 比例眼力挑战</h2>
      <p>每题给你两个图形：紫色的 <b>A</b> 和红色的 <b>B</b>。请估计：<b>B 是 A 的百分之几？</b></p>
      <ul>
        <li>图形有四种画法：📍 位置、📏 长度、🍕 角度、🫧 面积</li>
        <li>作答方式有两种：<b>拖滑块报数字</b>，或<b>直接拖动一个同类图形"画"出答案</b>（调好以后点绿色按钮，或按 <kbd>Enter</kbd> / 双击画布）</li>
        <li>先练 4 次（会告诉你真值），然后正式 2 轮共 ${totalFormal} 题</li>
      </ul>
      <p><b>凭第一印象估，不要拿尺子量哦 😉</b></p>
      <p style="text-align:center; margin-top:18px"><button class="btn btn-pink" id="ov-go">开始练习 →</button></p>
      <p style="color:var(--ink-faint); font-size:12.5px; margin-top:14px; text-align:center">本任务改编自 Cleveland &amp; McGill (1984) 的图形知觉实验</p>
    `);
    document.getElementById('ov-go').onclick = () => { hideOverlay(); phase = 'practice'; curIdx = 0; startTrial(practiceTrials[0], true); };
  }

  function showBlockIntro(bi) {
    const b = blocks[bi];
    showOverlay(`
      <h2>${bi === 0 ? '第一轮' : '第二轮'} · ${modeName(b.response)}</h2>
      <p>${b.response === 'number'
        ? '这一轮，用<b>滑块</b>报出你估计的百分比，然后点「确认答案」。'
        : '这一轮，<b>直接拖动下方绿色图形</b>把它调成你的答案（拖点、拖条、拖扇区、拖泡泡都可以），调好后按 <kbd>Enter</kbd> 或<b>双击画布</b>确认。'}</p>
      <p>共 ${b.trials.length} 题。</p>
      <p style="text-align:center; margin-top:18px"><button class="btn btn-lav" id="ov-go">开始本轮 →</button></p>
    `);
    document.getElementById('ov-go').onclick = () => {
      hideOverlay(); phase = 'block'; curBlock = bi; curIdx = 0;
      startTrial(b.trials[0], false);
    };
  }

  function showBreak() {
    showOverlay(`
      <h2>☕ 第一轮完成！</h2>
      <p>已完成 <b>${doneFormal}</b> / ${totalFormal} 题。接下来换一种作答方式～</p>
      <p style="text-align:center; margin-top:18px"><button class="btn btn-aqua" id="ov-go">继续 →</button></p>
    `);
    document.getElementById('ov-go').onclick = () => showBlockIntro(1);
  }

  function finish() {
    phase = 'end';
    Lab.confetti(120);
    const all = dataNumber.concat(dataGraphic);
    const errM = (Lab.mean(all.map(t => t.error)) * 100).toFixed(1);
    const errNum = dataNumber.length ? (Lab.mean(dataNumber.map(t => t.error)) * 100).toFixed(1) : '—';
    const errGra = dataGraphic.length ? (Lab.mean(dataGraphic.map(t => t.error)) * 100).toFixed(1) : '—';

    showOverlay(`
      <p class="big-finish">🎉 眼力测试完成！</p>
      <p style="text-align:center; font-size:17px; margin-top:12px">
        你的平均误差 <b>${errM}%</b><br>
        <span style="font-size:15px; color:var(--ink-soft)">数字作答 ${errNum}% ｜ 图形作答 ${errGra}%</span>
      </p>
      <p id="up-status" style="text-align:center; color:var(--ink-soft); font-size:14.5px">正在上传数据…</p>
      <p style="text-align:center; margin-top:16px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap">
        <a class="btn btn-mint" href="results.html" id="btn-res">看结果大屏 →</a>
        <button class="btn" id="btn-csv">下载数据备份 (CSV)</button>
        <a class="btn btn-ghost" href="index.html">回首页</a>
      </p>
      <p style="text-align:center; margin-top:14px; font-size:14.5px">好奇刚才在测什么？<a href="learn.html" style="font-weight:900">🧪 去「实验讲解」看看 →</a></p>
      <p style="color:var(--ink-faint); font-size:12.5px; margin-top:12px; text-align:center">本任务改编自 Cleveland, W. S., &amp; McGill, R. (1984). Graphical perception: Theory, experimentation, and application to the development of graphical methods. <i>JASA, 79</i>(387), 531–554.</p>
    `);
    const resBtn = document.getElementById('btn-res');
    resBtn.style.pointerEvents = 'none'; resBtn.style.opacity = '.45';
    document.getElementById('btn-csv').onclick = () => {
      Lab.downloadCSV('cm', dataNumber);
      Lab.downloadCSV('cm_graphic', dataGraphic);
    };

    Promise.all([
      Lab.upload('cm', 'number', dataNumber),
      Lab.upload('cm_graphic', 'graphic', dataGraphic),
    ]).then(rs => {
      Lab.saveLocal('cm', all);
      const okCount = rs.filter(r => r.ok).length;
      document.getElementById('up-status').innerHTML = okCount === 2
        ? '✅ 数据已上传（' + all.length + ' 个试次），感谢你的眼睛！'
        : '⚠️ 部分数据未上传成功，请务必点「下载数据备份」并发给主试';
      resBtn.style.pointerEvents = ''; resBtn.style.opacity = '';
    });
  }

  addEventListener('beforeunload', e => {
    if (phase !== 'end' && doneFormal > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  Lab.renderNav('exp2');
  Lab.kineticTitle(document.getElementById('page-title'));
  fitCanvas();
  showIntro();
})();
