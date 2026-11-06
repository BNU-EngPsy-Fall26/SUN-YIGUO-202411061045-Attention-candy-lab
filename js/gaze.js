/* ============================================================
   注视追踪模块（眼动 / 鼠标两种模式）
   - 被试自主选择：摄像头眼动（WebGazer.js，画面绝不上传）或鼠标轨迹代替
   - 摄像头模式下先做 9 点点击校准，再做一次中心点精度验证
   - 注视/鼠标坐标只保存在本机浏览器（localStorage），不上传服务器
   坐标全部归一化到实验舞台（0–1），供结果页画热图
   ============================================================ */
const Gaze = (() => {
  const LS_KEY = 'candy_gaze_search';
  const SAMPLE_MS = 80;          // 采样间隔（两种模式共用）
  let mode = null;               // 'cam' | 'mouse'
  let stageEl = null;            // 坐标参照元素
  let recording = false;
  let curPts = null;             // 当前试次的点 [[x,y],...]
  let lastSample = 0;
  let trials = [];               // {b:'base'|'cued', set:n, pts:[[x,y]..]}
  let camReady = false;

  /* ---------- 本地存取 ---------- */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { return null; }
  }
  function saveAll() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ mode, trials }));
    } catch (e) { /* 存不下时静默丢弃，不影响实验 */ }
  }

  /* ---------- 坐标换算：视口坐标 → 舞台内 0–1 ---------- */
  function toStage(clientX, clientY) {
    if (!stageEl) return null;
    const r = stageEl.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;  // 允许少量出界
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }
  function pushPoint(clientX, clientY) {
    const now = performance.now();
    if (now - lastSample < SAMPLE_MS) return;
    lastSample = now;
    const p = toStage(clientX, clientY);
    if (p && curPts) curPts.push(p);
  }

  /* ---------- 鼠标模式 ---------- */
  function onMouseMove(e) { if (recording) pushPoint(e.clientX, e.clientY); }

  /* ---------- 摄像头模式（WebGazer） ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('load fail'));
      document.head.appendChild(s);
    });
  }
  /* 先自己探测一次摄像头：拿到真实的错误原因（webgazer 失败时只静默回调，不报原因）；
     探测用的流立刻关闭，随后 webgazer 会复用已授予的权限，不会二次弹窗。 */
  async function probeCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error('insecure-context'); e.name = 'InsecureContext'; throw e;
    }
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    s.getTracks().forEach(t => t.stop());
  }
  async function startCam(statusCb) {
    if (typeof webgazer === 'undefined') await loadScript('vendor/webgazer.js');
    webgazer.params.showVideo = true;
    webgazer.params.showGazeDot = false;      // 不显示注视点，避免干扰任务
    webgazer.params.showFaceOverlay = false;
    webgazer.params.showFaceFeedbackBox = false;
    webgazer.setRegression('ridge');
    webgazer.setGazeListener((data) => {
      if (!recording || !data) return;
      pushPoint(data.x, data.y);
    });

    statusCb && statusCb('📷 正在请求摄像头权限…（浏览器弹窗里请点「允许」）');
    await probeCamera();   // 失败会带出具体原因（拒绝/无设备/被占用/环境不支持）

    // webgazer.begin() 不返回 Promise：摄像头成功只体现在 isReady()，失败只走 onFail 回调。
    // 这里显式包装：等到视频流真正就绪才算成功；被拒绝/超时/设备缺失都算失败。
    const oldAlert = window.alert; window.alert = () => {};   // 压住它对 file:// 的误导性提示
    try {
      await new Promise((res, rej) => {
        let settled = false;
        const fail = () => { if (!settled) { settled = true; const e = new Error('camera-unavailable'); e.name = 'StreamFailed'; rej(e); } };
        webgazer.begin(fail);
        const t0 = performance.now();
        const iv = setInterval(() => {
          if (settled) { clearInterval(iv); return; }
          const v = document.getElementById('webgazerVideoFeed');
          const streaming = v && v.srcObject && v.readyState >= 2 && !v.paused;
          if ((webgazer.isReady && webgazer.isReady()) || streaming) {
            settled = true; clearInterval(iv); res();
          } else if (performance.now() - t0 > 25000) {
            fail(); clearInterval(iv);
          }
        }, 200);
      });
    } finally {
      window.alert = oldAlert;
    }
    statusCb && statusCb('📷 摄像头已打开，正在加载眼动模型…');
    camReady = true;
    const canv = document.getElementById('webgazerVideoCanvas');
    if (canv) canv.style.display = 'none';
  }

  /* ---------- 9 点校准 + 信号确认（点击小粉点，每点 2 次） ---------- */
  function calibrate(container) {
    return new Promise(resolve => {
      // 避开顶部提示条与右下角摄像头小窗的遮挡区
      const POS = [[0.08, 0.16], [0.5, 0.2], [0.92, 0.16], [0.08, 0.5], [0.5, 0.5], [0.92, 0.5], [0.08, 0.86], [0.5, 0.84], [0.88, 0.72]];
      let idx = 0, clicks = 0, done = false;
      const dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;width:26px;height:26px;border-radius:50%;background:#FF6B9D;border:3px solid #fff;box-shadow:0 0 0 2.5px #563E79;cursor:pointer;z-index:70;transition:transform .12s;';
      const tip = document.createElement('div');
      tip.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:41;pointer-events:none;background:#fff;border:3px solid #563E79;border-radius:999px;padding:6px 18px;font-weight:900;font-size:14px;white-space:nowrap;';
      const bail = document.createElement('button');
      bail.textContent = '校准卡住了？改用鼠标 →';
      bail.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:71;background:#fff;border:2.5px solid #563E79;border-radius:999px;padding:5px 14px;font-weight:700;font-size:12.5px;color:#563E79;cursor:pointer;';
      container.appendChild(dot); container.appendChild(tip); container.appendChild(bail);
      function cleanup() { dot.remove(); tip.remove(); bail.remove(); }
      function finish(r) { if (done) return; done = true; cleanup(); resolve(r); }
      function place() {
        const [fx, fy] = POS[idx];
        dot.style.left = `calc(${fx * 100}% - 13px)`;
        dot.style.top = `calc(${fy * 100}% - 13px)`;
        tip.textContent = `🎯 校准：盯着粉色点，点它 2 次（${idx + 1} / ${POS.length}）`;
      }
      dot.addEventListener('click', () => {
        const [fx, fy] = POS[idx];
        const r = container.getBoundingClientRect();
        try { webgazer.recordScreenPosition(r.left + fx * r.width, r.top + fy * r.height, 'click'); } catch (e) {}
        clicks++;
        dot.style.transform = 'scale(.7)';
        setTimeout(() => dot.style.transform = '', 120);
        if (clicks >= 2) { clicks = 0; idx++; }
        if (idx >= POS.length) signalCheck(); else place();
      });
      bail.addEventListener('click', () => finish('mouse'));

      /* 信号确认：盯着中心点约 3 秒，必须真的读到注视预测才放行。
         若校准时人脸未被追踪，回归没有训练数据，预测将永远为 null —— 在这里拦下。 */
      function signalCheck() {
        dot.style.left = 'calc(50% - 13px)';
        dot.style.top = 'calc(50% - 13px)';
        dot.style.cursor = 'default';
        dot.style.pointerEvents = 'none';
        let valid = 0, ticks = 0;
        tip.textContent = '👁️ 最后一步：盯着中心这个点看 3 秒，确认眼动信号…';
        const timer = setInterval(() => {
          ticks++;
          let p = null;
          try { p = webgazer.getCurrentPrediction(); } catch (e) {}
          if (p && isFinite(p.x) && isFinite(p.y)) { valid++; dot.style.background = '#3ECF8E'; }
          tip.textContent = `👁️ 确认眼动信号中… ${Math.min(100, Math.round(ticks / 22 * 100))}%（已读到 ${valid} 次）`;
          if (ticks >= 22) {  // ~3.5 秒
            clearInterval(timer);
            if (valid >= 4) finish('done');
            else {
              tip.textContent = '😅 没有读到注视信号';
              dot.style.display = 'none';
              const card = document.createElement('div');
              card.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:72;background:#fff;border:3px solid #563E79;border-radius:18px;padding:18px 22px;max-width:430px;text-align:center;font-size:14.5px;line-height:1.7;box-shadow:5px 5px 0 rgba(86,62,121,.25);';
              card.innerHTML = '<b style="font-size:16px">😅 摄像头没有认出你的眼睛</b><br>' +
                '可能是光线太暗、脸不在右下角的小画面里，或摄像头刚启动还没准备好。<br>' +
                '请调整坐姿和光线，让整张脸都出现在画面中，然后再试一次；也可以直接改用鼠标轨迹。' +
                '<div style="display:flex;gap:10px;justify-content:center;margin-top:14px">' +
                '<button id="gz-retry" style="background:#B388EB;color:#fff;border:2.5px solid #563E79;border-radius:999px;padding:7px 18px;font-weight:900;cursor:pointer">🔄 重新校准</button>' +
                '<button id="gz-tomouse" style="background:#fff;border:2.5px solid #563E79;border-radius:999px;padding:7px 18px;font-weight:900;color:#563E79;cursor:pointer">🖱️ 改用鼠标</button></div>';
              container.appendChild(card);
              card.querySelector('#gz-retry').onclick = () => { card.remove(); finish('retry'); };
              card.querySelector('#gz-tomouse').onclick = () => { card.remove(); finish('mouse'); };
            }
          }
        }, 160);
      }

      place();
    });
  }

  /* ---------- 对外接口 ---------- */
  return {
    get mode() { return mode; },
    get camReady() { return camReady; },

    /** 同意选择卡（仿课程实验室）：返回 Promise<'cam'|'mouse'>，内容由调用方放进覆盖层 */
    consentHTML() {
      return `
        <h2>👁️ 注视记录小授权</h2>
        <p>这个实验想多记录一件事：每一幕你<b>先看了哪里</b>。有两种方式，你说了算：</p>
        <ul style="font-size:14.5px">
          <li><b>摄像头眼动：</b>用你的摄像头估计注视点。<b>视频画面绝不上传</b>，只在本机浏览器里实时算成坐标；只保存注视坐标（约每秒 12 次）。</li>
          <li><b>鼠标代替：</b>不开摄像头，用鼠标轨迹近似代替注视（看哪里就把鼠标移到哪里）。</li>
          <li>两种方式都不影响你完成实验；网页眼动精度有限，结果仅供课堂探索。</li>
        </ul>
        <p style="text-align:center; margin-top:16px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap">
          <button class="btn btn-coral" id="gz-cam">📷 同意，用摄像头眼动</button>
          <button class="btn btn-aqua" id="gz-mouse">🖱️ 不用摄像头，用鼠标代替</button>
        </p>
        <p id="gz-status" style="text-align:center; color:var(--ink-soft); font-size:14px; margin-top:10px"></p>`;
    },

    /** 初始化：mode 选定后调用。stage = 坐标参照元素；container = 校准点容器 */
    async init(chosen, stage, container, statusCb) {
      mode = chosen;
      stageEl = stage;
      if (chosen === 'mouse') {
        addEventListener('mousemove', onMouseMove);
        return { ok: true, mode };
      }
      try {
        statusCb && statusCb('正在打开摄像头、加载眼动模型…（第一次约需几秒）');
        await startCam(statusCb);
        statusCb && statusCb('📷 摄像头已就绪，开始校准');
        let r = await calibrate(container);
        while (r === 'retry') {
          statusCb && statusCb('📷 重新校准中');
          r = await calibrate(container);
        }
        if (r === 'mouse') {
          // 被试主动改用鼠标 / 眼动信号读不到：关掉摄像头，退回鼠标轨迹
          try { webgazer.end(); } catch (e) {}
          camReady = false;
          mode = 'mouse';
          addEventListener('mousemove', onMouseMove);
          return { ok: true, mode, switched: true };
        }
        return { ok: true, mode };
      } catch (e) {
        // 摄像头没开起来：不静默跳过，把原因交还给调用方，由被试决定重试还是改用鼠标
        try { if (camReady && typeof webgazer !== 'undefined') webgazer.end(); } catch (e2) {}
        camReady = false;
        mode = null;
        return { ok: false, error: e };
      }
    },

    /** 把摄像头失败原因翻译成可操作的指引（诊断 + 怎么修） */
    diagHTML(e) {
      const name = (e && e.name) || '';
      const inIframe = window.self !== window.top;
      let title = '😢 摄像头没有打开', fix = '';
      if (inIframe && (name === 'NotAllowedError' || name === 'SecurityError' || name === 'StreamFailed')) {
        fix = '你现在是在<b>嵌套的预览小窗</b>里打开本页的，摄像头权限被外层页面拦截了。<br>👉 请把本页链接<b>复制到浏览器新标签页单独打开</b>，再点「重试摄像头」。';
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        fix = '摄像头权限被拒绝了。👉 点击浏览器<b>地址栏左侧的 🔒 / 📷 图标</b>，把摄像头改为「允许」，然后点下方「重试摄像头」。<br><span style="font-size:13px;color:var(--ink-soft)">（Mac 用户还需确认：系统设置 → 隐私与安全性 → 摄像头 中允许了当前浏览器。）</span>';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        fix = '没有检测到摄像头设备。👉 请确认摄像头已连接、未被系统禁用，然后重试。';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        fix = '摄像头正被其他程序占用（如会议/网课软件）。👉 关闭占用它的程序后点「重试摄像头」。';
      } else if (name === 'InsecureContext') {
        fix = '当前打开方式不支持调用摄像头。👉 请通过<b>网页链接（https）</b>打开本实验；直接双击本地 html 文件时，部分浏览器会禁用摄像头。';
      } else {
        fix = '请检查：浏览器地址栏左侧的权限图标是否允许了摄像头；摄像头是否被其他程序占用；然后点「重试摄像头」。';
      }
      return `<b>${title}</b><br>${fix}<br><span style="font-size:13px;color:var(--ink-soft)">实在开不起来也没关系，点「不用摄像头，用鼠标代替」一样可以完成实验。</span>`;
    },

    /** 试次开始/结束 */
    beginTrial() { curPts = []; recording = true; lastSample = 0; },
    endTrial(blockKey, setSize, cond) {
      recording = false;
      if (curPts) {
        trials.push({ b: blockKey, set: setSize, c: cond || '', pts: curPts.slice(0, 200) });
        curPts = null;
        saveAll();
      }
    },
    pauseRec() { recording = false; },
    resumeRec() { recording = true; },

    stop() {
      recording = false;
      removeEventListener('mousemove', onMouseMove);
      if (camReady && typeof webgazer !== 'undefined') { try { webgazer.end(); } catch (e) {} }
    },

    /** 结果页读取：{mode, trials:[{b,set,pts}]} */
    read() { return loadAll(); },
  };
})();
