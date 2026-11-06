/* ============================================================
   实验一 · 星云搜索（3D 视觉搜索）
   复现 Treisman & Gelade (1980)：特征搜索 vs 联合搜索 × 集合大小
   改进条件：联合搜索 + 目标特征预提示（引导搜索模型 / FIT）
   附加记录：注视轨迹（摄像头眼动或鼠标，由被试自选，仅存本机）
   ------------------------------------------------------------
   设计：
   - 练习 4 试次（有反馈）
   - 轮 A/B：特征搜索、联合搜索各 36 试次（顺序被试间随机平衡）
     （集合大小 4/12/24 × 有/无目标 × 6 → 每 类型×大小 条件 12 试次 ≥10）
   - 轮 C：联合搜索 + 预提示 36 试次（新增条件，固定最后）
   计时：performance.now()；按键 F=有目标 J=无目标（或屏幕按钮）。
   ============================================================ */
(function () {
  const pid = Lab.requireParticipant();
  if (!pid) return;

  /* ---------------- 常量 ---------------- */
  const RED = 0xF28482;          // 目标红（珊瑚红）
  const MINT = 0x3ECF8E;         // 干扰绿（薄荷绿）
  const SIZES = [4, 12, 24];     // 集合大小
  const REPS = 6;                // 每（集合大小×目标有无）6 次 → 每（类型×大小）条件 12 试次 ≥10
  const TIMEOUT = 8000;          // 超时 8 秒
  const ITI = 450;               // 试次间隔
  const FIX_MS = 600;            // 注视点时长

  /* ---------------- Three.js 场景 ---------------- */
  const stage = document.getElementById('stage');
  const W = () => stage.clientWidth, H = () => stage.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xFDF3EA);
  scene.fog = new THREE.Fog(0xFDF3EA, 16, 30);

  const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 100);
  camera.position.set(0, 0, 15);

  // 柔和糖果光照
  scene.add(new THREE.HemisphereLight(0xffffff, 0xE3C8FF, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(5, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xBDEFFF, 0.35);
  rim.position.set(-6, -3, 4);
  scene.add(rim);

  // 背景漂浮微粒（氛围，非刺激）
  const dust = (() => {
    const g = new THREE.BufferGeometry();
    const n = 90, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 36;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 2] = -6 - Math.random() * 14;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xB388EB, size: 0.12, transparent: true, opacity: 0.55 });
    const p = new THREE.Points(g, m);
    scene.add(p);
    return p;
  })();

  /* ---------------- 几何与材质 ---------------- */
  const donutGeo = new THREE.TorusGeometry(1, 0.42, 24, 48);          // 面包胚
  const frostGeo = new THREE.TorusGeometry(1, 0.34, 24, 48);          // 糖霜层
  const sprinkleGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.26, 8);  // 糖针
  const caneBodyGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.72, 20);   // 拐杖糖直杆
  const caneHookGeo = new THREE.TorusGeometry(0.34, 0.22, 16, 28, Math.PI); // 拐杖糖弯钩
  const caneTipGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 20);     // 弯钩短梢
  const caneCapGeo = new THREE.SphereGeometry(0.22, 14, 12);              // 圆头
  const matBread = new THREE.MeshStandardMaterial({ color: 0xE9B872, roughness: 0.6, metalness: 0.02 });
  const matRed = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.25, metalness: 0.05 });
  const matMint = new THREE.MeshStandardMaterial({ color: MINT, roughness: 0.25, metalness: 0.05 });
  const SPRINKLE_COLORS = [0xffffff, 0xFFE066, 0xB388EB, 0x38BDF8, 0xFF6B9D, 0xFFFDF9];
  const sprinkleMats = SPRINKLE_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));

  // 拐杖糖的螺旋条纹贴图（白底 + 彩色斜纹）
  function stripeTexture(colorHex, repX, repY) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#FFFDF9';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.save();
    ctx.translate(64, 64); ctx.rotate(-Math.PI / 4); ctx.translate(-64, -64);
    for (let i = -4; i < 8; i++) ctx.fillRect(i * 36, -64, 17, 256);
    ctx.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);
    return tex;
  }

  // 真正的甜甜圈：面包胚 + 糖霜 + 彩色糖针（frostMat 的颜色即搜索特征）
  function makeDonut(frostMat) {
    const g = new THREE.Group();
    const bread = new THREE.Mesh(donutGeo, matBread);
    bread.castShadow = true;
    const frost = new THREE.Mesh(frostGeo, frostMat);
    frost.position.z = 0.16;                       // 糖霜浮在面包表面
    frost.scale.set(1.02, 1.02, 1.15);             // 略微外溢、压扁出覆盖感
    frost.castShadow = true;
    g.add(bread, frost);
    const nSprinkle = 9;
    for (let i = 0; i < nSprinkle; i++) {
      const a = (i / nSprinkle) * Math.PI * 2 + Math.random() * 0.5;
      const rr = 1 + (Math.random() - 0.5) * 0.34;
      const sp = new THREE.Mesh(sprinkleGeo, sprinkleMats[i % sprinkleMats.length]);
      sp.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0.42);
      sp.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI);
      g.add(sp);
    }
    return g;
  }

  // 一根拐杖糖：直杆 + 顶部弯钩 + 短梢，螺旋条纹
  function makeCane(colorHex) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ map: stripeTexture(colorHex, 2, 3), roughness: 0.22, metalness: 0.04 });
    const matHook = new THREE.MeshStandardMaterial({ map: stripeTexture(colorHex, 3, 2), roughness: 0.22, metalness: 0.04 });
    const matCap = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3 });

    const body = new THREE.Mesh(caneBodyGeo, matBody);          // 直杆 y ∈ [-1.1, 0.62]
    body.position.y = -0.24;
    const hook = new THREE.Mesh(caneHookGeo, matHook);          // 半圆弯钩，中心 (-0.34, 0.62)
    hook.position.set(-0.34, 0.62, 0);
    const tip = new THREE.Mesh(caneTipGeo, matBody);            // 弯钩左端短梢
    tip.position.set(-0.68, 0.37, 0);
    const capB = new THREE.Mesh(caneCapGeo, matCap);            // 杆底圆头
    capB.position.set(0, -1.1, 0);
    const capT = new THREE.Mesh(caneCapGeo, matCap);            // 短梢圆头
    capT.position.set(-0.68, 0.12, 0);
    [body, hook, tip, capB, capT].forEach(m => { m.castShadow = true; g.add(m); });
    return g;
  }
  // X 形干扰子：两根交叉的拐杖糖
  function makeCanes(colorHex) {
    const g = new THREE.Group();
    const c1 = makeCane(colorHex);
    const c2 = makeCane(colorHex);
    c1.rotation.z = Math.PI / 4;
    c2.rotation.z = -Math.PI / 4;
    c2.position.z = 0.3;                      // 前后错开，避免穿插
    c2.scale.setScalar(0.92);
    g.add(c1, c2);
    return g;
  }

  /* ---------------- 目标/干扰子的真实小照片（给指导语和提示用） ---------------- */
  function makeThumbnail(buildFn, camZ) {
    const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r2.setSize(180, 180);
    r2.setPixelRatio(2);
    const s2 = new THREE.Scene();
    s2.add(new THREE.HemisphereLight(0xffffff, 0xE3C8FF, 0.9));
    const k2 = new THREE.DirectionalLight(0xffffff, 0.8);
    k2.position.set(4, 6, 5);
    s2.add(k2);
    const c2 = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    c2.position.set(0, 0, camZ || 4.6);
    const obj = buildFn();
    s2.add(obj);
    r2.render(s2, c2);
    const url = r2.domElement.toDataURL('image/png');
    r2.dispose();
    return url;
  }
  const thumbDonutRed = makeThumbnail(() => makeDonut(matRed), 4.4);
  const thumbDonutMint = makeThumbnail(() => makeDonut(matMint), 4.4);
  const thumbCanesRed = makeThumbnail(() => { const c = makeCanes(RED); c.rotation.z = 0; return c; }, 4.9);

  // 刺激组
  let stimGroup = null;
  const bobbers = [];

  function clearStimuli() {
    if (stimGroup) { scene.remove(stimGroup); stimGroup = null; }
    bobbers.length = 0;
  }

  // 在一个面向相机的圆盘上生成不重叠位置（随机撒点 + 网格兜底）
  function layoutPositions(n, spread) {
    const pts = [];
    let guard = 0;
    while (pts.length < n && guard++ < 4000) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const x = Math.cos(a) * r * 1.35;   // 横向拉宽成椭圆
      const y = Math.sin(a) * r * 0.78;
      const minD = spread > 7 ? 2.4 : 2.9;
      if (pts.every(p => Math.hypot(p.x - x, p.y - y) > minD)) pts.push({ x, y });
    }
    if (pts.length < n) {
      pts.length = 0;
      const rings = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (i % rings) * 0.35;
        const r = spread * (0.35 + 0.65 * ((i % rings) + 1) / rings);
        pts.push({
          x: Math.cos(a) * r * 1.35 + (Math.random() - 0.5) * 0.7,
          y: Math.sin(a) * r * 0.78 + (Math.random() - 0.5) * 0.7,
        });
      }
    }
    return pts;
  }

  function showStimuli(cond, setSize, present) {
    clearStimuli();
    stimGroup = new THREE.Group();
    const spread = setSize === 4 ? 3.6 : setSize === 12 ? 5.6 : 7.6;
    const pts = layoutPositions(setSize, spread);
    Lab.shuffle(pts);

    // 组成：目标 = 红甜甜圈
    // 特征：薄荷甜甜圈 × (n-1)
    // 联合：薄荷甜甜圈 + 红拐杖糖交叉（各与目标共享一个特征）
    const items = [];
    if (present) items.push('target');
    for (let i = items.length; i < setSize; i++) {
      if (cond === 'feature') items.push('mintO');
      else items.push(Math.random() < 0.5 ? 'mintO' : 'redX');
    }
    if (cond === 'conjunction' && setSize >= 4) {
      if (!items.includes('redX')) items[items.length - 1] = 'redX';
      if (!items.includes('mintO')) items[0] = 'mintO';
    }
    Lab.shuffle(items);

    items.forEach((kind, i) => {
      const obj = kind === 'target' ? makeDonut(matRed)
        : kind === 'mintO' ? makeDonut(matMint)
        : makeCanes(RED);
      const s = 0.9 + Math.random() * 0.15;
      obj.scale.setScalar(s);
      obj.position.set(pts[i].x, pts[i].y, (Math.random() - 0.5) * 2.2);
      obj.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * 0.6 - 0.3, Math.random() * Math.PI);
      stimGroup.add(obj);
      bobbers.push({ obj, y0: obj.position.y, ph: Math.random() * Math.PI * 2, sp: 0.6 + Math.random() * 0.8, amp: 0.06 + Math.random() * 0.08, rs: (Math.random() - 0.5) * 0.25 });
    });

    scene.add(stimGroup);
  }

  // 渲染循环（轻微浮动，让星云"活"起来）
  const clock = new THREE.Clock();
  let live = true;
  (function animate() {
    if (!live) return;
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    bobbers.forEach(b => {
      b.obj.position.y = b.y0 + Math.sin(t * b.sp + b.ph) * b.amp;
      b.obj.rotation.z += b.rs * 0.016;
    });
    dust.rotation.z = t * 0.008;
    renderer.render(scene, camera);
  })();

  addEventListener('resize', () => {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  });

  /* ---------------- 实验流程 ---------------- */
  const overlay = document.getElementById('overlay');
  const overlayCard = document.getElementById('overlay-card');
  const fixation = document.getElementById('fixation');
  const hudTrial = document.getElementById('hud-trial');
  const hudBlock = document.getElementById('hud-block');
  const cueBadge = document.getElementById('cue-badge');
  const progress = document.getElementById('progress');

  function buildTrials(cond, reps) {
    const cells = [];
    SIZES.forEach(s => [true, false].forEach(p => {
      for (let r = 0; r < reps; r++) cells.push({ cond, set: s, present: p });
    }));
    return Lab.shuffle(cells);
  }

  // A/B 轮顺序随机平衡；C 轮（提示）固定最后
  const abOrder = Lab.shuffle(['feature', 'conjunction']);
  const blocks = [
    { key: abOrder[0], label: '第一轮', cued: false, trials: buildTrials(abOrder[0], REPS) },
    { key: abOrder[1], label: '第二轮', cued: false, trials: buildTrials(abOrder[1], REPS) },
    { key: 'conjunction', label: '第三轮 · 带目标提示', cued: true, trials: buildTrials('conjunction', REPS) },
  ];
  const practiceTrials = Lab.shuffle([
    { cond: 'feature', set: 12, present: true },
    { cond: 'feature', set: 12, present: false },
    { cond: 'conjunction', set: 12, present: true },
    { cond: 'conjunction', set: 12, present: false },
  ]);

  const totalFormal = blocks.reduce((s, b) => s + b.trials.length, 0);
  const dataBaseline = [];   // experiment: search
  const dataCued = [];       // experiment: search_cued
  let doneFormal = 0;

  let phase = 'intro';       // intro | consent | calib | practice | block | break | end
  let curBlock = 0, curIdx = 0;
  let awaiting = false, t0 = 0, timeoutId = null, curTrial = null;

  function condName(c) { return c === 'feature' ? '特征搜索' : '联合搜索'; }

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

  /* ---------- 各阶段 ---------- */
  function showIntro() {
    showOverlay(`
      <h2>🍩 欢迎来到糖果星云</h2>
      <p>星云里漂浮着许多糖果，有<b style="color:#F28482">珊瑚红</b>的，也有<b style="color:#3ECF8E">薄荷绿</b>的：</p>
      <div style="display:flex; gap:18px; justify-content:center; align-items:flex-end; margin:14px 0 6px; flex-wrap:wrap">
        <div style="text-align:center"><img src="${thumbDonutRed}" style="width:86px;height:86px"><div style="font-size:13px;font-weight:800;margin-top:2px">红甜甜圈<br><span style="color:#F28482">← 你要找的</span></div></div>
        <div style="text-align:center"><img src="${thumbDonutMint}" style="width:86px;height:86px"><div style="font-size:13px;font-weight:800;margin-top:2px">绿甜甜圈<br><span style="color:var(--ink-soft)">干扰</span></div></div>
        <div style="text-align:center"><img src="${thumbCanesRed}" style="width:86px;height:86px"><div style="font-size:13px;font-weight:800;margin-top:2px">交叉拐杖糖<br><span style="color:var(--ink-soft)">干扰</span></div></div>
      </div>
      <p>每一幕，你的任务是判断：<b>有没有一颗「珊瑚红色的甜甜圈」？</b></p>
      <ul>
        <li>有 → 按 <kbd>F</kbd>（或点绿色按钮）</li>
        <li>没有 → 按 <kbd>J</kbd>（或点粉色按钮）</li>
      </ul>
      <p><b>又快又准！</b>答错没关系，别发呆就行。先练 4 次热热身，然后正式 3 轮（每轮 36 次，中间可以休息）。</p>
      <p style="text-align:center; margin-top:14px"><button class="btn btn-mint" id="ov-go">开始练习 →</button></p>
      <p style="color:var(--ink-faint); font-size:12.5px; margin-top:14px; text-align:center">本任务改编自 Treisman &amp; Gelade (1980) 的经典视觉搜索实验</p>
    `);
    document.getElementById('ov-go').onclick = showGazeConsent;
  }

  /* 注视记录授权：摄像头眼动 or 鼠标代替（被试自选） */
  function showGazeConsent() {
    phase = 'consent';
    showOverlay(Gaze.consentHTML());
    const status = document.getElementById('gz-status');
    document.getElementById('gz-cam').onclick = async () => {
      document.getElementById('gz-cam').disabled = true;
      document.getElementById('gz-mouse').disabled = true;
      const res = await Gaze.init('cam', stage, stage, msg => {
        status.textContent = msg;
        if (msg.indexOf('校准') !== -1) hideOverlay();   // 校准点在舞台上，先收起说明卡
      });
      if (res.ok) {
        if (res.mode === 'mouse') Lab.toast('🖱️ 已改用鼠标轨迹记录，开始练习', 'ok', 4000);
        else Lab.toast('📷 校准完成！开始练习', 'ok');
        startPractice();
      } else {
        // 摄像头没开起来：留在授权页，说明原因和修复方法，被试可重试或改选鼠标
        status.innerHTML = Gaze.diagHTML(res.error);
        document.getElementById('gz-cam').disabled = false;
        document.getElementById('gz-mouse').disabled = false;
      }
    };
    document.getElementById('gz-mouse').onclick = async () => {
      await Gaze.init('mouse', stage, stage);
      Lab.toast('🖱️ 好的，用鼠标轨迹记录。看哪里就把鼠标移到哪里～', 'ok', 4000);
      startPractice();
    };
  }

  function startPractice() {
    hideOverlay();
    phase = 'practice'; curIdx = 0;
    runTrial(practiceTrials[0], true);
  }

  function showBlockIntro(bi) {
    const b = blocks[bi];
    const isCued = b.cued;
    showOverlay(`
      <h2>${b.label}${isCued ? ' ✨' : ''}</h2>
      <p>本轮类型：<b>${condName(b.key)}</b>（${b.trials.length} 次）</p>
      ${isCued ? `
        <div class="note" style="margin:12px 0">
          <b>✨ 本轮有个小帮手：</b>先看清楚目标长这样——
          <div style="display:flex;align-items:center;gap:14px;justify-content:center;margin:14px 0">
            <img src="${thumbDonutRed}" style="width:74px;height:74px">
            <b>珊瑚红色甜甜圈</b>
          </div>
          本轮进行中，屏幕上方会一直贴着它的照片提醒你。
        </div>` : ''}
      <p style="text-align:center; margin-top:18px"><button class="btn btn-lav" id="ov-go">开始本轮 →</button></p>
    `);
    document.getElementById('ov-go').onclick = () => {
      hideOverlay();
      phase = 'block'; curBlock = bi; curIdx = 0;
      hudBlock.textContent = b.label + ' · ' + condName(b.key);
      if (isCued) {
        cueBadge.innerHTML = `<img src="${thumbDonutRed}" alt="目标">目标就是它`;
        cueBadge.style.display = 'flex';
      } else {
        cueBadge.style.display = 'none';
      }
      runTrial(blocks[bi].trials[0], false);
    };
  }

  function showBreak(nextBi) {
    showOverlay(`
      <h2>☕ 眨眨眼，休息一下</h2>
      <p>已完成 <b>${doneFormal}</b> / ${totalFormal} 次。喝口水、活动下眼球～</p>
      <p style="text-align:center; margin-top:18px"><button class="btn btn-aqua" id="ov-go">继续 →</button></p>
    `);
    document.getElementById('ov-go').onclick = () => showBlockIntro(nextBi);
  }

  function runTrial(trial, isPractice) {
    curTrial = trial;
    awaiting = false;
    clearStimuli();
    hudTrial.textContent = isPractice ? `练习 ${curIdx + 1} / ${practiceTrials.length}` : `第 ${doneFormal + 1} / ${totalFormal} 次`;
    progress.style.width = (doneFormal / totalFormal * 100) + '%';

    fixation.style.display = 'flex';
    setTimeout(() => {
      fixation.style.display = 'none';
      showStimuli(trial.cond, trial.set, trial.present);
      t0 = performance.now();
      awaiting = true;
      Gaze.beginTrial();                        // 练习与正式试次都记录注视轨迹
      timeoutId = setTimeout(() => resolveTrial(null), TIMEOUT);
    }, FIX_MS);
  }

  function resolveTrial(answer) {
    if (!awaiting) return;
    awaiting = false;
    clearTimeout(timeoutId);
    const rt = answer === null ? TIMEOUT : Math.round(performance.now() - t0);
    const correct = answer === null ? 0 : (answer === curTrial.present ? 1 : 0);
    const rec = {
      n: doneFormal + 1,
      cond: curTrial.cond + (blocks[curBlock] && blocks[curBlock].cued && phase === 'block' ? '_cued' : ''),
      set: curTrial.set,
      present: curTrial.present ? 1 : 0,
      rt: rt,
      correct: correct,
      timeout: answer === null ? 1 : 0,
    };

    if (phase === 'practice') {
      Gaze.endTrial('practice', curTrial.set, curTrial.cond);
      if (answer === null) {
        showFeedback('slow', '⏰', '太慢了！', '要在 8 秒内作答。这一幕其实' + (curTrial.present ? '有' : '没有') + '红色甜甜圈');
      } else if (correct) {
        showFeedback('good', '🎉', '答对了！', '反应时 ' + rt + ' ms');
      } else {
        showFeedback('bad', '👀', '答错了', '这一幕' + (curTrial.present ? '有' : '没有') + '红色甜甜圈，再看仔细一点');
      }
      clearStimuli();
      setTimeout(() => {
        hideFeedback();
        curIdx++;
        if (curIdx < practiceTrials.length) runTrial(practiceTrials[curIdx], true);
        else showBlockIntro(0);
      }, 1400);
      return;
    }

    // 正式试次：结束注视记录并存数据
    Gaze.endTrial(blocks[curBlock].cued ? 'cued' : 'base', curTrial.set, curTrial.cond);
    if (blocks[curBlock].cued) dataCued.push(rec); else dataBaseline.push(rec);
    doneFormal++;
    progress.style.width = (doneFormal / totalFormal * 100) + '%';

    setTimeout(() => {
      curIdx++;
      const b = blocks[curBlock];
      if (curIdx < b.trials.length) runTrial(b.trials[curIdx], false);
      else if (curBlock + 1 < blocks.length) showBreak(curBlock + 1);
      else finish();
    }, ITI);
  }

  function finish() {
    cueBadge.style.display = 'none';
    clearStimuli();
    phase = 'end';
    Gaze.stop();
    Lab.confetti(120);

    const all = dataBaseline.concat(dataCued);
    const acc = Math.round(Lab.mean(all.map(t => t.correct)) * 100);
    const rtM = Math.round(Lab.mean(all.filter(t => t.correct).map(t => t.rt)));

    showOverlay(`
      <p class="big-finish">🎉 搜索完成！</p>
      <p style="text-align:center; font-size:17px; margin-top:12px">你的总正确率 <b>${acc}%</b>，平均反应 <b>${rtM} ms</b>。</p>
      <p id="up-status" style="text-align:center; color:var(--ink-soft); font-size:14.5px">正在上传数据…</p>
      <p style="text-align:center; margin-top:16px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap">
        <button class="btn btn-mint" id="btn-exp2">去实验二 →</button>
        <button class="btn" id="btn-csv">下载数据备份 (CSV)</button>
        <a class="btn btn-ghost" href="results.html">看结果大屏</a>
      </p>
      <p style="text-align:center; margin-top:14px; font-size:14.5px">好奇刚才在测什么？<a href="learn.html" style="font-weight:900">🧪 去「实验讲解」看看 →</a></p>
      <p style="color:var(--ink-faint); font-size:12.5px; margin-top:12px; text-align:center">本任务改编自 Treisman, A. M., &amp; Gelade, G. (1980). A feature-integration theory of attention. <i>Cognitive Psychology, 12</i>(1), 97–136.</p>
    `);
    document.getElementById('btn-exp2').onclick = () => location.href = 'exp2.html';
    document.getElementById('btn-csv').onclick = () => {
      Lab.downloadCSV('search', dataBaseline);
      Lab.downloadCSV('search_cued', dataCued);
    };
    document.getElementById('btn-exp2').disabled = true;

    Promise.all([
      Lab.upload('search', '', dataBaseline),
      Lab.upload('search_cued', '', dataCued),
    ]).then(rs => {
      Lab.saveLocal('search', all);
      const okCount = rs.filter(r => r.ok).length;
      document.getElementById('up-status').innerHTML = okCount === 2
        ? '✅ 数据已上传（' + all.length + ' 个试次），感谢你的眼睛！'
        : '⚠️ 部分数据未上传成功，请务必点「下载数据备份」并发给主试';
      document.getElementById('btn-exp2').disabled = false;
    });
  }

  /* ---------- 输入 ---------- */
  addEventListener('keydown', e => {
    if (overlay.style.display !== 'none') return;
    if (e.code === 'KeyF') resolveTrial(true);
    else if (e.code === 'KeyJ') resolveTrial(false);
  });
  document.getElementById('btn-yes').addEventListener('click', () => resolveTrial(true));
  document.getElementById('btn-no').addEventListener('click', () => resolveTrial(false));

  addEventListener('beforeunload', e => {
    if (phase !== 'end' && doneFormal > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  Lab.renderNav('exp1');
  Lab.kineticTitle(document.getElementById('page-title'));
  showIntro();
})();
