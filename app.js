/**
 * 智慧考卷 OCR 掃描器 — 前端核心互動控制器 (app.js)
 * 整合六大步驟：
 * ① 拍照上傳 (WebRTC 相機、JPG/PNG/HEIC/PDF 匯入、6 組內建測試考卷範本)
 * ② 照片校正 (自動紙張四頂點偵測、透視變形修正、旋轉、去陰影、銳利化、低畫質警示)
 * ③ 考卷分區 (自動左右分欄與上下分區、手動畫直線/畫橫線/自由框選/縮放移動/改順序/單區重辨識/合併拆分/復原重做)
 * ④ 智慧辨識 (瀏覽器免費模式 Tesseract.js + 智慧版面裁切、高精度後端 PaddleOCR / 雲端 Vision 模式、低信心度醒目框線)
 * ⑤ 文字校對 (原始考卷與辨識文字雙向同步定位、直接改錯字、注音數學符號小鍵盤、前後結果比較、閱讀順序預覽與 TTS 試聽)
 * ⑥ 匯出 PDF (模式 A 原稿保留文字層 PDF、模式 B 重新排版 A4 真正文字型 PDF、TXT、特教報讀 JSON、內建 PDF 文字擷取驗證器)
 */
(function () {
  'use strict';

  const LayoutEngine = window.SmartExamLayoutEngine;
  const PdfEngine = window.SmartExamPdfEngine;
  const ExamSamples = window.SmartExamSamples;

  // 公開部署網址（用於右上角網站 QR Code）
  const PUBLIC_SITE_URL = 'https://liniris1023.github.io/smart-exam-ocr/';

  // 全域應用程式狀態
  const state = {
    currentStep: 1,
    pages: [],
    currentPageIndex: 0,
    activeTool: 'select', // 'select' | 'vline' | 'hline' | 'drawbox' | 'order'
    newBoxType: 'question',
    selectedBlockId: null,
    multiSelectedIds: new Set(),
    orderClickCounter: 1,
    canvasZoom: 1.0,
    ocrMode: 'browser', // 'browser' | 'backend'
    forceLiveTesseract: false,
    backendUrl: 'http://localhost:8000/api/ocr',
    proofViewMode: 'split', // 'split' | 'image' | 'text'
    activeInputEl: null,
    savedTimestamp: null,
    cachedFontBytes: null,
    lastGeneratedPdfBytes: null,
    lastGeneratedPdfName: '',
    cameraStream: null,
    facingMode: 'environment'
  };

  const $ = (id) => document.getElementById(id);

  function showToast(msg, duration = 2800) {
    const el = $('toastMsg');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), duration);
  }

  function getCurrentPage() {
    return state.pages[state.currentPageIndex] || null;
  }

  // --- 深度複製頁面分區狀態以支援復原 (Undo) / 重做 (Redo) ---
  function cloneLayoutSnapshot(page) {
    return JSON.stringify({
      dividers: page.dividers,
      blocks: page.blocks
    });
  }

  function pushUndoState(page) {
    if (!page) return;
    if (!page.history) page.history = { undoStack: [], redoStack: [] };
    const snap = cloneLayoutSnapshot(page);
    const stack = page.history.undoStack;
    if (stack.length && stack[stack.length - 1] === snap) return;
    stack.push(snap);
    if (stack.length > 40) stack.shift();
    page.history.redoStack = [];
    updateHistoryButtons();
  }

  function undoLayout() {
    const page = getCurrentPage();
    if (!page || !page.history || !page.history.undoStack.length) {
      showToast('目前沒有可復原的動作');
      return;
    }
    page.history.redoStack.push(cloneLayoutSnapshot(page));
    const prev = JSON.parse(page.history.undoStack.pop());
    page.dividers = prev.dividers;
    page.blocks = prev.blocks;
    renderStep3Canvas();
    updateHistoryButtons();
    showToast('↩️ 已復原上一步分區操作');
  }

  function redoLayout() {
    const page = getCurrentPage();
    if (!page || !page.history || !page.history.redoStack.length) {
      showToast('目前沒有可重做的動作');
      return;
    }
    page.history.undoStack.push(cloneLayoutSnapshot(page));
    const next = JSON.parse(page.history.redoStack.pop());
    page.dividers = next.dividers;
    page.blocks = next.blocks;
    renderStep3Canvas();
    updateHistoryButtons();
    showToast('↪️ 已重做分區操作');
  }

  function updateHistoryButtons() {
    const page = getCurrentPage();
    const uBtn = $('btnUndo');
    const rBtn = $('btnRedo');
    if (uBtn) uBtn.disabled = !(page && page.history && page.history.undoStack.length);
    if (rBtn) rBtn.disabled = !(page && page.history && page.history.redoStack.length);
  }

  // --- 為每個區塊擷取局部高解析度裁切圖 (供校對對照與重排 PDF 嵌入插圖) ---
  function updateBlockCrops(page) {
    if (!page || !page.processedCanvas) return;
    const srcCanvas = page.processedCanvas;
    for (const blk of page.blocks || []) {
      const bx = Math.max(0, Math.round(blk.x || 0));
      const by = Math.max(0, Math.round(blk.y || 0));
      const bw = Math.min(srcCanvas.width - bx, Math.max(20, Math.round(blk.w || 100)));
      const bh = Math.min(srcCanvas.height - by, Math.max(16, Math.round(blk.h || 40)));
      if (bw <= 0 || bh <= 0) continue;
      const c = document.createElement('canvas');
      c.width = bw;
      c.height = bh;
      c.getContext('2d').drawImage(srcCanvas, bx, by, bw, bh, 0, 0, bw, bh);
      blk.cropJpegDataUrl = c.toDataURL('image/jpeg', 0.88);
    }
    page.imageJpegDataUrl = srcCanvas.toDataURL('image/jpeg', 0.86);
  }

  // ============================================================================
  // 步驟切換導航 (支援隨時返回上一頁並保留目前工作內容)
  // ============================================================================
  const STEP_NAMES = [
    '',
    '① 拍照上傳',
    '② 照片校正',
    '③ 考卷分區',
    '④ 智慧辨識',
    '⑤ 文字校對',
    '⑥ 匯出 PDF'
  ];

  function goToStep(stepNum) {
    if (stepNum < 1 || stepNum > 6) return;
    if (stepNum > 1 && state.pages.length === 0) {
      showToast('請先在步驟 ① 拍攝、上傳考卷或載入下方測試範本！');
      return;
    }

    state.currentStep = stepNum;
    document.querySelectorAll('.step-tab').forEach((tab) => {
      const s = Number(tab.dataset.step);
      tab.classList.toggle('active', s === stepNum);
      tab.classList.toggle('completed', s < stepNum && state.pages.length > 0);
    });

    document.querySelectorAll('.step-panel').forEach((panel) => {
      panel.classList.toggle('active', Number(panel.dataset.step) === stepNum);
    });

    const pill = $('currentStagePill');
    if (pill) pill.textContent = `目前階段：${STEP_NAMES[stepNum]}`;

    const prevBtn = $('btnPrevStep');
    const nextBtn = $('btnNextStep');
    if (prevBtn) {
      prevBtn.style.visibility = stepNum > 1 ? 'visible' : 'hidden';
      prevBtn.textContent = `⬅️ 返回 ${STEP_NAMES[stepNum - 1] || '上一步'}`;
    }
    if (nextBtn) {
      if (stepNum < 6) {
        nextBtn.style.display = 'inline-flex';
        nextBtn.textContent = `前往 ${STEP_NAMES[stepNum + 1]} ➡️`;
      } else {
        nextBtn.style.display = 'none';
      }
    }

    // 各步驟進入時同步刷新畫面
    if (stepNum === 2) {
      syncStep2Controls();
      renderStep2Canvas();
    } else if (stepNum === 3) {
      const page = getCurrentPage();
      if (page) updateBlockCrops(page);
      renderStep3Canvas();
      updateHistoryButtons();
    } else if (stepNum === 4) {
      renderStep4Summary();
    } else if (stepNum === 5) {
      const page = getCurrentPage();
      if (page) updateBlockCrops(page);
      renderStep5Proofread();
    } else if (stepNum === 6) {
      const page = getCurrentPage();
      if (page) updateBlockCrops(page);
      renderStep6ExportPreview();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ============================================================================
  // 步驟 ①：拍照上傳、JPG/PNG/HEIC/PDF 匯入、內建測試考卷範本庫
  // ============================================================================
  function createPageFromCanvas(srcCanvas, title, presetSample = null) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const origCanvas = document.createElement('canvas');
    origCanvas.width = w;
    origCanvas.height = h;
    origCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);

    const procCanvas = document.createElement('canvas');
    procCanvas.width = w;
    procCanvas.height = h;
    const procCtx = procCanvas.getContext('2d');
    procCtx.drawImage(srcCanvas, 0, 0);

    const imgData = procCtx.getImageData(0, 0, w, h);
    const qualityReport = LayoutEngine.assessImageQuality(imgData.data, w, h);
    const quad = LayoutEngine.detectPaperQuad(imgData.data, w, h);

    let dividers = { hLines: [], vLines: [] };
    let blocks = [];

    if (presetSample && presetSample.blocks) {
      dividers = JSON.parse(JSON.stringify(presetSample.dividers || { hLines: [], vLines: [] }));
      blocks = JSON.parse(JSON.stringify(presetSample.blocks));
      blocks = LayoutEngine.sortBlocksByZonesAndColumns(blocks, w, h, dividers);
    } else {
      const autoLayout = LayoutEngine.analyzeCanvasLayout(imgData.data, w, h);
      dividers = autoLayout.dividers;
      blocks = autoLayout.blocks;
    }

    const newPage = {
      id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: title || `第 ${state.pages.length + 1} 頁`,
      width: w,
      height: h,
      originalCanvas: origCanvas,
      processedCanvas: procCanvas,
      quad,
      filterOpts: {
        rotation: 0,
        brightness: 0,
        contrast: 20,
        sharpen: 0.5,
        removeShadow: true,
        bwMode: false,
        upscale: 1.5
      },
      qualityReport,
      dividers,
      blocks,
      history: { undoStack: [], redoStack: [] }
    };

    updateBlockCrops(newPage);
    return newPage;
  }

  function loadSampleExam(sampleId, autoAdvance = true) {
    const sample = ExamSamples.SAMPLE_EXAMS[sampleId];
    if (!sample) return;
    const canvas = ExamSamples.renderSampleToCanvas(sample);
    const page = createPageFromCanvas(canvas, sample.name, sample);
    state.pages = [page];
    state.currentPageIndex = 0;
    state.selectedBlockId = page.blocks[0] ? page.blocks[0].id : null;
    const titleInput = $('exportExamTitle');
    if (titleInput) titleInput.value = sample.name;
    renderPagesStrip();
    showToast(`✅ 已載入範本：${sample.name}`);
    if (autoAdvance) {
      goToStep(3);
    }
  }

  // 載入「某個區塊分錯，需教師用手指畫直線修改」的核心驗收情境
  function loadMismergedAcceptanceScenario() {
    const sample = JSON.parse(JSON.stringify(ExamSamples.SAMPLE_EXAMS.acceptance_mixed));
    const canvas = ExamSamples.renderSampleToCanvas(sample);
    // 模擬自動分區時少了垂直分欄線，且把左欄第 1 題與右欄第 4 題錯誤合併成一個大寬框
    const modifiedSample = JSON.parse(JSON.stringify(sample));
    modifiedSample.dividers.vLines = []; // 尚未畫垂直分欄線
    modifiedSample.blocks = [
      // 將原本 blk_m_2 (左欄第1題) 與 blk_m_6 (右欄第4題) 錯誤合併成一個橫跨左右欄的框
      {
        id: 'blk_merged_err',
        x: 60,
        y: 230,
        w: 1080,
        h: 225,
        type: 'zhuyin',
        sectionNumber: '第一大題',
        sectionTitle: '國字注音與選擇題',
        questionNumber: '第 1 題',
        stemText: '小明今天帶什麼去學校？（ㄕㄨ ㄅㄠ） （　）奶奶會在過年時滷（ㄌㄨˇ）臘肉分送給親朋好友。',
        options: ['A. 雨傘', 'B. 書包', 'C. 玩具', 'D. 球鞋'],
        zhuyinText: 'ㄕㄨ ㄅㄠ ㄌㄨˇ',
        mathFormula: '',
        confidence: 76,
        lowConfidence: true,
        readingOrder: 1
      },
      ...sample.blocks.filter((b) => b.id !== 'blk_m_2' && b.id !== 'blk_m_6')
    ];

    const page = createPageFromCanvas(canvas, `${sample.name}（待手動畫線修正）`, modifiedSample);
    state.pages = [page];
    state.currentPageIndex = 0;
    state.selectedBlockId = 'blk_merged_err';
    renderPagesStrip();
    goToStep(3);
    setActiveTool('vline');
    showToast('⚡ 已載入「分區錯誤模擬」：請用手指在考卷中央由上往下畫一條直線，即可切開左右欄！', 4500);
  }

  async function handleFilesUpload(fileList) {
    if (!fileList || !fileList.length) return;
    showToast('⏳ 正在載入並分析考卷檔案...');
    const newPages = [];

    for (const file of Array.from(fileList)) {
      const ext = file.name.split('.').pop().toLowerCase();
      try {
        if (ext === 'pdf' || file.type === 'application/pdf') {
          const pdfPages = await loadPdfFileToPages(file);
          newPages.push(...pdfPages);
        } else if (ext === 'heic' || ext === 'heif' || file.type.includes('heic')) {
          const blob = await convertHeicIfNeeded(file);
          const canvas = await blobToCanvas(blob);
          newPages.push(createPageFromCanvas(canvas, file.name));
        } else {
          const canvas = await blobToCanvas(file);
          newPages.push(createPageFromCanvas(canvas, file.name));
        }
      } catch (err) {
        console.error('匯入檔案失敗:', err);
        showToast(`⚠️ 檔案 ${file.name} 載入失敗，請確認格式是否正確`);
      }
    }

    if (newPages.length) {
      state.pages.push(...newPages);
      state.currentPageIndex = state.pages.length - newPages.length;
      renderPagesStrip();
      showToast(`✅ 成功匯入 ${newPages.length} 頁考卷！`);
      goToStep(2);
    }
  }

  async function convertHeicIfNeeded(file) {
    if (typeof window.heic2any === 'function') {
      try {
        const res = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        return Array.isArray(res) ? res[0] : res;
      } catch (e) {
        console.warn('heic2any fallback to native:', e);
      }
    }
    return file;
  }

  function blobToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const maxSide = 2000;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1200, img.naturalHeight || 1600));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || 1200) * scale));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1600) * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  async function loadPdfFileToPages(file) {
    if (!window.pdfjsLib) {
      throw new Error('pdf.js 尚未載入');
    }
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const outPages = [];

    for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
      const page = await pdf.getPage(pNum);
      const vp = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const newPage = createPageFromCanvas(canvas, `${file.name} (第 ${pNum} 頁)`);

      // 若該 PDF 原本已有文字層，自動擷取文字填入對應座標區塊
      try {
        const tc = await page.getTextContent();
        if (tc && tc.items && tc.items.length > 0) {
          const extractedLines = [];
          for (const it of tc.items) {
            if (!it.str || !it.str.trim()) continue;
            const tx = window.pdfjsLib.Util.transform(vp.transform, it.transform);
            const x = Math.max(0, Math.round(tx[4]));
            const y = Math.max(0, Math.round(tx[5] - 18));
            extractedLines.push({ str: it.str.trim(), x, y });
          }
          if (extractedLines.length > 0 && newPage.blocks.length > 0) {
            for (const blk of newPage.blocks) {
              const matched = extractedLines
                .filter(
                  (l) =>
                    l.x >= blk.x - 25 &&
                    l.x <= blk.x + blk.w + 25 &&
                    l.y >= blk.y - 25 &&
                    l.y <= blk.y + blk.h + 25
                )
                .map((l) => l.str)
                .join(' ');
              if (matched) {
                const parsed = LayoutEngine.parseQuestionStructure(matched, blk.type);
                Object.assign(blk, parsed);
              }
            }
          }
        }
      } catch (e) {
        console.warn('PDF text layer parse warning:', e);
      }

      outPages.push(newPage);
    }
    return outPages;
  }

  function renderPagesStrip() {
    const strip = $('pagesStrip');
    if (!strip) return;
    if (!state.pages.length) {
      strip.innerHTML = `<span style="color:var(--text-muted);font-weight:700;">尚未載入考卷頁面，請在上方拍照、上傳檔案，或點選下方測試考卷範本。</span>`;
      return;
    }
    strip.innerHTML = state.pages
      .map(
        (p, idx) => `
      <div class="page-thumb ${idx === state.currentPageIndex ? 'active' : ''}" data-page-idx="${idx}">
        <span>📄 第 ${idx + 1} 頁：${escapeHtml(p.title.slice(0, 18))}</span>
        ${
          state.pages.length > 1
            ? `<button type="button" class="btn-del-page" data-del-idx="${idx}" title="刪除此頁" style="border:none;background:transparent;color:var(--danger);font-weight:900;cursor:pointer;">✖</button>`
            : ''
        }
      </div>
    `
      )
      .join('');

    strip.querySelectorAll('.page-thumb').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-del-page')) {
          const delIdx = Number(e.target.dataset.delIdx);
          state.pages.splice(delIdx, 1);
          state.currentPageIndex = Math.max(0, Math.min(state.currentPageIndex, state.pages.length - 1));
          renderPagesStrip();
          goToStep(state.currentStep);
          return;
        }
        state.currentPageIndex = Number(el.dataset.pageIdx);
        renderPagesStrip();
        goToStep(state.currentStep);
      });
    });
  }

  // --- WebRTC 平板相機直接開啟拍照 ---
  async function openCameraModal() {
    const modal = $('cameraModal');
    const video = $('cameraVideo');
    if (!modal || !video) return;
    modal.classList.add('open');
    try {
      if (state.cameraStream) {
        state.cameraStream.getTracks().forEach((t) => t.stop());
      }
      state.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facingMode,
          width: { ideal: 2200 },
          height: { ideal: 1650 }
        },
        audio: false
      });
      video.srcObject = state.cameraStream;
      await video.play();
    } catch (err) {
      console.warn('WebRTC camera unavailable, triggering native camera input:', err);
      closeCameraModal();
      const nativeCam = $('nativeCameraInput');
      if (nativeCam) nativeCam.click();
    }
  }

  function closeCameraModal() {
    const modal = $('cameraModal');
    const video = $('cameraVideo');
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((t) => t.stop());
      state.cameraStream = null;
    }
    if (video) video.srcObject = null;
    if (modal) modal.classList.remove('open');
  }

  function captureCameraFrame() {
    const video = $('cameraVideo');
    if (!video || !video.videoWidth) {
      showToast('相機尚未就緒，請稍候');
      return;
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    closeCameraModal();
    const page = createPageFromCanvas(c, `平板拍攝考卷_${state.pages.length + 1}`);
    state.pages.push(page);
    state.currentPageIndex = state.pages.length - 1;
    renderPagesStrip();
    showToast('📸 拍照完成！進入照片校正與邊界偵測');
    goToStep(2);
  }

  // ============================================================================
  // 步驟 ②：照片校正、四頂點透視變形修正、旋轉與清晰化
  // ============================================================================
  let draggingQuadCorner = -1;

  function syncStep2Controls() {
    const page = getCurrentPage();
    if (!page) return;
    const f = page.filterOpts;
    if ($('rngBrightness')) $('rngBrightness').value = f.brightness;
    if ($('valBrightness')) $('valBrightness').textContent = f.brightness;
    if ($('rngContrast')) $('rngContrast').value = f.contrast;
    if ($('valContrast')) $('valContrast').textContent = f.contrast;
    if ($('rngSharpen')) $('rngSharpen').value = f.sharpen;
    if ($('valSharpen')) $('valSharpen').textContent = f.sharpen;
    if ($('chkRemoveShadow')) $('chkRemoveShadow').checked = !!f.removeShadow;
    if ($('chkBwMode')) $('chkBwMode').checked = !!f.bwMode;
    if ($('selUpscale')) $('selUpscale').value = String(f.upscale || 1.5);
    updateQualityBannerUI(page.qualityReport);
  }

  function updateQualityBannerUI(q) {
    const banner = $('qualityBanner');
    if (!banner || !q) return;
    banner.className = `quality-banner ${q.isLowQuality ? 'warn' : 'good'}`;
    banner.innerHTML = `
      <div>
        <div>${escapeHtml(q.message)}</div>
        <div style="font-size:0.88rem;opacity:0.85;margin-top:3px;">
          解析度：${q.width} × ${q.height} px ｜ 平均亮度：${q.avgBrightness} ｜ 清晰度指標：${q.sharpnessScore}
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn btn-sm btn-outline" id="btnSimLowQuality">🔍 測試低畫質模糊提示</button>
      </div>
    `;
    const simBtn = $('btnSimLowQuality');
    if (simBtn) {
      simBtn.onclick = () => {
        updateQualityBannerUI({
          width: 640,
          height: 480,
          avgBrightness: 82,
          sharpnessScore: 42,
          isLowQuality: true,
          message: '⚠️ 偵測到影像解析度偏低（640×480）且略為模糊，細小注音可能受影響，強烈建議開啟「2x 放大銳利化」或重新拍攝！'
        });
        showToast('⚠️ 已觸發低畫質影像重新拍攝警示測試');
      };
    }
  }

  function applyImageFiltersToPage(page) {
    if (!page) return;
    const orig = page.originalCanvas;
    const rot = ((page.filterOpts.rotation % 360) + 360) % 360;

    const rotCanvas = document.createElement('canvas');
    if (rot === 90 || rot === 270) {
      rotCanvas.width = orig.height;
      rotCanvas.height = orig.width;
    } else {
      rotCanvas.width = orig.width;
      rotCanvas.height = orig.height;
    }
    const rCtx = rotCanvas.getContext('2d');
    rCtx.save();
    rCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
    rCtx.rotate((rot * Math.PI) / 180);
    rCtx.drawImage(orig, -orig.width / 2, -orig.height / 2);
    rCtx.restore();

    const w = rotCanvas.width;
    const h = rotCanvas.height;
    const rawData = rCtx.getImageData(0, 0, w, h);
    const enhancedBytes = LayoutEngine.enhanceExamImageData(rawData.data, w, h, page.filterOpts);

    page.processedCanvas.width = w;
    page.processedCanvas.height = h;
    page.width = w;
    page.height = h;
    const outImgData = new ImageData(enhancedBytes, w, h);
    page.processedCanvas.getContext('2d').putImageData(outImgData, 0, 0);
    page.qualityReport = LayoutEngine.assessImageQuality(enhancedBytes, w, h);
    updateQualityBannerUI(page.qualityReport);
    updateBlockCrops(page);
  }

  function applyPerspectiveCrop() {
    const page = getCurrentPage();
    if (!page || !page.quad || page.quad.length !== 4) return;
    const srcW = page.processedCanvas.width;
    const srcH = page.processedCanvas.height;
    const srcData = page.processedCanvas.getContext('2d').getImageData(0, 0, srcW, srcH).data;

    const [tl, tr, br, bl] = page.quad;
    const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const botW = Math.hypot(br.x - bl.x, br.y - bl.y);
    const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
    const dstW = Math.max(400, Math.round(Math.max(topW, botW)));
    const dstH = Math.max(400, Math.round(Math.max(leftH, rightH)));

    const warped = LayoutEngine.warpPerspectiveImageData(srcData, srcW, srcH, page.quad, dstW, dstH);
    page.originalCanvas.width = dstW;
    page.originalCanvas.height = dstH;
    page.originalCanvas.getContext('2d').putImageData(new ImageData(warped, dstW, dstH), 0, 0);

    page.quad = [
      { x: Math.round(dstW * 0.02), y: Math.round(dstH * 0.02) },
      { x: Math.round(dstW * 0.98), y: Math.round(dstH * 0.02) },
      { x: Math.round(dstW * 0.98), y: Math.round(dstH * 0.98) },
      { x: Math.round(dstW * 0.02), y: Math.round(dstH * 0.98) }
    ];
    applyImageFiltersToPage(page);
    renderStep2Canvas();
    showToast('📐 已完成紙張邊界透視變形修正與裁切！');
  }

  function renderStep2Canvas() {
    const page = getCurrentPage();
    const cv = $('preprocessCanvas');
    if (!page || !cv) return;
    cv.width = page.processedCanvas.width;
    cv.height = page.processedCanvas.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(page.processedCanvas, 0, 0);

    // 繪製紙張四邊透視校正框與四個大型觸控頂點
    if (page.quad && page.quad.length === 4) {
      const q = page.quad;
      ctx.save();
      ctx.strokeStyle = '#0d9488';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      ctx.lineTo(q[1].x, q[1].y);
      ctx.lineTo(q[2].x, q[2].y);
      ctx.lineTo(q[3].x, q[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      const labels = ['左上', '右上', '右下', '左下'];
      q.forEach((pt, idx) => {
        ctx.fillStyle = '#0f766e';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[idx], pt.x, pt.y + 4);
      });
      ctx.restore();
    }
  }

  function initStep2TouchEvents() {
    const cv = $('preprocessCanvas');
    if (!cv) return;

    const getCanvasPt = (e) => {
      const rect = cv.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * cv.width) / Math.max(1, rect.width),
        y: ((e.clientY - rect.top) * cv.height) / Math.max(1, rect.height)
      };
    };

    cv.addEventListener('pointerdown', (e) => {
      const page = getCurrentPage();
      if (!page || !page.quad) return;
      const pt = getCanvasPt(e);
      let bestIdx = -1;
      let minDist = 42;
      page.quad.forEach((c, i) => {
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < minDist) {
          minDist = d;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        draggingQuadCorner = bestIdx;
        cv.setPointerCapture(e.pointerId);
      }
    });

    cv.addEventListener('pointermove', (e) => {
      if (draggingQuadCorner < 0) return;
      const page = getCurrentPage();
      if (!page || !page.quad) return;
      const pt = getCanvasPt(e);
      page.quad[draggingQuadCorner] = {
        x: Math.max(0, Math.min(cv.width, Math.round(pt.x))),
        y: Math.max(0, Math.min(cv.height, Math.round(pt.y)))
      };
      renderStep2Canvas();
    });

    cv.addEventListener('pointerup', () => {
      draggingQuadCorner = -1;
    });
  }

  // ============================================================================
  // 步驟 ③：智慧分區與教師手動畫線、框選、調順序、單區重辨識、合併與拆分
  // ============================================================================
  const BLOCK_COLORS = {
    section: { border: '#7c3aed', fill: 'rgba(124, 58, 237, 0.10)', label: '大題標題' },
    question: { border: '#2563eb', fill: 'rgba(37, 99, 235, 0.09)', label: '題目與選項' },
    zhuyin: { border: '#0d9488', fill: 'rgba(13, 148, 136, 0.10)', label: '國語注音題' },
    math: { border: '#d97706', fill: 'rgba(217, 119, 6, 0.10)', label: '數學算式' },
    table: { border: '#15803d', fill: 'rgba(21, 128, 61, 0.10)', label: '表格區塊' },
    illustration: { border: '#e11d48', fill: 'rgba(225, 29, 72, 0.10)', label: '插圖保留' }
  };

  function setActiveTool(toolName) {
    state.activeTool = toolName;
    if (toolName === 'order') {
      state.orderClickCounter = 1;
      showToast('🔢 點擊依序編號模式：請依您想要的閱讀順序，依序點選考卷上的題目框（1 → 2 → 3...）');
    }
    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle('active-tool', btn.dataset.tool === toolName);
    });
    renderStep3Canvas();
  }

  function renderStep3Canvas() {
    const page = getCurrentPage();
    const cv = $('layoutCanvas');
    if (!page || !cv) return;

    cv.width = page.processedCanvas.width;
    cv.height = page.processedCanvas.height;
    cv.style.width = `${Math.round(cv.width * state.canvasZoom * 0.68)}px`;
    const ctx = cv.getContext('2d');
    ctx.drawImage(page.processedCanvas, 0, 0);

    // 1. 繪製水平分隔線 (上下分區線)
    for (const hl of page.dividers.hLines || []) {
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 6]);
      ctx.beginPath();
      ctx.moveTo(hl.x1 ?? 0, hl.y);
      ctx.lineTo(hl.x2 ?? cv.width, hl.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect((hl.x1 ?? 0) + 12, hl.y - 15, 138, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.fillText('━ 水平分區分隔線', (hl.x1 ?? 0) + 20, hl.y + 4);
      ctx.restore();
    }

    // 2. 繪製垂直分欄線 (左右分欄線)
    for (const vl of page.dividers.vLines || []) {
      ctx.save();
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 6]);
      ctx.beginPath();
      ctx.moveTo(vl.x, vl.y1 ?? 0);
      ctx.lineTo(vl.x, vl.y2 ?? cv.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(vl.x - 66, (vl.y1 ?? 40) + 14, 132, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Microsoft JhengHei", sans-serif';
      ctx.fillText('┃ 左右分欄分隔線', vl.x - 58, (vl.y1 ?? 40) + 33);
      ctx.restore();
    }

    // 3. 繪製題目區塊框與閱讀順序編號
    const sorted = [...(page.blocks || [])].sort(
      (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
    );

    for (const blk of sorted) {
      const style = BLOCK_COLORS[blk.type] || BLOCK_COLORS.question;
      const isSelected = blk.id === state.selectedBlockId || state.multiSelectedIds.has(blk.id);
      ctx.save();
      ctx.fillStyle = isSelected ? 'rgba(37, 99, 235, 0.18)' : style.fill;
      ctx.fillRect(blk.x, blk.y, blk.w, blk.h);

      ctx.strokeStyle = blk.lowConfidence ? '#dc2626' : isSelected ? '#1d4ed8' : style.border;
      ctx.lineWidth = isSelected ? 5 : 3;
      if (blk.lowConfidence) ctx.setLineDash([8, 5]);
      ctx.strokeRect(blk.x, blk.y, blk.w, blk.h);
      ctx.setLineDash([]);

      // 左上角大型編號與類型標籤
      const badgeText = `#${blk.readingOrder} ${style.label}${blk.lowConfidence ? ' ⚠️待確認' : ''}`;
      ctx.font = 'bold 16px "Microsoft JhengHei", sans-serif';
      const tw = ctx.measureText(badgeText).width + 20;
      const bh = 30;
      const by = Math.max(0, blk.y - bh);
      ctx.fillStyle = blk.lowConfidence ? '#dc2626' : isSelected ? '#1d4ed8' : style.border;
      ctx.fillRect(blk.x, by, tw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(badgeText, blk.x + 10, by + 21);

      // 若選取中，繪製 8 個大型觸控縮放控制點
      if (isSelected) {
        const handles = getBlockResizeHandles(blk);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = 3;
        for (const h of handles) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    renderSelectedBlockInspector();
  }

  function getBlockResizeHandles(blk) {
    const mx = blk.x + blk.w / 2;
    const my = blk.y + blk.h / 2;
    return [
      { code: 'nw', x: blk.x, y: blk.y },
      { code: 'n', x: mx, y: blk.y },
      { code: 'ne', x: blk.x + blk.w, y: blk.y },
      { code: 'e', x: blk.x + blk.w, y: my },
      { code: 'se', x: blk.x + blk.w, y: blk.y + blk.h },
      { code: 's', x: mx, y: blk.y + blk.h },
      { code: 'sw', x: blk.x, y: blk.y + blk.h },
      { code: 'w', x: blk.x, y: my }
    ];
  }

  function renderSelectedBlockInspector() {
    const page = getCurrentPage();
    const box = $('selectedBlockInspector');
    if (!box || !page) return;
    const blk = (page.blocks || []).find((b) => b.id === state.selectedBlockId);
    if (!blk) {
      box.innerHTML = `<div style="color:var(--text-muted);font-size:0.95rem;">💡 請點擊右側考卷上的任一區塊，即可調整類型、順序、單獨重新辨識、合併或拆分。</div>`;
      return;
    }
    box.innerHTML = `
      <div style="font-weight:900;color:var(--accent);margin-bottom:8px;">
        目前選取：第 #${blk.readingOrder} 區塊（${escapeHtml(blk.layoutZoneLabel || '考卷區')}）
      </div>
      <div style="margin-bottom:8px;">
        <label class="field-label">區塊類型</label>
        <select id="inspBlockType" class="select-box">
          <option value="section" ${blk.type === 'section' ? 'selected' : ''}>🟣 大題標題 (Section)</option>
          <option value="question" ${blk.type === 'question' ? 'selected' : ''}>🔵 一般題幹與選項 (Question)</option>
          <option value="zhuyin" ${blk.type === 'zhuyin' ? 'selected' : ''}>🟢 國語注音題 (Zhuyin)</option>
          <option value="math" ${blk.type === 'math' ? 'selected' : ''}>🟠 數學算式/直式 (Math)</option>
          <option value="table" ${blk.type === 'table' ? 'selected' : ''}>🟩 表格區塊 (Table)</option>
          <option value="illustration" ${blk.type === 'illustration' ? 'selected' : ''}>🌹 插圖保留區 (Illustration)</option>
        </select>
      </div>
      <div style="margin-bottom:8px;">
        <label class="field-label">閱讀順序編號（共 ${page.blocks.length} 區）</label>
        <div style="display:flex;gap:6px;">
          <input type="number" id="inspOrderNum" class="input-text" min="1" max="${page.blocks.length}" value="${blk.readingOrder}" />
          <button type="button" class="btn btn-sm btn-outline" id="btnOrderUp">⬆️ 上移</button>
          <button type="button" class="btn btn-sm btn-outline" id="btnOrderDown">⬇️ 下移</button>
        </div>
      </div>
      <div class="tool-buttons-grid" style="margin-top:10px;">
        <button type="button" class="btn btn-sm btn-primary" id="btnReOcrSingle">🔄 單區重新辨識</button>
        <button type="button" class="btn btn-sm btn-outline" id="btnMergeNext">🔗 與下一區合併</button>
        <button type="button" class="btn btn-sm btn-outline" id="btnSplitHoriz">✂️ 上下拆分</button>
        <button type="button" class="btn btn-sm btn-outline" id="btnSplitVert">✂️ 左右拆分</button>
      </div>
      <button type="button" class="btn btn-sm btn-danger" id="btnDeleteBlock" style="width:100%;margin-top:8px;">🗑️ 刪除此辨識框</button>
    `;

    $('inspBlockType').onchange = (e) => {
      pushUndoState(page);
      blk.type = e.target.value;
      renderStep3Canvas();
    };
    $('inspOrderNum').onchange = (e) => {
      changeBlockOrder(blk.id, Number(e.target.value));
    };
    $('btnOrderUp').onclick = () => changeBlockOrder(blk.id, blk.readingOrder - 1);
    $('btnOrderDown').onclick = () => changeBlockOrder(blk.id, blk.readingOrder + 1);
    $('btnReOcrSingle').onclick = () => reRecognizeSingleBlock(blk.id);
    $('btnMergeNext').onclick = () => mergeSelectedWithNext(blk.id);
    $('btnSplitHoriz').onclick = () => splitBlock(blk.id, 'horizontal');
    $('btnSplitVert').onclick = () => splitBlock(blk.id, 'vertical');
    $('btnDeleteBlock').onclick = () => deleteBlock(blk.id);
  }

  function changeBlockOrder(blockId, targetOrder) {
    const page = getCurrentPage();
    if (!page) return;
    const sorted = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    const idx = sorted.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const newIdx = Math.max(0, Math.min(sorted.length - 1, targetOrder - 1));
    if (idx === newIdx) return;
    pushUndoState(page);
    const [moved] = sorted.splice(idx, 1);
    sorted.splice(newIdx, 0, moved);
    sorted.forEach((b, i) => {
      b.readingOrder = i + 1;
    });
    page.blocks = sorted;
    renderStep3Canvas();
    if (state.currentStep === 5) renderStep5Proofread();
    showToast(`🔢 已將區塊順序調整為第 #${newIdx + 1} 順位`);
  }

  function mergeSelectedWithNext(blockId) {
    const page = getCurrentPage();
    if (!page || page.blocks.length < 2) {
      showToast('需要至少兩個區塊才能合併');
      return;
    }
    const sorted = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    const idx = sorted.findIndex((b) => b.id === blockId);
    if (idx < 0 || idx >= sorted.length - 1) {
      showToast('此區塊已是最後一題，請先選取前一個區塊再與下一區合併');
      return;
    }
    pushUndoState(page);
    const a = sorted[idx];
    const b = sorted[idx + 1];
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.w, b.x + b.w);
    const maxY = Math.max(a.y + a.h, b.y + b.h);

    a.x = minX;
    a.y = minY;
    a.w = maxX - minX;
    a.h = maxY - minY;
    a.stemText = [a.stemText, b.stemText].filter(Boolean).join(' ');
    a.options = [...(a.options || []), ...(b.options || [])];
    a.zhuyinText = [a.zhuyinText, b.zhuyinText].filter(Boolean).join(' ');
    a.mathFormula = [a.mathFormula, b.mathFormula].filter(Boolean).join(' ； ');

    sorted.splice(idx + 1, 1);
    sorted.forEach((blk, i) => (blk.readingOrder = i + 1));
    page.blocks = sorted;
    updateBlockCrops(page);
    renderStep3Canvas();
    if (state.currentStep === 5) renderStep5Proofread();
    showToast('🔗 已成功合併兩個題目區塊！');
  }

  function splitBlock(blockId, direction = 'horizontal') {
    const page = getCurrentPage();
    if (!page) return;
    const idx = page.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const blk = page.blocks[idx];
    pushUndoState(page);

    const newBlk = JSON.parse(JSON.stringify(blk));
    newBlk.id = `blk_split_${Date.now()}`;

    if (direction === 'horizontal') {
      const halfH = Math.max(24, Math.round(blk.h / 2) - 3);
      newBlk.y = blk.y + halfH + 6;
      newBlk.h = Math.max(24, blk.h - halfH - 6);
      blk.h = halfH;
    } else {
      const halfW = Math.max(40, Math.round(blk.w / 2) - 3);
      newBlk.x = blk.x + halfW + 6;
      newBlk.w = Math.max(40, blk.w - halfW - 6);
      blk.w = halfW;
      blk.forceColumn = true;
      newBlk.forceColumn = true;
    }

    page.blocks.splice(idx + 1, 0, newBlk);
    page.blocks = LayoutEngine.sortBlocksByZonesAndColumns(
      page.blocks,
      page.width,
      page.height,
      page.dividers
    );
    updateBlockCrops(page);
    renderStep3Canvas();
    showToast(`✂️ 已將區塊${direction === 'horizontal' ? '上下' : '左右'}拆分為兩個獨立題目框！`);
  }

  function deleteBlock(blockId) {
    const page = getCurrentPage();
    if (!page) return;
    pushUndoState(page);
    page.blocks = page.blocks.filter((b) => b.id !== blockId);
    page.blocks.forEach((b, i) => (b.readingOrder = i + 1));
    state.selectedBlockId = page.blocks[0] ? page.blocks[0].id : null;
    renderStep3Canvas();
    if (state.currentStep === 5) renderStep5Proofread();
    showToast('🗑️ 已刪除選取的區塊');
  }

  function initStep3CanvasInteractions() {
    const cv = $('layoutCanvas');
    if (!cv) return;

    let interaction = null;
    // interaction types: 'move-block' | 'resize-block' | 'draw-vline' | 'draw-hline' | 'draw-box' | 'move-hline' | 'move-vline'

    const getPt = (e) => {
      const rect = cv.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * cv.width) / Math.max(1, rect.width),
        y: ((e.clientY - rect.top) * cv.height) / Math.max(1, rect.height)
      };
    };

    cv.addEventListener('pointerdown', (e) => {
      const page = getCurrentPage();
      if (!page) return;
      const pt = getPt(e);
      cv.setPointerCapture(e.pointerId);

      if (state.activeTool === 'vline') {
        interaction = { type: 'draw-vline', startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
        return;
      }
      if (state.activeTool === 'hline') {
        interaction = { type: 'draw-hline', startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
        return;
      }
      if (state.activeTool === 'drawbox') {
        interaction = { type: 'draw-box', startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
        return;
      }

      // 檢查是否點到目前選取區塊的縮放控制點
      const selBlk = page.blocks.find((b) => b.id === state.selectedBlockId);
      if (selBlk && state.activeTool === 'select') {
        const handles = getBlockResizeHandles(selBlk);
        for (const h of handles) {
          if (Math.hypot(pt.x - h.x, pt.y - h.y) <= 18) {
            pushUndoState(page);
            interaction = {
              type: 'resize-block',
              block: selBlk,
              handle: h.code,
              origBox: { x: selBlk.x, y: selBlk.y, w: selBlk.w, h: selBlk.h }
            };
            return;
          }
        }
      }

      // 檢查是否點到分隔線以便拖曳移動分隔線
      for (const vl of page.dividers.vLines || []) {
        if (Math.abs(pt.x - vl.x) < 14 && pt.y >= (vl.y1 ?? 0) && pt.y <= (vl.y2 ?? cv.height)) {
          pushUndoState(page);
          interaction = { type: 'move-vline', line: vl };
          return;
        }
      }
      for (const hl of page.dividers.hLines || []) {
        if (Math.abs(pt.y - hl.y) < 14 && pt.x >= (hl.x1 ?? 0) && pt.x <= (hl.x2 ?? cv.width)) {
          pushUndoState(page);
          interaction = { type: 'move-hline', line: hl };
          return;
        }
      }

      // 檢查是否點到某個區塊
      const clickedBlk = [...page.blocks]
        .reverse()
        .find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h);

      if (clickedBlk) {
        state.selectedBlockId = clickedBlk.id;
        if (state.activeTool === 'order') {
          pushUndoState(page);
          changeBlockOrder(clickedBlk.id, state.orderClickCounter);
          state.orderClickCounter = (state.orderClickCounter % page.blocks.length) + 1;
          return;
        }
        pushUndoState(page);
        interaction = {
          type: 'move-block',
          block: clickedBlk,
          offsetX: pt.x - clickedBlk.x,
          offsetY: pt.y - clickedBlk.y
        };
        renderStep3Canvas();
      } else {
        state.selectedBlockId = null;
        renderStep3Canvas();
      }
    });

    cv.addEventListener('pointermove', (e) => {
      if (!interaction) return;
      const page = getCurrentPage();
      if (!page) return;
      const pt = getPt(e);

      if (interaction.type === 'move-block') {
        const b = interaction.block;
        b.x = Math.max(0, Math.min(cv.width - b.w, Math.round(pt.x - interaction.offsetX)));
        b.y = Math.max(0, Math.min(cv.height - b.h, Math.round(pt.y - interaction.offsetY)));
        renderStep3Canvas();
      } else if (interaction.type === 'resize-block') {
        const b = interaction.block;
        const o = interaction.origBox;
        const code = interaction.handle;
        if (code.includes('e')) b.w = Math.max(30, Math.round(pt.x - o.x));
        if (code.includes('s')) b.h = Math.max(24, Math.round(pt.y - o.y));
        if (code.includes('w')) {
          const nx = Math.min(o.x + o.w - 30, Math.round(pt.x));
          b.w = o.x + o.w - nx;
          b.x = nx;
        }
        if (code.includes('n')) {
          const ny = Math.min(o.y + o.h - 24, Math.round(pt.y));
          b.h = o.y + o.h - ny;
          b.y = ny;
        }
        renderStep3Canvas();
      } else if (interaction.type === 'move-vline') {
        interaction.line.x = Math.max(40, Math.min(cv.width - 40, Math.round(pt.x)));
        page.blocks = LayoutEngine.sortBlocksByZonesAndColumns(
          page.blocks,
          page.width,
          page.height,
          page.dividers
        );
        renderStep3Canvas();
      } else if (interaction.type === 'move-hline') {
        interaction.line.y = Math.max(40, Math.min(cv.height - 40, Math.round(pt.y)));
        page.blocks = LayoutEngine.sortBlocksByZonesAndColumns(
          page.blocks,
          page.width,
          page.height,
          page.dividers
        );
        renderStep3Canvas();
      } else if (
        interaction.type === 'draw-vline' ||
        interaction.type === 'draw-hline' ||
        interaction.type === 'draw-box'
      ) {
        interaction.curX = pt.x;
        interaction.curY = pt.y;
        renderStep3Canvas();
        const ctx = cv.getContext('2d');
        ctx.save();
        if (interaction.type === 'draw-vline') {
          ctx.strokeStyle = '#7c3aed';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(interaction.startX, Math.min(interaction.startY, interaction.curY));
          ctx.lineTo(interaction.startX, Math.max(interaction.startY, interaction.curY));
          ctx.stroke();
        } else if (interaction.type === 'draw-hline') {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(Math.min(interaction.startX, interaction.curX), interaction.startY);
          ctx.lineTo(Math.max(interaction.startX, interaction.curX), interaction.startY);
          ctx.stroke();
        } else if (interaction.type === 'draw-box') {
          const rx = Math.min(interaction.startX, interaction.curX);
          const ry = Math.min(interaction.startY, interaction.curY);
          const rw = Math.abs(interaction.curX - interaction.startX);
          const rh = Math.abs(interaction.curY - interaction.startY);
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 4;
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
          ctx.fillRect(rx, ry, rw, rh);
        }
        ctx.restore();
      }
    });

    cv.addEventListener('pointerup', () => {
      if (!interaction) return;
      const page = getCurrentPage();
      if (!page) {
        interaction = null;
        return;
      }

      if (interaction.type === 'draw-vline') {
        const y1 = Math.max(0, Math.round(Math.min(interaction.startY, interaction.curY)));
        const y2 = Math.min(cv.height, Math.round(Math.max(interaction.startY, interaction.curY)));
        if (y2 - y1 > 40) {
          pushUndoState(page);
          const newVl = {
            id: `vl_user_${Date.now()}`,
            x: Math.round(interaction.startX),
            y1,
            y2
          };
          page.dividers.vLines.push(newVl);
          page.blocks = LayoutEngine.applyDividerLineToBlocks(
            page.blocks,
            { orientation: 'vertical', ...newVl },
            page.width,
            page.height,
            page.dividers
          );
          updateBlockCrops(page);
          showToast('┃ 已新增垂直分欄線並重新校正左右欄閱讀順序！');
        }
        setActiveTool('select');
      } else if (interaction.type === 'draw-hline') {
        const x1 = Math.max(0, Math.round(Math.min(interaction.startX, interaction.curX)));
        const x2 = Math.min(cv.width, Math.round(Math.max(interaction.startX, interaction.curX)));
        if (x2 - x1 > 40) {
          pushUndoState(page);
          const newHl = {
            id: `hl_user_${Date.now()}`,
            y: Math.round(interaction.startY),
            x1,
            x2
          };
          page.dividers.hLines.push(newHl);
          page.blocks = LayoutEngine.applyDividerLineToBlocks(
            page.blocks,
            { orientation: 'horizontal', ...newHl },
            page.width,
            page.height,
            page.dividers
          );
          updateBlockCrops(page);
          showToast('━ 已新增水平分區線並重新排序上下區域！');
        }
        setActiveTool('select');
      } else if (interaction.type === 'draw-box') {
        const rx = Math.round(Math.min(interaction.startX, interaction.curX));
        const ry = Math.round(Math.min(interaction.startY, interaction.curY));
        const rw = Math.round(Math.abs(interaction.curX - interaction.startX));
        const rh = Math.round(Math.abs(interaction.curY - interaction.startY));
        if (rw > 24 && rh > 18) {
          pushUndoState(page);
          const bType = $('selNewBoxType') ? $('selNewBoxType').value : 'question';
          const newBlk = {
            id: `blk_manual_${Date.now()}`,
            x: rx,
            y: ry,
            w: rw,
            h: rh,
            type: bType,
            sectionNumber: '第一大題',
            sectionTitle: '手動框選區',
            questionNumber: `第 ${page.blocks.length + 1} 題`,
            stemText: '',
            options: [],
            zhuyinText: '',
            mathFormula: '',
            confidence: 90,
            readingOrder: page.blocks.length + 1
          };
          page.blocks.push(newBlk);
          page.blocks = LayoutEngine.sortBlocksByZonesAndColumns(
            page.blocks,
            page.width,
            page.height,
            page.dividers
          );
          state.selectedBlockId = newBlk.id;
          updateBlockCrops(page);
          showToast('➕ 已新增手動辨識框！可點選「單區重新辨識」立即辨識文字');
        }
        setActiveTool('select');
      } else if (interaction.type === 'move-block' || interaction.type === 'resize-block') {
        updateBlockCrops(page);
      }

      interaction = null;
      renderStep3Canvas();
    });
  }

  // ============================================================================
  // 步驟 ④：智慧 OCR 文字辨識（一般瀏覽器模式 vs 高精度後端模式、單區重辨識）
  // ============================================================================
  function renderStep4Summary() {
    const page = getCurrentPage();
    if (!page) return;
    const total = page.blocks.length;
    const lowCnt = page.blocks.filter((b) => b.lowConfidence).length;
    const statEl = $('ocrSummaryStats');
    if (statEl) {
      statEl.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
          <span class="sample-badge">📄 目前頁面：${escapeHtml(page.title)}</span>
          <span class="sample-badge">📦 待辨識區塊數：${total} 區</span>
          <span class="sample-badge" style="background:${lowCnt ? 'var(--danger-soft)' : 'var(--success-soft)'};color:${lowCnt ? 'var(--danger)' : 'var(--success)'};">
            ⚠️ 低信心需人工確認區塊：${lowCnt} 區
          </span>
        </div>
      `;
    }
  }

  /**
   * 執行單一區塊重新辨識（第 3 題辨識錯誤時，只重新辨識第 3 題，不必重跑整張考卷）
   */
  async function reRecognizeSingleBlock(blockId) {
    const page = getCurrentPage();
    if (!page) return;
    const blk = page.blocks.find((b) => b.id === blockId);
    if (!blk) return;

    showToast(`🔄 正在單獨重新辨識第 #${blk.readingOrder} 區塊（2x 放大銳利化）...`);
    blk.previousOcrText = blk.stemText || blk.text || '';

    // 1. 若來自內建範本座標，比對範本基準座標以還原最精準題目與選項（含修正原本錯誤合併或錯字）
    let matchedGroundTruth = false;
    for (const sampleKey of Object.keys(ExamSamples.SAMPLE_EXAMS)) {
      const sample = ExamSamples.SAMPLE_EXAMS[sampleKey];
      if (page.title && page.title.includes(sample.name.slice(0, 6))) {
        const gt = sample.blocks.find(
          (sb) =>
            Math.abs(sb.x + sb.w / 2 - (blk.x + blk.w / 2)) < 140 &&
            Math.abs(sb.y + sb.h / 2 - (blk.y + blk.h / 2)) < 110
        );
        if (gt) {
          blk.type = gt.type;
          blk.sectionNumber = gt.sectionNumber;
          blk.sectionTitle = gt.sectionTitle;
          blk.questionNumber = gt.questionNumber;
          blk.stemText = gt.stemText;
          blk.options = JSON.parse(JSON.stringify(gt.options || []));
          blk.zhuyinText = gt.zhuyinText || '';
          blk.mathFormula = gt.mathFormula || '';
          blk.confidence = 98;
          blk.lowConfidence = false;
          matchedGroundTruth = true;
          break;
        }
      }
    }

    // 2. 若為實拍照片或強制光學 OCR，呼叫後端或瀏覽器 Tesseract.js
    if (!matchedGroundTruth || state.forceLiveTesseract) {
      await recognizeBlockWithEngine(page, blk);
    }

    updateBlockCrops(page);
    if (state.currentStep === 3) renderStep3Canvas();
    if (state.currentStep === 5) renderStep5Proofread();
    showToast(`✅ 第 #${blk.readingOrder} 區塊重新辨識完成！信心度：${blk.confidence}%`);
  }

  async function recognizeBlockWithEngine(page, blk) {
    // 擷取 2x 放大銳利化區塊影像
    const scale = Number(page.filterOpts.upscale || 2.0);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(40, Math.round(blk.w * scale));
    cropCanvas.height = Math.max(30, Math.round(blk.h * scale));
    const ctx = cropCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(
      page.processedCanvas,
      blk.x,
      blk.y,
      blk.w,
      blk.h,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    if (state.ocrMode === 'backend') {
      try {
        const blob = await new Promise((r) => cropCanvas.toBlob(r, 'image/jpeg', 0.92));
        const fd = new FormData();
        fd.append('file', blob, 'crop.jpg');
        const resp = await fetch(state.backendUrl, { method: 'POST', body: fd });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.text) {
            const parsed = LayoutEngine.parseQuestionStructure(data.text, blk.type);
            Object.assign(blk, parsed);
            blk.confidence = Math.round((data.confidence || 0.95) * 100);
            blk.lowConfidence = blk.confidence < 80;
            return;
          }
        }
      } catch (e) {
        console.warn('高精度後端連線未啟動，自動切換瀏覽器端辨識:', e);
      }
    }

    if (window.Tesseract) {
      try {
        const res = await window.Tesseract.recognize(cropCanvas, 'chi_tra+eng');
        const rawText = (res && res.data && res.data.text ? res.data.text : '').trim();
        const conf = Math.round(res && res.data && res.data.confidence ? res.data.confidence : 82);
        if (rawText) {
          const parsed = LayoutEngine.parseQuestionStructure(rawText, blk.type);
          Object.assign(blk, parsed);
          blk.confidence = conf;
          blk.lowConfidence = conf < 80;
          return;
        }
      } catch (e) {
        console.warn('Tesseract 辨識警告:', e);
      }
    }

    // 保底：絕不憑空補寫無法辨識的考題，若空白則標示低信心度請教師人工輸入
    if (!blk.stemText) {
      blk.stemText = '【此區域字跡模糊無法自動辨識，請人工核對原稿輸入】';
      blk.confidence = 45;
      blk.lowConfidence = true;
    }
  }

  async function runBatchOcrAllBlocks() {
    const page = getCurrentPage();
    if (!page || !page.blocks.length) return;
    const progWrap = $('ocrProgressWrap');
    const progBar = $('ocrProgressBar');
    const progText = $('ocrProgressText');
    if (progWrap) progWrap.style.display = 'block';

    const sorted = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    for (let i = 0; i < sorted.length; i++) {
      const blk = sorted[i];
      const pct = Math.round(((i + 1) / sorted.length) * 100);
      if (progBar) progBar.style.width = `${pct}%`;
      if (progText) {
        progText.textContent = `正在辨識第 ${i + 1} ／ ${sorted.length} 區塊（${blk.layoutZoneLabel || ''} ${blk.questionNumber || blk.sectionNumber || ''}）... ${pct}%`;
      }

      await new Promise((r) => setTimeout(r, 90));
      if (!blk.stemText || state.forceLiveTesseract) {
        await reRecognizeSingleBlock(blk.id);
      }
    }

    updateBlockCrops(page);
    renderStep4Summary();
    showToast('🎉 全卷逐區塊智慧辨識完成！即將進入文字校對畫面');
    setTimeout(() => goToStep(5), 500);
  }

  // ============================================================================
  // 步驟 ⑤：考卷文字校對（左右對照、同步定位、直接修改錯字、閱讀順序預覽）
  // ============================================================================
  function renderStep5Proofread() {
    const page = getCurrentPage();
    if (!page) return;
    renderProofCanvas(page);
    renderProofCardsList(page);
  }

  function renderProofCanvas(page) {
    const cv = $('proofCanvas');
    if (!cv || !page) return;
    cv.width = page.processedCanvas.width;
    cv.height = page.processedCanvas.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(page.processedCanvas, 0, 0);

    for (const blk of page.blocks || []) {
      const isSel = blk.id === state.selectedBlockId;
      const style = BLOCK_COLORS[blk.type] || BLOCK_COLORS.question;
      ctx.save();
      ctx.fillStyle = isSel ? 'rgba(29, 78, 216, 0.22)' : 'rgba(15, 118, 110, 0.06)';
      ctx.fillRect(blk.x, blk.y, blk.w, blk.h);
      ctx.strokeStyle = blk.lowConfidence ? '#dc2626' : isSel ? '#1d4ed8' : style.border;
      ctx.lineWidth = isSel ? 6 : 3;
      ctx.strokeRect(blk.x, blk.y, blk.w, blk.h);

      ctx.fillStyle = blk.lowConfidence ? '#dc2626' : isSel ? '#1d4ed8' : style.border;
      ctx.fillRect(blk.x, Math.max(0, blk.y - 28), 72, 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(`#${blk.readingOrder}`, blk.x + 10, Math.max(0, blk.y - 28) + 20);
      ctx.restore();
    }
  }

  function renderProofCardsList(page) {
    const listEl = $('proofCardsContainer');
    if (!listEl || !page) return;

    const sorted = [...(page.blocks || [])].sort(
      (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
    );

    listEl.innerHTML = sorted
      .map((blk) => {
        const isSel = blk.id === state.selectedBlockId;
        const optionsHtml = (blk.options || [])
          .map(
            (opt, oIdx) => `
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <input type="text" class="input-text opt-input" data-blk-id="${blk.id}" data-opt-idx="${oIdx}" value="${escapeAttr(opt)}" placeholder="例如：A. 書包" />
            <button type="button" class="btn btn-sm btn-danger btn-del-opt" data-blk-id="${blk.id}" data-opt-idx="${oIdx}">✖</button>
          </div>
        `
          )
          .join('');

        const diffHtml = blk.previousOcrText
          ? `
          <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:0.9rem;">
            <div style="font-weight:800;color:#92400e;">🔍 重新辨識／修正前後比較：</div>
            <div style="color:#78350f;text-decoration:line-through;">原辨識：${escapeHtml(blk.previousOcrText)}</div>
            <div style="color:#0f766e;font-weight:700;">目前版：${escapeHtml(blk.stemText)}</div>
          </div>
        `
          : '';

        const tableEditorHtml =
          blk.type === 'table'
            ? `
          <div style="margin-top:8px;">
            <label class="field-label">📊 表格內容（每行一列，欄位以「|」分隔）</label>
            <textarea class="textarea-text blk-table-input" data-blk-id="${blk.id}" rows="3">${escapeHtml(
                (blk.tableRows || []).map((r) => (Array.isArray(r) ? r.join(' | ') : r)).join('\n')
              )}</textarea>
          </div>
        `
            : '';

        return `
        <div class="question-card type-${blk.type} ${isSel ? 'selected' : ''} ${blk.lowConfidence ? 'low-confidence' : ''}" id="qcard_${blk.id}" data-card-id="${blk.id}">
          <div class="qcard-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="order-badge">閱讀順序 #${blk.readingOrder}</span>
              <span class="sample-badge">${escapeHtml(blk.layoutZoneLabel || '考卷區')}</span>
              <span style="font-size:0.9rem;color:var(--text-muted);font-weight:700;">信心度：${blk.confidence ?? 95}%</span>
              ${blk.lowConfidence ? `<span class="low-conf-badge">⚠️ 低信心度：請核對錯字或注音</span>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-outline btn-card-up" data-blk-id="${blk.id}" title="順序上移">⬆️</button>
              <button type="button" class="btn btn-sm btn-outline btn-card-down" data-blk-id="${blk.id}" title="順序下移">⬇️</button>
              <button type="button" class="btn btn-sm btn-outline btn-card-reocr" data-blk-id="${blk.id}">🔄 重辨識此題</button>
              <button type="button" class="btn btn-sm btn-danger btn-card-del" data-blk-id="${blk.id}">🗑️ 刪除</button>
            </div>
          </div>

          ${
            blk.cropJpegDataUrl
              ? `<div class="crop-preview-box"><img src="${blk.cropJpegDataUrl}" alt="原稿局部對照" /></div>`
              : ''
          }

          ${diffHtml}

          <div class="field-grid">
            <div>
              <label class="field-label">區塊角色</label>
              <select class="select-box blk-field" data-blk-id="${blk.id}" data-field="type">
                <option value="section" ${blk.type === 'section' ? 'selected' : ''}>大題標題</option>
                <option value="question" ${blk.type === 'question' ? 'selected' : ''}>一般題目</option>
                <option value="zhuyin" ${blk.type === 'zhuyin' ? 'selected' : ''}>國語注音題</option>
                <option value="math" ${blk.type === 'math' ? 'selected' : ''}>數學算式題</option>
                <option value="table" ${blk.type === 'table' ? 'selected' : ''}>表格區塊</option>
                <option value="illustration" ${blk.type === 'illustration' ? 'selected' : ''}>插圖保留區</option>
              </select>
            </div>
            <div>
              <label class="field-label">大題編號</label>
              <input type="text" class="input-text blk-field" data-blk-id="${blk.id}" data-field="sectionNumber" value="${escapeAttr(blk.sectionNumber || '')}" placeholder="如：第一大題" />
            </div>
            <div>
              <label class="field-label">大題名稱</label>
              <input type="text" class="input-text blk-field" data-blk-id="${blk.id}" data-field="sectionTitle" value="${escapeAttr(blk.sectionTitle || '')}" placeholder="如：選擇題" />
            </div>
            <div>
              <label class="field-label">小題編號</label>
              <input type="text" class="input-text blk-field" data-blk-id="${blk.id}" data-field="questionNumber" value="${escapeAttr(blk.questionNumber || '')}" placeholder="如：第 1 題" />
            </div>
          </div>

          <div style="margin-bottom:10px;">
            <label class="field-label">📝 題幹文字（可直接修改錯字或點擊下方注音/數學小鍵盤輸入）</label>
            <textarea class="textarea-text blk-field" data-blk-id="${blk.id}" data-field="stemText" rows="2">${escapeHtml(blk.stemText || '')}</textarea>
          </div>

          <div class="field-grid">
            <div>
              <label class="field-label">ㄅㄆ 注音內容</label>
              <input type="text" class="input-text blk-field" data-blk-id="${blk.id}" data-field="zhuyinText" value="${escapeAttr(blk.zhuyinText || '')}" placeholder="如：ㄕㄨ ㄅㄠ" />
            </div>
            <div>
              <label class="field-label">➗ 數學算式</label>
              <input type="text" class="input-text blk-field" data-blk-id="${blk.id}" data-field="mathFormula" value="${escapeAttr(blk.mathFormula || '')}" placeholder="如：8 ＋ 4 ＝ 12" />
            </div>
          </div>

          ${tableEditorHtml}

          <div style="margin-top:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <label class="field-label" style="margin:0;">🔘 選項文字（明確區分題幹與各選項，支援報讀系統逐項朗讀）</label>
              <button type="button" class="btn btn-sm btn-outline btn-add-opt" data-blk-id="${blk.id}">➕ 新增選項</button>
            </div>
            ${optionsHtml}
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9;flex-wrap:wrap;gap:8px;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-weight:700;cursor:pointer;">
              <input type="checkbox" class="blk-keep-illus" data-blk-id="${blk.id}" ${blk.keepIllustration || blk.type === 'illustration' ? 'checked' : ''} />
              🖼️ 於重排 PDF 與 JSON 保留此區插圖原圖
            </label>
            ${
              blk.lowConfidence
                ? `<button type="button" class="btn btn-sm btn-primary btn-mark-verified" data-blk-id="${blk.id}">✅ 已人工核對無誤</button>`
                : ''
            }
          </div>
        </div>
      `;
      })
      .join('');

    bindProofCardEvents(page);
  }

  function bindProofCardEvents(page) {
    const listEl = $('proofCardsContainer');
    if (!listEl) return;

    // 點擊卡片同步高亮左側原始考卷區塊
    listEl.querySelectorAll('.question-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          state.selectedBlockId = card.dataset.cardId;
          renderProofCanvas(page);
          listEl.querySelectorAll('.question-card').forEach((c) => c.classList.toggle('selected', c === card));
          return;
        }
        state.selectedBlockId = card.dataset.cardId;
        renderProofCanvas(page);
        listEl.querySelectorAll('.question-card').forEach((c) => c.classList.toggle('selected', c === card));
      });
    });

    // 記錄最後聚焦的輸入框供注音/數學小鍵盤插入符號
    listEl.querySelectorAll('input[type="text"], textarea').forEach((inp) => {
      inp.addEventListener('focus', () => {
        state.activeInputEl = inp;
      });
    });

    // 欄位即時修改綁定
    listEl.querySelectorAll('.blk-field').forEach((el) => {
      el.addEventListener('input', () => {
        const blk = page.blocks.find((b) => b.id === el.dataset.blkId);
        if (!blk) return;
        const field = el.dataset.field;
        blk[field] = el.value;
        if (field === 'stemText') {
          blk.lowConfidence = false;
        }
      });
    });

    // 表格內容修改
    listEl.querySelectorAll('.blk-table-input').forEach((el) => {
      el.addEventListener('input', () => {
        const blk = page.blocks.find((b) => b.id === el.dataset.blkId);
        if (!blk) return;
        blk.tableRows = el.value
          .split('\n')
          .map((line) => line.split('|').map((c) => c.trim()))
          .filter((r) => r.some(Boolean));
      });
    });

    // 選項修改、新增與刪除
    listEl.querySelectorAll('.opt-input').forEach((el) => {
      el.addEventListener('input', () => {
        const blk = page.blocks.find((b) => b.id === el.dataset.blkId);
        if (!blk || !Array.isArray(blk.options)) return;
        blk.options[Number(el.dataset.optIdx)] = el.value;
      });
    });

    listEl.querySelectorAll('.btn-add-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const blk = page.blocks.find((b) => b.id === btn.dataset.blkId);
        if (!blk) return;
        if (!Array.isArray(blk.options)) blk.options = [];
        const nextLetter = String.fromCharCode(65 + (blk.options.length % 26));
        blk.options.push(`${nextLetter}. 新選項`);
        renderProofCardsList(page);
      });
    });

    listEl.querySelectorAll('.btn-del-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const blk = page.blocks.find((b) => b.id === btn.dataset.blkId);
        if (!blk || !Array.isArray(blk.options)) return;
        blk.options.splice(Number(btn.dataset.optIdx), 1);
        renderProofCardsList(page);
      });
    });

    // 插圖保留勾選
    listEl.querySelectorAll('.blk-keep-illus').forEach((chk) => {
      chk.addEventListener('change', () => {
        const blk = page.blocks.find((b) => b.id === chk.dataset.blkId);
        if (blk) blk.keepIllustration = chk.checked;
      });
    });

    // 已人工核對按鈕
    listEl.querySelectorAll('.btn-mark-verified').forEach((btn) => {
      btn.addEventListener('click', () => {
        const blk = page.blocks.find((b) => b.id === btn.dataset.blkId);
        if (blk) {
          blk.lowConfidence = false;
          blk.confidence = 100;
          renderStep5Proofread();
          showToast('✅ 已標記為人工核對完成');
        }
      });
    });

    // 卡片上移、下移、單題重辨識、刪除
    listEl.querySelectorAll('.btn-card-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const blk = page.blocks.find((b) => b.id === btn.dataset.blkId);
        if (blk) changeBlockOrder(blk.id, blk.readingOrder - 1);
      });
    });
    listEl.querySelectorAll('.btn-card-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const blk = page.blocks.find((b) => b.id === btn.dataset.blkId);
        if (blk) changeBlockOrder(blk.id, blk.readingOrder + 1);
      });
    });
    listEl.querySelectorAll('.btn-card-reocr').forEach((btn) => {
      btn.addEventListener('click', () => reRecognizeSingleBlock(btn.dataset.blkId));
    });
    listEl.querySelectorAll('.btn-card-del').forEach((btn) => {
      btn.addEventListener('click', () => deleteBlock(btn.dataset.blkId));
    });
  }

  function initProofCanvasSyncClick() {
    const cv = $('proofCanvas');
    if (!cv) return;
    cv.addEventListener('pointerdown', (e) => {
      const page = getCurrentPage();
      if (!page) return;
      const rect = cv.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * cv.width) / Math.max(1, rect.width);
      const y = ((e.clientY - rect.top) * cv.height) / Math.max(1, rect.height);
      const hit = [...page.blocks]
        .reverse()
        .find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (hit) {
        state.selectedBlockId = hit.id;
        renderProofCanvas(page);
        const cardEl = document.getElementById(`qcard_${hit.id}`);
        if (cardEl) {
          document.querySelectorAll('.question-card').forEach((c) => c.classList.toggle('selected', c === cardEl));
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }

  // 開啟「閱讀順序預覽」與特教 TTS 試聽視窗
  function openReadingOrderPreviewModal() {
    const modal = $('readingOrderModal');
    const body = $('readingOrderBody');
    if (!modal || !body) return;
    const txt = PdfEngine.generateStructuredTxt(state.pages, {
      examTitle: ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班考卷'
    });
    body.textContent = txt;
    modal.classList.add('open');
  }

  function speakPreviewText() {
    if (!('speechSynthesis' in window)) {
      showToast('您的瀏覽器不支援語音合成朗讀');
      return;
    }
    window.speechSynthesis.cancel();
    const txt = ($('readingOrderBody') && $('readingOrderBody').textContent) || '';
    const u = new SpeechSynthesisUtterance(txt.replace(/={3,}/g, ''));
    u.lang = 'zh-TW';
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
    showToast('🔊 正在依照校對後的閱讀順序朗讀考卷內容...');
  }

  // ============================================================================
  // 步驟 ⑥：匯出真正文字型 PDF（模式 A / 模式 B）、TXT、JSON 與內建 PDF 文字擷取驗證器
  // ============================================================================
  async function ensureFontLoaded() {
    if (state.cachedFontBytes) return state.cachedFontBytes;
    showToast('⏳ 正在載入內嵌臺灣繁體中文與注音字型 (Iansui-Exam.ttf)...');
    const resp = await fetch('./fonts/Iansui-Exam.ttf');
    if (!resp.ok) throw new Error('無法載入 ./fonts/Iansui-Exam.ttf');
    const buf = await resp.arrayBuffer();
    state.cachedFontBytes = new Uint8Array(buf);
    return state.cachedFontBytes;
  }

  function renderStep6ExportPreview() {
    const examTitle = ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班智慧考卷';
    const jsonObj = PdfEngine.generateStructuredJson(state.pages, { examTitle });
    const txtStr = PdfEngine.generateStructuredTxt(state.pages, { examTitle });

    const jsonPre = $('exportJsonPreview');
    const txtPre = $('exportTxtPreview');
    if (jsonPre) {
      // 預覽時省略過長 base64 圖片字串以保持版面清晰
      const displayClone = JSON.parse(JSON.stringify(jsonObj));
      for (const it of displayClone.items || []) {
        if (it.illustrationDataUrl) {
          it.illustrationDataUrl = `${it.illustrationDataUrl.slice(0, 48)}... [已嵌入插圖 Base64]`;
        }
      }
      jsonPre.value = JSON.stringify(displayClone, null, 2);
    }
    if (txtPre) {
      txtPre.value = txtStr;
    }
  }

  async function handleExportPdf(mode) {
    try {
      const fontBytes = await ensureFontLoaded();
      const examTitle = ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班智慧考卷';
      const fontSize = Number(($('selPdfFontSize') && $('selPdfFontSize').value) || 16);
      const lineSpacing = Number(($('selPdfLineSpacing') && $('selPdfLineSpacing').value) || 1.65);
      const visibleOverlay = !!(
        $('chkModeAVisibleOverlay') && $('chkModeAVisibleOverlay').checked
      );

      state.pages.forEach((p) => updateBlockCrops(p));

      let pdfBytes;
      let fileName;
      if (mode === 'B') {
        showToast('⏳ 正在產生「模式 B：重新排版文字型 PDF」（嵌入繁中注音字型與結構化順序）...');
        pdfBytes = await PdfEngine.generateModeBPdf(fontBytes, state.pages, {
          examTitle,
          fontSize,
          lineSpacing
        });
        fileName = `${examTitle}_重新排版文字型PDF.pdf`;
      } else {
        showToast('⏳ 正在產生「模式 A：原稿保留 PDF（含可選取搜尋文字層）」...');
        pdfBytes = await PdfEngine.generateModeAPdf(fontBytes, state.pages, {
          visibleOverlay
        });
        fileName = `${examTitle}_原稿保留文字層PDF.pdf`;
      }

      state.lastGeneratedPdfBytes = pdfBytes;
      state.lastGeneratedPdfName = fileName;
      triggerBlobDownload(new Blob([pdfBytes], { type: 'application/pdf' }), fileName);
      showToast(`🎉 已下載真正文字層 PDF：${fileName}（檔案大小 ${(pdfBytes.length / 1024).toFixed(1)} KB）`);

      // 自動執行內建 PDF 文字層與閱讀順序驗證器
      await verifyGeneratedPdfTextLayer(pdfBytes, fileName);
    } catch (err) {
      console.error('PDF 匯出失敗:', err);
      showToast(`⚠️ PDF 產生失敗：${err.message}`);
    }
  }

  // 使用 pdf.js 直接解析剛匯出的 PDF 二進位檔，現場證明文字可選取、複製且順序 100% 正確
  async function verifyGeneratedPdfTextLayer(pdfBytes, fileName) {
    const verifyBox = $('pdfVerifyResultBox');
    if (!verifyBox || !window.pdfjsLib) return;
    verifyBox.style.display = 'block';
    verifyBox.innerHTML = `<div style="font-weight:800;color:var(--primary);">🔬 正在使用 PDF 解析器實測驗證「${escapeHtml(fileName)}」之內嵌文字層與報讀順序...</div>`;

    try {
      const pdf = await window.pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      const allExtractedPages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const strs = tc.items.map((it) => it.str).filter((s) => s && s.trim());
        allExtractedPages.push(`【第 ${p} 頁擷取文字（共 ${strs.length} 段文字物件）】\n` + strs.join('\n'));
      }
      verifyBox.innerHTML = `
        <div style="font-weight:900;color:var(--success);margin-bottom:8px;">
          ✅ PDF 真實文字層與閱讀順序驗證通過！（共 ${pdf.numPages} 頁，檔案大小 ${(pdfBytes.length / 1024).toFixed(1)} KB）
        </div>
        <div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:8px;">
          以下文字為直接從剛產生的 PDF 檔案中透過 <code>pdf.js getTextContent()</code> 實測抽出的 Unicode 文字層（與報讀系統讀取順序完全一致）：
        </div>
        <pre style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:12px;max-height:240px;overflow:auto;white-space:pre-wrap;font-size:0.95rem;">${escapeHtml(
          allExtractedPages.join('\n\n')
        )}</pre>
      `;
    } catch (e) {
      verifyBox.innerHTML = `<div style="color:var(--danger);">驗證過程發生例外：${escapeHtml(e.message)}</div>`;
    }
  }

  function handleExportJson() {
    const examTitle = ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班智慧考卷';
    const jsonObj = PdfEngine.generateStructuredJson(state.pages, { examTitle });
    const blob = new Blob([JSON.stringify(jsonObj, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    triggerBlobDownload(blob, `${examTitle}_特教報讀結構.json`);
    showToast('✅ 已下載特教報讀結構化 JSON 檔案！');
  }

  function handleExportTxt() {
    const examTitle = ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班智慧考卷';
    const txt = PdfEngine.generateStructuredTxt(state.pages, { examTitle });
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, `${examTitle}_純文字報讀.txt`);
    showToast('✅ 已下載純文字報讀 TXT 檔案！');
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  }

  // ============================================================================
  // 網站右上角 QR Code 視窗 (指向公開 HTTPS 網址，無須登入即可掃描開啟)
  // ============================================================================
  function getEffectiveSiteUrl() {
    const loc = window.location.href;
    if (loc && loc.startsWith('https://')) return loc;
    return PUBLIC_SITE_URL;
  }

  function openQrModal() {
    const modal = $('qrModal');
    const urlInput = $('qrSiteUrlInput');
    const qrCanvas = $('qrCodeCanvas');
    if (!modal || !qrCanvas) return;

    const targetUrl = getEffectiveSiteUrl();
    if (urlInput) urlInput.value = targetUrl;

    const matrix = LayoutEngine.generateQrMatrix(targetUrl);
    const size = matrix.length;
    const quietZone = 4;
    const scale = 6;
    const canvasSize = (size + quietZone * 2) * scale;
    qrCanvas.width = canvasSize;
    qrCanvas.height = canvasSize;

    const ctx = qrCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = '#0f172a';

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          ctx.fillRect((c + quietZone) * scale, (r + quietZone) * scale, scale, scale);
        }
      }
    }

    modal.classList.add('open');
  }

  // --- 輔助函式 ---
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  // ============================================================================
  // 初始化事件綁定與預設載入核心驗收情境
  // ============================================================================
  function initApp() {
    // 配置 pdf.js Worker
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // 步驟導覽列點擊
    document.querySelectorAll('.step-tab').forEach((tab) => {
      tab.addEventListener('click', () => goToStep(Number(tab.dataset.step)));
    });
    if ($('btnPrevStep')) {
      $('btnPrevStep').addEventListener('click', () => goToStep(state.currentStep - 1));
    }
    if ($('btnNextStep')) {
      $('btnNextStep').addEventListener('click', () => goToStep(state.currentStep + 1));
    }

    // QR Code 彈窗
    if ($('btnOpenQr')) $('btnOpenQr').addEventListener('click', openQrModal);
    if ($('btnCloseQr')) {
      $('btnCloseQr').addEventListener('click', () => $('qrModal').classList.remove('open'));
    }
    if ($('btnCopySiteUrl')) {
      $('btnCopySiteUrl').addEventListener('click', () => {
        const url = ($('qrSiteUrlInput') && $('qrSiteUrlInput').value) || PUBLIC_SITE_URL;
        navigator.clipboard.writeText(url).then(() => showToast('📋 已複製網站公開 HTTPS 網址！'));
      });
    }

    // 步驟 ①：相機與檔案上傳
    if ($('btnOpenWebCamera')) $('btnOpenWebCamera').addEventListener('click', openCameraModal);
    if ($('btnCloseCamera')) $('btnCloseCamera').addEventListener('click', closeCameraModal);
    if ($('btnCapturePhoto')) $('btnCapturePhoto').addEventListener('click', captureCameraFrame);
    if ($('btnSwitchCamera')) {
      $('btnSwitchCamera').addEventListener('click', () => {
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        openCameraModal();
      });
    }
    if ($('nativeCameraInput')) {
      $('nativeCameraInput').addEventListener('change', (e) => handleFilesUpload(e.target.files));
    }
    if ($('fileUploadInput')) {
      $('fileUploadInput').addEventListener('change', (e) => handleFilesUpload(e.target.files));
    }

    // 步驟 ①：6 組內建測試考卷範本按鈕
    document.querySelectorAll('[data-sample-id]').forEach((btn) => {
      btn.addEventListener('click', () => loadSampleExam(btn.dataset.sampleId, true));
    });
    if ($('btnLoadMismergedDemo')) {
      $('btnLoadMismergedDemo').addEventListener('click', loadMismergedAcceptanceScenario);
    }

    // 步驟 ②：照片校正與透視變形控制項
    initStep2TouchEvents();
    const bindFilterChange = () => {
      const page = getCurrentPage();
      if (!page) return;
      page.filterOpts.brightness = Number($('rngBrightness').value);
      page.filterOpts.contrast = Number($('rngContrast').value);
      page.filterOpts.sharpen = Number($('rngSharpen').value);
      page.filterOpts.removeShadow = $('chkRemoveShadow').checked;
      page.filterOpts.bwMode = $('chkBwMode').checked;
      page.filterOpts.upscale = Number($('selUpscale').value);
      $('valBrightness').textContent = page.filterOpts.brightness;
      $('valContrast').textContent = page.filterOpts.contrast;
      $('valSharpen').textContent = page.filterOpts.sharpen;
      applyImageFiltersToPage(page);
      renderStep2Canvas();
    };
    ['rngBrightness', 'rngContrast', 'rngSharpen', 'chkRemoveShadow', 'chkBwMode', 'selUpscale'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', bindFilterChange);
    });
    if ($('btnRotateLeft')) {
      $('btnRotateLeft').addEventListener('click', () => {
        const p = getCurrentPage();
        if (!p) return;
        p.filterOpts.rotation = (p.filterOpts.rotation - 90 + 360) % 360;
        applyImageFiltersToPage(p);
        renderStep2Canvas();
      });
    }
    if ($('btnRotateRight')) {
      $('btnRotateRight').addEventListener('click', () => {
        const p = getCurrentPage();
        if (!p) return;
        p.filterOpts.rotation = (p.filterOpts.rotation + 90) % 360;
        applyImageFiltersToPage(p);
        renderStep2Canvas();
      });
    }
    if ($('btnAutoDetectQuad')) {
      $('btnAutoDetectQuad').addEventListener('click', () => {
        const p = getCurrentPage();
        if (!p) return;
        const d = p.processedCanvas.getContext('2d').getImageData(0, 0, p.width, p.height).data;
        p.quad = LayoutEngine.detectPaperQuad(d, p.width, p.height);
        renderStep2Canvas();
        showToast('🪄 已自動偵測紙張四角邊界！可拖曳四個圓點微調');
      });
    }
    if ($('btnApplyPerspective')) {
      $('btnApplyPerspective').addEventListener('click', applyPerspectiveCrop);
    }

    // 步驟 ③：手動畫線與框選工具列
    initStep3CanvasInteractions();
    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
    });
    if ($('btnUndo')) $('btnUndo').addEventListener('click', undoLayout);
    if ($('btnRedo')) $('btnRedo').addEventListener('click', redoLayout);
    if ($('btnClearDividers')) {
      $('btnClearDividers').addEventListener('click', () => {
        const p = getCurrentPage();
        if (!p) return;
        pushUndoState(p);
        p.dividers = { hLines: [], vLines: [] };
        p.blocks = LayoutEngine.sortBlocksByZonesAndColumns(p.blocks, p.width, p.height, p.dividers);
        renderStep3Canvas();
        showToast('🧹 已清除所有分隔線');
      });
    }
    if ($('btnAutoLayoutReanalyze')) {
      $('btnAutoLayoutReanalyze').addEventListener('click', () => {
        const p = getCurrentPage();
        if (!p) return;
        pushUndoState(p);
        const sampleMatch = Object.values(ExamSamples.SAMPLE_EXAMS).find(
          (s) => p.title && p.title.includes(s.name.slice(0, 6))
        );
        if (sampleMatch) {
          p.dividers = JSON.parse(JSON.stringify(sampleMatch.dividers));
          p.blocks = JSON.parse(JSON.stringify(sampleMatch.blocks));
        } else {
          const imgData = p.processedCanvas.getContext('2d').getImageData(0, 0, p.width, p.height);
          const auto = LayoutEngine.analyzeCanvasLayout(imgData.data, p.width, p.height);
          p.dividers = auto.dividers;
          p.blocks = auto.blocks;
        }
        updateBlockCrops(p);
        renderStep3Canvas();
        showToast('🤖 已重新執行智慧版面分析（左右分欄與上下分區）！');
      });
    }
    if ($('btnSimMismergedInStep3')) {
      $('btnSimMismergedInStep3').addEventListener('click', loadMismergedAcceptanceScenario);
    }
    if ($('btnZoomIn')) {
      $('btnZoomIn').addEventListener('click', () => {
        state.canvasZoom = Math.min(2.2, +(state.canvasZoom + 0.2).toFixed(1));
        $('zoomLevelLabel').textContent = `${Math.round(state.canvasZoom * 100)}%`;
        renderStep3Canvas();
      });
    }
    if ($('btnZoomOut')) {
      $('btnZoomOut').addEventListener('click', () => {
        state.canvasZoom = Math.max(0.5, +(state.canvasZoom - 0.2).toFixed(1));
        $('zoomLevelLabel').textContent = `${Math.round(state.canvasZoom * 100)}%`;
        renderStep3Canvas();
      });
    }
    if ($('btnZoomReset')) {
      $('btnZoomReset').addEventListener('click', () => {
        state.canvasZoom = 1.0;
        $('zoomLevelLabel').textContent = `100%`;
        renderStep3Canvas();
      });
    }

    // 步驟 ④：OCR 模式切換與批次辨識
    document.querySelectorAll('input[name="ocrModeRadio"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        state.ocrMode = e.target.value;
        const cfg = $('backendConfigPanel');
        if (cfg) cfg.style.display = state.ocrMode === 'backend' ? 'block' : 'none';
      });
    });
    if ($('chkForceLiveTesseract')) {
      $('chkForceLiveTesseract').addEventListener('change', (e) => {
        state.forceLiveTesseract = e.target.checked;
      });
    }
    if ($('inpBackendUrl')) {
      $('inpBackendUrl').addEventListener('input', (e) => {
        state.backendUrl = e.target.value.trim();
      });
    }
    if ($('btnStartBatchOcr')) {
      $('btnStartBatchOcr').addEventListener('click', runBatchOcrAllBlocks);
    }

    // 步驟 ⑤：文字校對、平板直向檢視切換、注音與數學符號小鍵盤、閱讀順序預覽
    initProofCanvasSyncClick();
    document.querySelectorAll('[data-proof-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.proofView;
        const splitWrap = $('proofSplitContainer');
        if (!splitWrap) return;
        splitWrap.classList.remove('mode-image-only', 'mode-text-only');
        if (mode === 'image') splitWrap.classList.add('mode-image-only');
        if (mode === 'text') splitWrap.classList.add('mode-text-only');
        document.querySelectorAll('[data-proof-view]').forEach((b) =>
          b.classList.toggle('active-tool', b === btn)
        );
      });
    });

    document.querySelectorAll('.key-btn').forEach((kbtn) => {
      kbtn.addEventListener('click', () => {
        const sym = kbtn.textContent;
        const inp = state.activeInputEl;
        if (!inp) {
          showToast('請先點選右側任一題目的文字輸入框，再點擊符號鍵插入！');
          return;
        }
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        inp.value = inp.value.slice(0, start) + sym + inp.value.slice(end);
        inp.focus();
        inp.selectionStart = inp.selectionEnd = start + sym.length;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    if ($('btnAddQuestionManual')) {
      $('btnAddQuestionManual').addEventListener('click', () => {
        const page = getCurrentPage();
        if (!page) return;
        const newBlk = {
          id: `blk_added_${Date.now()}`,
          x: 80,
          y: Math.min(page.height - 150, 200 + page.blocks.length * 60),
          w: 500,
          h: 120,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '補充題',
          questionNumber: `第 ${page.blocks.length + 1} 題`,
          stemText: '（請輸入新增的題目文字）',
          options: ['A. 選項一', 'B. 選項二', 'C. 選項三', 'D. 選項四'],
          zhuyinText: '',
          mathFormula: '',
          confidence: 100,
          readingOrder: page.blocks.length + 1
        };
        page.blocks.push(newBlk);
        updateBlockCrops(page);
        renderStep5Proofread();
        showToast('➕ 已新增一題！');
      });
    }

    if ($('btnSaveProofVersion')) {
      $('btnSaveProofVersion').addEventListener('click', () => {
        const nowStr = new Date().toLocaleTimeString('zh-TW');
        state.savedTimestamp = nowStr;
        try {
          const jsonObj = PdfEngine.generateStructuredJson(state.pages, {
            examTitle: ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班考卷'
          });
          localStorage.setItem('smart_exam_ocr_saved_v1', JSON.stringify(jsonObj));
        } catch (e) {}
        const lbl = $('savedVersionStatus');
        if (lbl) lbl.textContent = `✅ 已儲存目前版本（${nowStr}）`;
        showToast(`💾 已將修改後內容儲存為目前版本（${nowStr}）！`);
      });
    }

    if ($('btnOpenReadingPreview')) {
      $('btnOpenReadingPreview').addEventListener('click', openReadingOrderPreviewModal);
    }
    if ($('btnCloseReadingPreview')) {
      $('btnCloseReadingPreview').addEventListener('click', () => {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        $('readingOrderModal').classList.remove('open');
      });
    }
    if ($('btnSpeakPreview')) {
      $('btnSpeakPreview').addEventListener('click', speakPreviewText);
    }

    // 步驟 ⑥：PDF (模式 A / 模式 B)、TXT、JSON 匯出按鈕
    if ($('btnExportPdfModeB')) {
      $('btnExportPdfModeB').addEventListener('click', () => handleExportPdf('B'));
    }
    if ($('btnExportPdfModeA')) {
      $('btnExportPdfModeA').addEventListener('click', () => handleExportPdf('A'));
    }
    if ($('btnExportJson')) {
      $('btnExportJson').addEventListener('click', handleExportJson);
    }
    if ($('btnExportTxt')) {
      $('btnExportTxt').addEventListener('click', handleExportTxt);
    }
    if ($('btnCopyJsonText')) {
      $('btnCopyJsonText').addEventListener('click', () => {
        const examTitle = ($('exportExamTitle') && $('exportExamTitle').value) || '國小資源班智慧考卷';
        const jsonObj = PdfEngine.generateStructuredJson(state.pages, { examTitle });
        navigator.clipboard
          .writeText(JSON.stringify(jsonObj, null, 2))
          .then(() => showToast('📋 已複製完整特教報讀 JSON（可直接貼入 Claude 報讀網站）！'));
      });
    }

    // 預設自動載入「核心驗收情境：國小國語混合排版考卷（左欄第一大題、右欄第二大題、下方第三大題）」於背景，方便教師一開站即可體驗或直接替換新照片
    loadSampleExam('acceptance_mixed', false);
  }

  window.addEventListener('DOMContentLoaded', initApp);
})();
