/**
 * 智慧考卷 OCR 掃描器 — 版面結構分析、影像前處理、透視校正與特教題型結構化引擎 (ocr-layout.js)
 * 支援瀏覽器端 (Canvas) 與 Node.js 自動化測試雙環境執行
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartExamLayoutEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // 1. 影像畫質與模糊度評估（低畫質影像提示重新拍攝）
  // ============================================================================
  function assessImageQuality(rgbaData, width, height) {
    const lowRes = width < 720 || height < 720;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 300));
    let sumLum = 0;
    let count = 0;
    let lapSum = 0;
    let lapSqSum = 0;
    let lapCount = 0;

    const getGray = (x, y) => {
      const idx = (y * width + x) * 4;
      return 0.299 * rgbaData[idx] + 0.587 * rgbaData[idx + 1] + 0.114 * rgbaData[idx + 2];
    };

    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const c = getGray(x, y);
        sumLum += c;
        count++;
        const lap =
          4 * c -
          getGray(x - step, y) -
          getGray(x + step, y) -
          getGray(x, y - step) -
          getGray(x, y + step);
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount++;
      }
    }

    const avgLum = count ? sumLum / count : 200;
    const lapMean = lapCount ? lapSum / lapCount : 0;
    const lapVar = lapCount ? Math.max(0, lapSqSum / lapCount - lapMean * lapMean) : 500;
    const isBlurry = lapVar < 110;
    const tooDark = avgLum < 95;
    const isLowQuality = lowRes || isBlurry || tooDark;

    let message = '✅ 影像清晰度良好，適合辨識繁體中文與細小注音。';
    if (lowRes && isBlurry) {
      message = '⚠️ 偵測到影像解析度偏低且略為模糊，細小注音可能辨識不清，建議開啟「2x 放大銳利化」或重新拍攝！';
    } else if (lowRes) {
      message = `⚠️ 影像解析度偏低（${width}×${height}），建議開啟「2x 圖片放大辨識」或靠近考卷重新拍攝。`;
    } else if (isBlurry) {
      message = '⚠️ 偵測到照片有手震或對焦模糊，建議開啟「文字銳利化」或穩住平板重新拍攝。';
    } else if (tooDark) {
      message = '⚠️ 照片光線偏暗或有明顯陰影，已自動啟用「去陰影與增亮強化」，亦可在開燈處重新拍攝。';
    }

    return {
      width,
      height,
      avgBrightness: Math.round(avgLum),
      sharpnessScore: Math.round(lapVar),
      lowRes,
      isBlurry,
      tooDark,
      isLowQuality,
      message
    };
  }

  // ============================================================================
  // 2. 自動偵測紙張邊界四頂點與透視變形修正 (Perspective Homography Warp)
  // ============================================================================
  function detectPaperQuad(rgbaData, width, height) {
    // 掃描邊緣梯度與亮色紙張區域，若整張已經是乾淨白底考卷則預設保留 1.5% 安全邊距
    let minX = Math.round(width * 0.02);
    let minY = Math.round(height * 0.02);
    let maxX = Math.round(width * 0.98);
    let maxY = Math.round(height * 0.98);

    // 檢測四周是否有深色桌面背景
    const borderLum = (x, y) => {
      const idx = (y * width + x) * 4;
      return 0.299 * rgbaData[idx] + 0.587 * rgbaData[idx + 1] + 0.114 * rgbaData[idx + 2];
    };

    const edgeSample = (borderLum(2, 2) + borderLum(width - 3, 2) + borderLum(2, height - 3) + borderLum(width - 3, height - 3)) / 4;
    if (edgeSample < 145) {
      // 有深色桌面背景，向內尋找紙張亮邊
      const stepX = Math.max(2, Math.floor(width / 120));
      const stepY = Math.max(2, Math.floor(height / 120));
      let foundMinX = width, foundMaxX = 0, foundMinY = height, foundMaxY = 0;
      for (let y = stepY; y < height - stepY; y += stepY) {
        for (let x = stepX; x < width - stepX; x += stepX) {
          if (borderLum(x, y) > 165) {
            if (x < foundMinX) foundMinX = x;
            if (x > foundMaxX) foundMaxX = x;
            if (y < foundMinY) foundMinY = y;
            if (y > foundMaxY) foundMaxY = y;
          }
        }
      }
      if (foundMaxX - foundMinX > width * 0.45 && foundMaxY - foundMinY > height * 0.45) {
        minX = Math.max(0, foundMinX - 6);
        minY = Math.max(0, foundMinY - 6);
        maxX = Math.min(width - 1, foundMaxX + 6);
        maxY = Math.min(height - 1, foundMaxY + 6);
      }
    }

    return [
      { x: minX, y: minY }, // 左上 TL
      { x: maxX, y: minY }, // 右上 TR
      { x: maxX, y: maxY }, // 右下 BR
      { x: minX, y: maxY }  // 左下 BL
    ];
  }

  // 對四角形座標進行雙線性透視校正取樣 (Bilinear Perspective Rectification)
  function warpPerspectiveImageData(srcRgba, srcW, srcH, quad, dstW, dstH) {
    const [tl, tr, br, bl] = quad;
    const dst = new Uint8ClampedArray(dstW * dstH * 4);

    for (let y = 0; y < dstH; y++) {
      const v = y / Math.max(1, dstH - 1);
      const topX = tl.x + (tr.x - tl.x) * 0;
      const topY = tl.y + (tr.y - tl.y) * 0;
      for (let x = 0; x < dstW; x++) {
        const u = x / Math.max(1, dstW - 1);
        const sx =
          (1 - u) * (1 - v) * tl.x +
          u * (1 - v) * tr.x +
          u * v * br.x +
          (1 - u) * v * bl.x;
        const sy =
          (1 - u) * (1 - v) * tl.y +
          u * (1 - v) * tr.y +
          u * v * br.y +
          (1 - u) * v * bl.y;

        const ix = Math.max(0, Math.min(srcW - 1, Math.round(sx)));
        const iy = Math.max(0, Math.min(srcH - 1, Math.round(sy)));
        const sIdx = (iy * srcW + ix) * 4;
        const dIdx = (y * dstW + x) * 4;
        dst[dIdx] = srcRgba[sIdx];
        dst[dIdx + 1] = srcRgba[sIdx + 1];
        dst[dIdx + 2] = srcRgba[sIdx + 2];
        dst[dIdx + 3] = 255;
      }
    }
    return dst;
  }

  // 影像前處理強化（去陰影、對比增強、Unsharp Mask 銳利化、保留細小注音）
  function enhanceExamImageData(rgbaData, width, height, opts = {}) {
    const brightness = Number(opts.brightness ?? 0); // -50 ~ +50
    const contrast = Number(opts.contrast ?? 22); // -40 ~ +80
    const sharpen = Number(opts.sharpen ?? 0.55); // 0 ~ 1.5
    const removeShadow = opts.removeShadow !== false;
    const bwMode = !!opts.bwMode;

    const out = new Uint8ClampedArray(rgbaData.length);
    const gray = new Float32Array(width * height);
    let sum = 0;

    for (let i = 0, p = 0; i < rgbaData.length; i += 4, p++) {
      const g = 0.299 * rgbaData[i] + 0.587 * rgbaData[i + 1] + 0.114 * rgbaData[i + 2];
      gray[p] = g;
      sum += g;
    }

    const avg = sum / Math.max(1, width * height);
    const whitePt = removeShadow ? Math.max(165, Math.min(244, avg * 1.04)) : 250;
    const blackPt = Math.max(15, whitePt * (0.24 + Math.max(-0.15, Math.min(0.25, contrast / 260))));
    const span = Math.max(1, whitePt - blackPt);

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        let val = gray[idx];

        if (sharpen > 0 && x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const nb = (gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width]) * 0.25;
          val = val + (val - nb) * sharpen;
        }

        val += brightness * 1.8;
        let norm = ((val - blackPt) / span) * 255;
        norm = Math.max(0, Math.min(255, norm));

        if (bwMode) {
          norm = norm > 172 ? 255 : norm < 95 ? 0 : norm;
        } else if (norm > 218) {
          norm = 255;
        }

        const p4 = idx * 4;
        if (removeShadow || bwMode) {
          const v = Math.round(norm);
          out[p4] = v;
          out[p4 + 1] = v;
          out[p4 + 2] = v;
          out[p4 + 3] = 255;
        } else {
          const ratio = norm / Math.max(1, gray[idx]);
          out[p4] = Math.min(255, Math.round(rgbaData[p4] * ratio));
          out[p4 + 1] = Math.min(255, Math.round(rgbaData[p4 + 1] * ratio));
          out[p4 + 2] = Math.min(255, Math.round(rgbaData[p4 + 2] * ratio));
          out[p4 + 3] = 255;
        }
      }
    }
    return out;
  }

  // ============================================================================
  // 3. 智慧考卷版面辨識 (左右分欄、上下分區、混合版面 Recursive XY-Cut)
  // ============================================================================
  /**
   * 根據手動畫線與自動版面分析，將考卷切分為獨立區塊並計算正確閱讀順序：
   * 規則：
   * 1. 先依水平分隔線 (hLines) 由上而下切成數個「水平分區 (Horizontal Zones)」
   * 2. 在每個水平分區內，若有垂直分欄線 (vLines) 涵蓋該分區高度，則由左而右切成「左欄、右欄 (Columns)」
   * 3. 先完整讀完左欄（由上至下），再讀右欄（由上至下），再進入下一個水平分區！
   * 4. 題目、選項及注音絕不跨欄混合！
   */
  function sortBlocksByZonesAndColumns(blocks, pageWidth, pageHeight, dividers = {}) {
    const hLines = [...(dividers.hLines || [])]
      .map((l) => (typeof l === 'number' ? { y: l, x1: 0, x2: pageWidth } : l))
      .sort((a, b) => a.y - b.y);
    const vLines = [...(dividers.vLines || [])]
      .map((l) => (typeof l === 'number' ? { x: l, y1: 0, y2: pageHeight } : l))
      .sort((a, b) => a.x - b.x);

    // 建立水平區間 [yStart, yEnd]
    const yBounds = [0, ...hLines.map((l) => l.y), pageHeight];
    const zones = [];
    for (let i = 0; i < yBounds.length - 1; i++) {
      if (yBounds[i + 1] - yBounds[i] > 10) {
        zones.push({ yStart: yBounds[i], yEnd: yBounds[i + 1], index: i });
      }
    }

    const getZoneIdx = (blk) => {
      const cy = (blk.y || 0) + (blk.h || 0) / 2;
      for (let i = 0; i < zones.length; i++) {
        if (cy >= zones[i].yStart && cy <= zones[i].yEnd) return i;
      }
      return 0;
    };

    const getColIdx = (blk, zone) => {
      const cx = (blk.x || 0) + (blk.w || 0) / 2;
      // 跨欄寬大標題（寬度 > 68% 頁面寬度）若沒有被使用者強制畫直線切開，視為該分區頂部橫幅
      const activeVLines = vLines.filter((vl) => {
        const y1 = vl.y1 ?? 0;
        const y2 = vl.y2 ?? pageHeight;
        const overlap = Math.min(zone.yEnd, y2) - Math.max(zone.yStart, y1);
        return overlap > (zone.yEnd - zone.yStart) * 0.35;
      });
      if (!activeVLines.length) return 0;

      // 若區塊本身寬度橫跨分欄線且非手動畫線後拆分，檢查是否為頂部跨欄標題
      if ((blk.w || 0) > pageWidth * 0.68 && !blk.forceColumn) {
        return -1; // 該分區置頂橫幅
      }

      let col = 0;
      for (const vl of activeVLines) {
        if (cx > vl.x) col++;
      }
      return col;
    };

    const decorated = blocks.map((blk) => {
      const zIdx = getZoneIdx(blk);
      const zone = zones[zIdx] || { yStart: 0, yEnd: pageHeight };
      const cIdx = getColIdx(blk, zone);
      return { blk, zIdx, cIdx };
    });

    decorated.sort((a, b) => {
      if (a.zIdx !== b.zIdx) return a.zIdx - b.zIdx;
      if (a.cIdx !== b.cIdx) return a.cIdx - b.cIdx;
      const dy = (a.blk.y || 0) - (b.blk.y || 0);
      if (Math.abs(dy) > 14) return dy;
      return (a.blk.x || 0) - (b.blk.x || 0);
    });

    return decorated.map((d, idx) => {
      const colLabel =
        d.cIdx < 0 ? '跨欄區' : vLines.length > 0 ? (d.cIdx === 0 ? '左欄' : `右欄${d.cIdx > 1 ? d.cIdx : ''}`) : '單欄';
      const zoneLabel = zones.length > 1 ? `第${d.zIdx + 1}分區・${colLabel}` : colLabel;
      return {
        ...d.blk,
        readingOrder: idx + 1,
        zoneIndex: d.zIdx,
        columnIndex: Math.max(0, d.cIdx),
        layoutZoneLabel: zoneLabel
      };
    });
  }

  /**
   * 當教師手動畫直線 (x) 或畫橫線 (y) 時，若該線穿過某個尚未拆分的超大區塊，可自動沿線切開或重新分區排序
   */
  function applyDividerLineToBlocks(blocks, divider, pageWidth, pageHeight, allDividers) {
    const nextBlocks = [];
    let idCounter = Date.now();

    for (const blk of blocks) {
      if (divider.orientation === 'vertical') {
        const vx = divider.x;
        const vy1 = divider.y1 ?? 0;
        const vy2 = divider.y2 ?? pageHeight;
        const overlapsY = Math.min(blk.y + blk.h, vy2) - Math.max(blk.y, vy1) > blk.h * 0.4;
        // 若直線明確穿過一個寬區塊內部（距左右邊緣各 > 36px），自動將其拆成左右兩欄區塊
        if (overlapsY && vx > blk.x + 36 && vx < blk.x + blk.w - 36) {
          const leftW = vx - blk.x - 4;
          const rightX = vx + 4;
          const rightW = blk.x + blk.w - rightX;
          nextBlocks.push({
            ...blk,
            id: `blk_${idCounter++}`,
            w: leftW,
            forceColumn: true
          });
          nextBlocks.push({
            ...blk,
            id: `blk_${idCounter++}`,
            x: rightX,
            w: rightW,
            forceColumn: true
          });
          continue;
        }
      } else if (divider.orientation === 'horizontal') {
        const hy = divider.y;
        const hx1 = divider.x1 ?? 0;
        const hx2 = divider.x2 ?? pageWidth;
        const overlapsX = Math.min(blk.x + blk.w, hx2) - Math.max(blk.x, hx1) > blk.w * 0.4;
        if (overlapsX && hy > blk.y + 24 && hy < blk.y + blk.h - 24) {
          const topH = hy - blk.y - 4;
          const botY = hy + 4;
          const botH = blk.y + blk.h - botY;
          nextBlocks.push({
            ...blk,
            id: `blk_${idCounter++}`,
            h: topH
          });
          nextBlocks.push({
            ...blk,
            id: `blk_${idCounter++}`,
            y: botY,
            h: botH
          });
          continue;
        }
      }
      nextBlocks.push({ ...blk });
    }

    return sortBlocksByZonesAndColumns(nextBlocks, pageWidth, pageHeight, allDividers);
  }

  /**
   * 對像素畫布執行自動版面分析 (XY-Cut + 水平分隔線偵測 + 左右欄中縫偵測)
   */
  function analyzeCanvasLayout(rgbaData, width, height) {
    // 1. 建立二值化墨跡矩陣 (ink = 1 if gray < 188)
    const inkRow = new Uint32Array(height);
    const isInk = new Uint8Array(width * height);
    const marginX = Math.round(width * 0.035);
    const marginY = Math.round(height * 0.035);

    for (let y = marginY; y < height - marginY; y++) {
      let rSum = 0;
      const rOff = y * width;
      for (let x = marginX; x < width - marginX; x++) {
        const idx = (rOff + x) * 4;
        const g = 0.299 * rgbaData[idx] + 0.587 * rgbaData[idx + 1] + 0.114 * rgbaData[idx + 2];
        if (g < 190) {
          isInk[rOff + x] = 1;
          rSum++;
        }
      }
      inkRow[y] = rSum;
    }

    // 2. 偵測水平實線分隔線 (連續寬度 > 55% 頁面寬度的水平線)
    const detectedHLines = [];
    const activeW = width - marginX * 2;
    let y = Math.round(height * 0.15);
    while (y < Math.round(height * 0.88)) {
      if (inkRow[y] > activeW * 0.52) {
        // 檢查上下 18px 的平均墨跡是否遠小於此線（排除密排文字行）
        let nearSum = 0;
        let nearCnt = 0;
        for (let dy = -16; dy <= 16; dy++) {
          if (Math.abs(dy) <= 3) continue;
          const ny = y + dy;
          if (ny >= marginY && ny < height - marginY) {
            nearSum += inkRow[ny];
            nearCnt++;
          }
        }
        const nearAvg = nearCnt ? nearSum / nearCnt : activeW;
        if (nearAvg < activeW * 0.18) {
          detectedHLines.push({
            id: `hl_auto_${y}`,
            y,
            x1: marginX,
            x2: width - marginX,
            auto: true
          });
          y += 35;
          continue;
        }
      }
      y++;
    }

    // 3. 依水平分隔線切出上下分區，在每個分區檢查是否有中央垂直中縫 (Column Gutter)
    const yCuts = [marginY, ...detectedHLines.map((l) => l.y), height - marginY];
    const detectedVLines = [];
    const rawBlocks = [];
    let blkCounter = 1;

    for (let z = 0; z < yCuts.length - 1; z++) {
      const zTop = yCuts[z] + (z === 0 ? 0 : 8);
      const zBot = yCuts[z + 1] - 8;
      if (zBot - zTop < 50) continue;

      // 計算該分區的垂直投影 (排除頂部 12% 可能是橫跨標題區)
      const colCheckTop = zTop + Math.round((zBot - zTop) * 0.12);
      const centerMinX = Math.round(width * 0.43);
      const centerMaxX = Math.round(width * 0.57);
      let bestSplitX = -1;
      let minColInk = Infinity;

      for (let cx = centerMinX; cx <= centerMaxX; cx += 3) {
        let colInk = 0;
        for (let py = colCheckTop; py < zBot; py++) {
          // 檢查 cx 左右 4px 走廊
          if (isInk[py * width + cx] || isInk[py * width + cx - 2] || isInk[py * width + cx + 2]) {
            colInk++;
          }
        }
        if (colInk < minColInk) {
          minColInk = colInk;
          bestSplitX = cx;
        }
      }

      // 檢查左右兩側是否都有足夠墨跡，且中央走廊幾乎空白
      let leftInk = 0;
      let rightInk = 0;
      for (let py = colCheckTop; py < zBot; py += 2) {
        for (let px = marginX; px < bestSplitX - 10; px += 2) {
          if (isInk[py * width + px]) leftInk++;
        }
        for (let px = bestSplitX + 10; px < width - marginX; px += 2) {
          if (isInk[py * width + px]) rightInk++;
        }
      }

      const hasTwoCols =
        bestSplitX > 0 &&
        minColInk < (zBot - colCheckTop) * 0.045 &&
        leftInk > 120 &&
        rightInk > 120;

      if (hasTwoCols) {
        detectedVLines.push({
          id: `vl_auto_${z}_${bestSplitX}`,
          x: bestSplitX,
          y1: zTop,
          y2: zBot,
          auto: true
        });
      }

      // 在每個欄內由上而下切出水平文字段落群組
      const xRanges = hasTwoCols
        ? [
            [marginX, bestSplitX - 6],
            [bestSplitX + 6, width - marginX]
          ]
        : [[marginX, width - marginX]];

      for (let cIdx = 0; cIdx < xRanges.length; cIdx++) {
        const [x0, x1] = xRanges[cIdx];
        let inSeg = false;
        let segStart = zTop;
        let blankRun = 0;
        const minGap = 16;

        for (let py = zTop; py <= zBot; py++) {
          let rowCnt = 0;
          if (py < zBot) {
            const rOff = py * width;
            for (let px = x0; px <= x1; px++) {
              if (isInk[rOff + px]) rowCnt++;
            }
          }
          if (rowCnt > 3) {
            if (!inSeg) {
              inSeg = true;
              segStart = Math.max(zTop, py - 4);
            }
            blankRun = 0;
          } else if (inSeg) {
            blankRun++;
            if (blankRun >= minGap || py === zBot) {
              const segEnd = Math.min(zBot, py - blankRun + 5);
              if (segEnd - segStart >= 18) {
                // 找出實際左右墨跡邊界
                let bMinX = x1, bMaxX = x0;
                for (let sy = segStart; sy <= segEnd; sy++) {
                  const rOff = sy * width;
                  for (let sx = x0; sx <= x1; sx++) {
                    if (isInk[rOff + sx]) {
                      if (sx < bMinX) bMinX = sx;
                      if (sx > bMaxX) bMaxX = sx;
                    }
                  }
                }
                if (bMaxX - bMinX > 20) {
                  rawBlocks.push({
                    id: `blk_auto_${blkCounter++}`,
                    x: Math.max(marginX, bMinX - 8),
                    y: segStart,
                    w: Math.min(x1 - x0, bMaxX - bMinX + 16),
                    h: segEnd - segStart,
                    type: segEnd - segStart < 44 && z === 0 && rawBlocks.length === 0 ? 'section' : 'question',
                    text: '',
                    confidence: 92
                  });
                }
              }
              inSeg = false;
              blankRun = 0;
            }
          }
        }
      }
    }

    const dividers = { hLines: detectedHLines, vLines: detectedVLines };
    const sorted = sortBlocksByZonesAndColumns(rawBlocks, width, height, dividers);
    return { dividers, blocks: sorted };
  }

  // ============================================================================
  // 4. 國小考卷題幹、選項、注音、數學算式結構化智慧解析器
  // ============================================================================
  const ZHUYIN_REGEX = /[ㄅ-ㄩ]+[ˊˇˋ˙]?|[˙][ㄅ-ㄩ]+/g;
  const MATH_EXPR_REGEX = /\d+\s*[＋+\-－×*÷/＝=]\s*\d+(?:\s*[＋+\-－×*÷/＝=]\s*(?:\d+|\?|[□（）()]+))*/g;
  const SECTION_NUM_REGEX = /^(第[一二三四五六七八九十]+大題|[一二三四五六七八九十]+、|[壹貳參肆伍陸柒捌玖拾]+、)/;
  const QUESTION_NUM_REGEX = /^((?:[\(（][\s　]*[\)）]\s*)?(?:第\s*\d+\s*題|\d+[\.、．]|[\(（]\d+[\)）]|[①-⑳]))/;

  function parseQuestionStructure(rawText, defaultType = 'question', fallbackSecNum = '第一大題', fallbackSecTitle = '綜合測驗') {
    const clean = String(rawText || '')
      .replace(/\r\n/g, '\n')
      .trim();

    const result = {
      type: defaultType,
      sectionNumber: fallbackSecNum,
      sectionTitle: fallbackSecTitle,
      questionNumber: '',
      stemText: clean,
      options: [],
      zhuyinText: '',
      mathFormula: ''
    };

    if (!clean) return result;

    // 1. 判斷是否為大題標題
    const secMatch = clean.match(SECTION_NUM_REGEX);
    if (defaultType === 'section' || (secMatch && clean.length < 36 && !/[A-D①-④]\s*[\.、．)]/.test(clean))) {
      result.type = 'section';
      if (secMatch) {
        result.sectionNumber = secMatch[1].replace(/、$/, '');
        result.sectionTitle = clean
          .slice(secMatch[0].length)
          .replace(/^[：:\s]+/, '')
          .trim();
      } else {
        result.sectionTitle = clean;
      }
      result.stemText = clean;
      return result;
    }

    // 2. 擷取注音內容
    const zhuyinMatches = clean.match(ZHUYIN_REGEX);
    if (zhuyinMatches && zhuyinMatches.length > 0) {
      result.zhuyinText = zhuyinMatches.join(' ');
    }

    // 3. 擷取數學算式
    const mathMatches = clean.match(MATH_EXPR_REGEX);
    if (mathMatches && mathMatches.length > 0) {
      result.mathFormula = mathMatches.join(' ； ');
    }

    // 4. 分離選項 (支援 A. B. C. D. / (A)(B)(C)(D) / ① ② ③ ④)
    const optionSplitRegex = /(?=(?:^|\s+)(?:[\(（]?[A-D][\.、．\)）]|[①②③④⑤])\s*)/g;
    const parts = clean.split(optionSplitRegex).map((s) => s.trim()).filter(Boolean);

    let stemRaw = clean;
    if (parts.length >= 2 && /^(?:[\(（]?[A-D][\.、．\)）]|[①②③④⑤])/.test(parts[1])) {
      stemRaw = parts[0];
      result.options = parts.slice(1).map((opt) =>
        opt.replace(/^[\(（]([A-D])[\)）]\s*/, '$1. ')
      );
    } else {
      // 檢查多行選項
      const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
      const optLines = [];
      const stemLines = [];
      for (const line of lines) {
        if (/^(?:[\(（]?[A-D][\.、．\)）]|[①②③④⑤])\s*\S+/.test(line)) {
          optLines.push(line.replace(/^[\(（]([A-D])[\)）]\s*/, '$1. '));
        } else {
          stemLines.push(line);
        }
      }
      if (optLines.length >= 2) {
        stemRaw = stemLines.join(' ');
        result.options = optLines;
      }
    }

    // 5. 擷取小題題號
    const qMatch = stemRaw.match(QUESTION_NUM_REGEX);
    if (qMatch) {
      const rawNum = qMatch[1].trim();
      const digits = rawNum.match(/\d+/);
      result.questionNumber = digits ? `第 ${digits[0]} 題` : rawNum;
      const afterNum = stemRaw.slice(qMatch[0].length).replace(/^[：:\s\.、]+/, '').trim();
      // 若原題幹開頭有作答括號「（　）」，保留括號於題幹方便對照
      const prefixBlank = /^\s*[\(（][\s　]*[\)）]/.test(rawNum) ? '（　）' : '';
      result.stemText = (prefixBlank + afterNum) || stemRaw;
    } else {
      result.stemText = stemRaw;
    }

    return result;
  }

  // ============================================================================
  // 5. 純 JavaScript ISO/IEC 18004 標準 QR Code 矩陣產生器 (無須外部圖片 API)
  // ============================================================================
  function generateQrMatrix(text) {
    const dataBytes = Array.from(new TextEncoder().encode(String(text || 'https://liniris1023.github.io/smart-exam-ocr/')));
    // 自動選擇合適 Version (Level L, Byte mode): V3(53B), V4(78B), V5(106B), V6(134B)
    const VERSIONS = [
      null,
      { v: 1, size: 21, totalCodewords: 26, ecCodewords: 7, align: [] },
      { v: 2, size: 25, totalCodewords: 44, ecCodewords: 10, align: [6, 18] },
      { v: 3, size: 29, totalCodewords: 70, ecCodewords: 15, align: [6, 22] },
      { v: 4, size: 33, totalCodewords: 100, ecCodewords: 20, align: [6, 26] },
      { v: 5, size: 37, totalCodewords: 134, ecCodewords: 26, align: [6, 30] },
      { v: 6, size: 41, totalCodewords: 172, ecCodewords: 36, align: [6, 34] } // 2 blocks of 18 EC in V6, keep V1-V5 single-block for simplicity
    ];

    let ver = VERSIONS[5]; // Version 5 (up to 106 UTF-8 bytes in single block Level L!)
    for (let v = 1; v <= 5; v++) {
      const cap = VERSIONS[v].totalCodewords - VERSIONS[v].ecCodewords - 2;
      if (dataBytes.length <= cap) {
        ver = VERSIONS[v];
        break;
      }
    }

    const dataCap = ver.totalCodewords - ver.ecCodewords;
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    pushBits(0b0100, 4); // Byte mode
    pushBits(Math.min(dataBytes.length, dataCap - 2), 8);
    for (let i = 0; i < Math.min(dataBytes.length, dataCap - 2); i++) {
      pushBits(dataBytes[i], 8);
    }
    pushBits(0, Math.min(4, dataCap * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    const padBytes = [0xec, 0x11];
    let pIdx = 0;
    while (codewords.length < dataCap) {
      codewords.push(padBytes[pIdx++ % 2]);
    }

    // GF(256) Reed-Solomon Error Correction
    const gfExp = new Uint8Array(512);
    const gfLog = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      gfExp[i] = x;
      gfLog[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
    const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : gfExp[gfLog[a] + gfLog[b]]);

    let gen = [1];
    for (let i = 0; i < ver.ecCodewords; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], gfExp[i]);
      }
      gen = next;
    }

    const msg = [...codewords, ...new Array(ver.ecCodewords).fill(0)];
    for (let i = 0; i < codewords.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    const ecBytes = msg.slice(codewords.length);
    const allBytes = [...codewords, ...ecBytes];

    // Build QR Matrix
    const size = ver.size;
    const mat = Array.from({ length: size }, () => new Array(size).fill(0));
    const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

    const setFinder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r, cc = c0 + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const on =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          mat[rr][cc] = on ? 1 : 0;
          isFunc[rr][cc] = true;
        }
      }
    };
    setFinder(0, 0);
    setFinder(0, size - 7);
    setFinder(size - 7, 0);

    // Alignment pattern
    if (ver.align.length >= 2) {
      const ar = ver.align[1], ac = ver.align[1];
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          mat[ar + r][ac + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1 ? 1 : 0;
          isFunc[ar + r][ac + c] = true;
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      mat[6][i] = i % 2 === 0 ? 1 : 0;
      isFunc[6][i] = true;
      mat[i][6] = i % 2 === 0 ? 1 : 0;
      isFunc[i][6] = true;
    }

    // Reserve format areas
    for (let i = 0; i < 9; i++) {
      if (i < size) {
        isFunc[8][i] = true;
        isFunc[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i++) {
      isFunc[8][size - 1 - i] = true;
      isFunc[size - 1 - i][8] = true;
    }
    mat[size - 8][8] = 1;
    isFunc[size - 8][8] = true;

    // Place data bits
    let bitIdx = 0;
    const totalBits = allBytes.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              bit = (allBytes[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            // Mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) bit ^= 1;
            mat[r][c] = bit;
          }
        }
      }
      upward = !upward;
    }

    // Format info for Level L (01) + Mask 0 (000) -> 0x77c4
    const fmtBits = 0x77c4;
    for (let i = 0; i <= 5; i++) mat[8][i] = (fmtBits >> (14 - i)) & 1;
    mat[8][7] = (fmtBits >> 8) & 1;
    mat[8][8] = (fmtBits >> 7) & 1;
    mat[7][8] = (fmtBits >> 6) & 1;
    for (let i = 0; i < 6; i++) mat[5 - i][8] = (fmtBits >> (5 - i)) & 1;
    for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = (fmtBits >> i) & 1;
    for (let i = 0; i < 7; i++) mat[size - 7 + i][8] = (fmtBits >> (14 - i)) & 1;

    return mat;
  }

  return {
    assessImageQuality,
    detectPaperQuad,
    warpPerspectiveImageData,
    enhanceExamImageData,
    sortBlocksByZonesAndColumns,
    applyDividerLineToBlocks,
    analyzeCanvasLayout,
    parseQuestionStructure,
    generateQrMatrix
  };
});
