/* ============================================================
   注意力糖果工坊 · 公共模块
   配置 / 被试会话 / 数据上传（含 warnings 显示与 CSV 兜底）/ 动效工具
   ============================================================ */

/* ★★★ 项目配置：把 PROJECT 改成你在 /hw2 创建的 6 位项目码 ★★★ */
const CONFIG = {
  PROJECT: '36XXX9',                          // ← 改成你的项目码（公开，可写进网页）
  API: 'https://attention-lab-production.up.railway.app',
  DEBUG: false,                               // 调试时改 true，实验名会加 test_ 前缀
};

const Lab = (() => {

  /* ---------- 被试会话（仅存匿名编号，绝不收集姓名学号） ---------- */
  function getParticipant() {
    try { return sessionStorage.getItem('candy_pid') || ''; } catch (e) { return ''; }
  }
  function setParticipant(pid) {
    try { sessionStorage.setItem('candy_pid', pid); } catch (e) {}
  }
  function requireParticipant() {
    const pid = getParticipant();
    if (!pid) {
      const back = location.pathname.split('/').pop() || 'index.html';
      location.href = 'index.html?need=1&back=' + encodeURIComponent(back);
      return null;
    }
    return pid;
  }

  /* ---------- Toast ---------- */
  function toast(msg, type, ms) {
    let box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      setTimeout(() => t.remove(), 320);
    }, ms || 2600);
  }

  /* ---------- 彩带庆祝 ---------- */
  const CONFETTI_COLORS = ['#F28482', '#FF6B9D', '#B388EB', '#38BDF8', '#3ECF8E', '#FFC89F', '#E6FD8C'];
  function confetti(n) {
    n = n || 80;
    for (let i = 0; i < n; i++) {
      const bit = document.createElement('div');
      bit.className = 'confetti-bit';
      bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      bit.style.left = (Math.random() * 100) + 'vw';
      bit.style.top = '-20px';
      bit.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      if (Math.random() < 0.4) bit.style.borderRadius = '50%';
      document.body.appendChild(bit);
      const fall = bit.animate([
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: 'translateY(' + (innerHeight + 60) + 'px) rotate(' + (360 + Math.random() * 720) + 'deg)', opacity: 0.9 }
      ], { duration: 2200 + Math.random() * 1800, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 600 });
      fall.onfinish = () => bit.remove();
    }
  }

  /* ---------- 动能标题：把元素文本切成逐字弹入 ---------- */
  function kineticTitle(el) {
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    let i = 0;
    for (const ch of text) {
      const s = document.createElement('span');
      s.className = 'w';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.animationDelay = (i++ * 0.05) + 's';
      el.appendChild(s);
    }
  }

  /* ---------- 数据上传 ----------
     每完成一个实验条件，调用一次 upload(experiment, condition, trials)。
     - 自动加 test_ 前缀（CONFIG.DEBUG）
     - 后台返回 warnings 时弹条提醒并在页面显示
     - 失败时 try/catch 接住，提供 CSV 下载兜底
  ---------------------------------------------------------- */
  async function upload(experiment, condition, trials) {
    const pid = getParticipant() || 'anon';
    const expName = (CONFIG.DEBUG ? 'test_' : '') + experiment;
    const payload = {
      project: CONFIG.PROJECT,
      experiment: expName,
      participant: pid,
      condition: condition || '',
      trials: trials,
    };
    try {
      const resp = await fetch(CONFIG.API + '/api/hw2/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        toast('✅ 数据已提交（' + expName + '，' + trials.length + ' 个试次）', 'ok', 3000);
        if (data.warnings && data.warnings.length) {
          toast('⚠️ 后台警告：' + data.warnings.join('；'), 'warn', 8000);
          console.warn('[upload warnings]', data.warnings);
          showWarnings(data.warnings);
        }
        return { ok: true, data: data };
      }
      const msg = (data && data.msg) || ('HTTP ' + resp.status);
      throw new Error(msg);
    } catch (err) {
      console.error('[upload failed]', err);
      toast('❌ 数据未上传：' + err.message + '。请检查网络，并点「下载数据备份」', 'warn', 8000);
      return { ok: false, error: err.message };
    }
  }

  function showWarnings(warnings) {
    let el = document.getElementById('upload-warnings');
    if (!el) {
      el = document.createElement('div');
      el.id = 'upload-warnings';
      el.className = 'note';
      el.style.marginTop = '14px';
      document.body.appendChild(el);
    }
    el.innerHTML = '<b>⚠️ 上传警告（请调整数据编码后重试）：</b><br>' +
      warnings.map(w => '· ' + w).join('<br>');
  }

  /* ---------- CSV 兜底导出 ---------- */
  function downloadCSV(experiment, trials) {
    if (!trials || !trials.length) return;
    const keys = [];
    trials.forEach(t => Object.keys(t).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    const esc = v => {
      const s = String(v === undefined || v === null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [keys.join(',')].concat(trials.map(t => keys.map(k => esc(t[k])).join(',')));
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (CONFIG.DEBUG ? 'test_' : '') + experiment + '_' + (getParticipant() || 'anon') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- 本地结果存档（结果页"我的数据"用） ---------- */
  function saveLocal(experiment, trials) {
    try {
      const key = 'candy_local_' + experiment;
      const old = JSON.parse(localStorage.getItem(key) || '[]');
      localStorage.setItem(key, JSON.stringify(old.concat(trials)));
    } catch (e) {}
  }
  function loadLocal(experiment) {
    try { return JSON.parse(localStorage.getItem('candy_' + experiment) || '[]'); } catch (e) { return []; }
  }

  /* ---------- 导航栏 ---------- */
  function renderNav(active) {
    const pid = getParticipant();
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML =
      '<a class="brand" href="index.html"><span class="brand-dot"></span>注意力糖果工坊</a>' +
      '<nav class="topnav">' +
      '<a href="exp1.html"' + (active === 'exp1' ? ' class="on"' : '') + '>实验一 · 星云搜索</a>' +
      '<a href="exp2.html"' + (active === 'exp2' ? ' class="on"' : '') + '>实验二 · 比例眼力</a>' +
      '<a href="results.html"' + (active === 'results' ? ' class="on"' : '') + '>结果大屏</a>' +
      '<a href="learn.html"' + (active === 'learn' ? ' class="on"' : '') + '>实验讲解</a>' +
      '</nav>' +
      (pid ? '<span class="participant-chip">被试 ' + escapeHtml(pid) + '</span>' : '');
    document.body.prepend(bar);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 小工具 ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }

  return {
    CONFIG, getParticipant, setParticipant, requireParticipant,
    toast, confetti, kineticTitle, upload, downloadCSV,
    saveLocal, loadLocal, renderNav, escapeHtml, sleep, shuffle, mean,
  };
})();
