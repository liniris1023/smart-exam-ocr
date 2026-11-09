/**
 * 智慧考卷 OCR 掃描器 — 真正文字層 PDF 雙模式產生引擎 (pdf-engine.js)
 * 支援瀏覽器端 (Web) 與 Node.js 自動化驗收測試雙環境執行
 *
 * 功能包含：
 * 1. TrueType (.ttf) 字型表解析 (cmap format 4/12, glyf, loca, hmtx, head, hhea, maxp, OS/2)
 * 2. 動態字型子集化 (Dynamic Glyph Subsetting) — 將 4.3MB 繁中注音字型壓縮至 30~90KB 嵌入 PDF
 * 3. 完整 /ToUnicode CMap 映射表與 CIDFontType2 (Identity-H) 編碼，確保 100% 可選取、複製、搜尋及報讀擷取
 * 4. 模式 A：原稿保留 PDF（背景保留清晰考卷影像＋對應座標真正可搜尋選取文字層，依校正閱讀順序排列）
 * 5. 模式 B：重新排版文字型 PDF（A4 直式、嵌入繁中注音字型、大題/小題/選項/注音/算式/表格/插圖完整重排）
 * 6. 特教報讀結構化 JSON 與 TXT 匯出產生器
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartExamPdfEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- 跨環境 Deflate 壓縮 (Browser CompressionStream / Node zlib) ---
  async function deflateBytes(uint8) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const zlib = require('zlib');
      return new Uint8Array(zlib.deflateSync(Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength)));
    }
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(uint8);
      writer.close();
      const chunks = [];
      const reader = cs.readable.getReader();
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const ch of chunks) {
        out.set(ch, offset);
        offset += ch.length;
      }
      return out;
    }
    return uint8;
  }

  // --- 解析 TrueType 字型 ---
  function parseTtf(uint8) {
    const dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    const numTables = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = String.fromCharCode(
        dv.getUint8(off),
        dv.getUint8(off + 1),
        dv.getUint8(off + 2),
        dv.getUint8(off + 3)
      );
      tables[tag] = { offset: dv.getUint32(off + 8), length: dv.getUint32(off + 12) };
    }
    const headOff = tables['head'].offset;
    const unitsPerEm = dv.getUint16(headOff + 18);
    const xMin = dv.getInt16(headOff + 36);
    const yMin = dv.getInt16(headOff + 38);
    const xMax = dv.getInt16(headOff + 40);
    const yMax = dv.getInt16(headOff + 42);
    const indexToLocFormat = dv.getInt16(headOff + 50);

    const hheaOff = tables['hhea'].offset;
    const ascent = dv.getInt16(hheaOff + 4);
    const descent = dv.getInt16(hheaOff + 6);
    const numOfLongHorMetrics = dv.getUint16(hheaOff + 34);
    const numGlyphs = dv.getUint16(tables['maxp'].offset + 4);

    const hmtxOff = tables['hmtx'].offset;
    const widths = new Uint16Array(numGlyphs);
    let lastW = unitsPerEm;
    for (let i = 0; i < numGlyphs; i++) {
      if (i < numOfLongHorMetrics) {
        lastW = dv.getUint16(hmtxOff + i * 4);
      }
      widths[i] = lastW;
    }

    const cmapOff = tables['cmap'].offset;
    const numSubtables = dv.getUint16(cmapOff + 2);
    let fmt12Off = 0;
    let fmt4Off = 0;
    for (let i = 0; i < numSubtables; i++) {
      const subOff = cmapOff + dv.getUint32(cmapOff + 4 + i * 8 + 4);
      const fmt = dv.getUint16(subOff);
      if (fmt === 12) fmt12Off = subOff;
      else if (fmt === 4 && !fmt4Off) fmt4Off = subOff;
    }

    const codeToGid = new Map();
    if (fmt12Off) {
      const nGroups = dv.getUint32(fmt12Off + 12);
      for (let i = 0; i < nGroups; i++) {
        const gOff = fmt12Off + 16 + i * 12;
        const startCode = dv.getUint32(gOff);
        const endCode = dv.getUint32(gOff + 4);
        const startGid = dv.getUint32(gOff + 8);
        for (let c = startCode; c <= endCode; c++) {
          codeToGid.set(c, startGid + (c - startCode));
        }
      }
    } else if (fmt4Off) {
      const segCount = dv.getUint16(fmt4Off + 6) / 2;
      const endCodeBase = fmt4Off + 14;
      const startCodeBase = endCodeBase + segCount * 2 + 2;
      const idDeltaBase = startCodeBase + segCount * 2;
      const idRangeOffsetBase = idDeltaBase + segCount * 2;
      for (let i = 0; i < segCount; i++) {
        const endC = dv.getUint16(endCodeBase + i * 2);
        const startC = dv.getUint16(startCodeBase + i * 2);
        const idDelta = dv.getInt16(idDeltaBase + i * 2);
        const idRangeOff = dv.getUint16(idRangeOffsetBase + i * 2);
        if (startC === 0xffff) break;
        for (let c = startC; c <= endC; c++) {
          let gid = 0;
          if (idRangeOff === 0) {
            gid = (c + idDelta) & 0xffff;
          } else {
            const glyphIdxOff = idRangeOffsetBase + i * 2 + idRangeOff + (c - startC) * 2;
            gid = dv.getUint16(glyphIdxOff);
            if (gid !== 0) gid = (gid + idDelta) & 0xffff;
          }
          if (gid > 0) codeToGid.set(c, gid);
        }
      }
    }

    const locaOff = tables['loca'].offset;
    const loca = new Uint32Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
      loca[i] =
        indexToLocFormat === 0
          ? dv.getUint16(locaOff + i * 2) * 2
          : dv.getUint32(locaOff + i * 4);
    }

    return {
      uint8,
      dv,
      tables,
      unitsPerEm,
      xMin,
      yMin,
      xMax,
      yMax,
      ascent,
      descent,
      numGlyphs,
      widths,
      codeToGid,
      loca
    };
  }

  // --- 動態擷取使用到的字形 (Subsetting) ---
  function subsetTtf(font, usedGidsSet) {
    const { uint8, dv, tables, numGlyphs, loca } = font;
    const glyfOff = tables['glyf'].offset;
    const allGids = new Set([0, ...usedGidsSet]);

    const queue = [...allGids];
    while (queue.length) {
      const gid = queue.pop();
      if (gid >= numGlyphs) continue;
      const gStart = loca[gid];
      const gEnd = loca[gid + 1];
      if (gEnd <= gStart) continue;
      const numContours = dv.getInt16(glyfOff + gStart);
      if (numContours < 0) {
        let pos = glyfOff + gStart + 10;
        while (pos < glyfOff + gEnd) {
          const flags = dv.getUint16(pos);
          const compGid = dv.getUint16(pos + 2);
          if (!allGids.has(compGid)) {
            allGids.add(compGid);
            queue.push(compGid);
          }
          pos += 4;
          if (flags & 0x0001) pos += 4;
          else pos += 2;
          if (flags & 0x0008) pos += 2;
          else if (flags & 0x0040) pos += 4;
          else if (flags & 0x0080) pos += 8;
          if (!(flags & 0x0020)) break;
        }
      }
    }

    const glyphChunks = [];
    const newLoca = new Uint32Array(numGlyphs + 1);
    let curGlyfLen = 0;
    for (let g = 0; g < numGlyphs; g++) {
      newLoca[g] = curGlyfLen;
      if (allGids.has(g)) {
        const s = loca[g];
        const e = loca[g + 1];
        if (e > s) {
          const slice = uint8.subarray(glyfOff + s, glyfOff + e);
          const pad = (4 - (slice.length % 4)) % 4;
          glyphChunks.push(slice);
          if (pad) glyphChunks.push(new Uint8Array(pad));
          curGlyfLen += slice.length + pad;
        }
      }
    }
    newLoca[numGlyphs] = curGlyfLen;

    const newGlyf = new Uint8Array(curGlyfLen || 4);
    let pos = 0;
    for (const ch of glyphChunks) {
      newGlyf.set(ch, pos);
      pos += ch.length;
    }

    const newLocaBytes = new Uint8Array((numGlyphs + 1) * 4);
    const locaDv = new DataView(newLocaBytes.buffer);
    for (let g = 0; g <= numGlyphs; g++) locaDv.setUint32(g * 4, newLoca[g]);

    const keepTags = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
    const tableBytesMap = {};
    for (const tag of keepTags) {
      if (tag === 'glyf') tableBytesMap[tag] = newGlyf;
      else if (tag === 'loca') tableBytesMap[tag] = newLocaBytes;
      else if (tag === 'head') {
        const headCopy = new Uint8Array(
          uint8.subarray(tables['head'].offset, tables['head'].offset + tables['head'].length)
        );
        new DataView(headCopy.buffer).setInt16(50, 1);
        tableBytesMap[tag] = headCopy;
      } else if (tag === 'post') {
        const postMin = new Uint8Array(32);
        new DataView(postMin.buffer).setUint32(0, 0x00030000);
        tableBytesMap[tag] = postMin;
      } else if (tables[tag]) {
        tableBytesMap[tag] = uint8.subarray(
          tables[tag].offset,
          tables[tag].offset + tables[tag].length
        );
      }
    }

    const activeTags = keepTags.filter((t) => tableBytesMap[t]);
    const numT = activeTags.length;
    let totalSize = 12 + numT * 16;
    for (const t of activeTags) {
      totalSize += (tableBytesMap[t].length + 3) & ~3;
    }
    const out = new Uint8Array(totalSize);
    const outDv = new DataView(out.buffer);
    outDv.setUint32(0, 0x00010000);
    outDv.setUint16(4, numT);
    outDv.setUint16(6, 128);
    outDv.setUint16(8, 3);
    outDv.setUint16(10, numT * 16 - 128);

    let tOff = 12 + numT * 16;
    activeTags.forEach((tag, idx) => {
      const bytes = tableBytesMap[tag];
      out.set(bytes, tOff);
      const dirOff = 12 + idx * 16;
      for (let k = 0; k < 4; k++) out[dirOff + k] = tag.charCodeAt(k);
      outDv.setUint32(dirOff + 4, 0);
      outDv.setUint32(dirOff + 8, tOff);
      outDv.setUint32(dirOff + 12, bytes.length);
      tOff += (bytes.length + 3) & ~3;
    });
    return out;
  }

  // --- 建立 /ToUnicode CMap 確保所有閱讀器與報讀系統皆可複製與擷取 Unicode ---
  function buildToUnicodeCMap(gidToCpMap) {
    const entries = [...gidToCpMap.entries()].sort((a, b) => a[0] - b[0]);
    let cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
`;
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      cmap += `${chunk.length} beginbfchar\n`;
      for (const [gid, cp] of chunk) {
        const gidHex = gid.toString(16).toUpperCase().padStart(4, '0');
        let uniHex;
        if (cp <= 0xffff) {
          uniHex = cp.toString(16).toUpperCase().padStart(4, '0');
        } else {
          const u = cp - 0x10000;
          const hi = (0xd800 + (u >> 10)).toString(16).toUpperCase().padStart(4, '0');
          const lo = (0xdc00 + (u & 0x3ff)).toString(16).toUpperCase().padStart(4, '0');
          uniHex = hi + lo;
        }
        cmap += `<${gidHex}> <${uniHex}>\n`;
      }
      cmap += `endbfchar\n`;
    }
    cmap += `endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
    return new TextEncoder().encode(cmap);
  }

  function encodeTextToHexGids(text, font, usedGids, gidToCp) {
    let hex = '';
    const FALLBACK_CHAR_MAP = {
      0x2715: 0x00d7, // ✕ -> ×
      0x2716: 0x00d7, // ✖ -> ×
      0x2717: 0x00d7, // ✗ -> ×
      0x2718: 0x00d7, // ✘ -> ×
      0x2713: 0x25cb, // ✓ -> ○
      0x2714: 0x25cb  // ✔ -> ○
    };
    const clean = String(text || '').replace(/\r?\n/g, ' ');
    for (const ch of clean) {
      let cp = ch.codePointAt(0);
      let gid = font.codeToGid.get(cp);
      if (!gid && FALLBACK_CHAR_MAP[cp]) {
        cp = FALLBACK_CHAR_MAP[cp];
        gid = font.codeToGid.get(cp);
      }
      if (!gid) {
        if (cp === 0x3000) gid = font.codeToGid.get(0x0020) || 1;
        else gid = font.codeToGid.get(0x0020) || 1;
      }
      usedGids.add(gid);
      if (!gidToCp.has(gid)) gidToCp.set(gid, cp);
      hex += gid.toString(16).toUpperCase().padStart(4, '0');
    }
    return `<${hex}>`;
  }

  function measureTextWidthPt(text, fontSize, font) {
    let totalUnits = 0;
    for (const ch of String(text || '')) {
      const cp = ch.codePointAt(0);
      const gid = font.codeToGid.get(cp) || font.codeToGid.get(0x20) || 1;
      totalUnits += font.widths[gid] || font.unitsPerEm;
    }
    return (totalUnits * fontSize) / font.unitsPerEm;
  }

  function wrapTextByWidth(text, maxWidthPt, fontSize, font) {
    const paragraphs = String(text || '').split(/\r?\n/);
    const lines = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      let cur = '';
      let curW = 0;
      for (const ch of para) {
        const cw = measureTextWidthPt(ch, fontSize, font);
        if (cur && curW + cw > maxWidthPt) {
          lines.push(cur);
          cur = ch;
          curW = cw;
        } else {
          cur += ch;
          curW += cw;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines.length ? lines : [''];
  }

  function dataUrlToUint8(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const parts = dataUrl.split(',');
    const b64 = parts.length > 1 ? parts[1] : parts[0];
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 解析 JPEG 寬高以嵌入 PDF XObject
  function getJpegDimensions(uint8) {
    let i = 2;
    while (i + 9 < uint8.length) {
      if (uint8[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = uint8[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const h = (uint8[i + 5] << 8) | uint8[i + 6];
        const w = (uint8[i + 7] << 8) | uint8[i + 8];
        return { width: w || 800, height: h || 600 };
      }
      const len = (uint8[i + 2] << 8) | uint8[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
    return { width: 1200, height: 1600 };
  }

  // 組裝完整 PDF 二進位檔
  function assemblePdfDocument(pagesSpec, font, usedGids, gidToCp, subTtfBytes, compressedFont) {
    const cmapBytes = buildToUnicodeCMap(gidToCp);
    const wArr = [];
    for (const gid of [...usedGids].sort((a, b) => a - b)) {
      const w = Math.round(((font.widths[gid] || 1000) * 1000) / font.unitsPerEm);
      wArr.push(`${gid} [${w}]`);
    }

    const objs = [];
    let nextId = 1;
    const allocId = () => nextId++;
    const addObj = (id, dictStr, streamBytes = null) => {
      objs.push({ id, dictStr, streamBytes });
    };

    const catalogId = allocId(); // 1
    const pagesId = allocId(); // 2
    const fontType0Id = allocId(); // 3
    const cidFontId = allocId(); // 4
    const fontDescId = allocId(); // 5
    const toUniId = allocId(); // 6
    const fontFileId = allocId(); // 7

    // Graphics state for Mode A invisible/semi-transparent text
    const gsNormalId = allocId(); // 8
    addObj(gsNormalId, `<< /Type /ExtGState /ca 1 /CA 1 >>`);
    const gsOverlayId = allocId(); // 9
    addObj(gsOverlayId, `<< /Type /ExtGState /ca 0.28 /CA 0.28 >>`);

    addObj(
      fontType0Id,
      `<< /Type /Font /Subtype /Type0 /BaseFont /IansuiExam /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUniId} 0 R >>`
    );
    addObj(
      cidFontId,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /IansuiExam /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescId} 0 R /DW 1000 /W [${wArr.join(' ')}] /CIDToGIDMap /Identity >>`
    );
    addObj(
      fontDescId,
      `<< /Type /FontDescriptor /FontName /IansuiExam /Flags 32 /FontBBox [${font.xMin} ${font.yMin} ${font.xMax} ${font.yMax}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight 700 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`
    );
    addObj(toUniId, `<< /Length ${cmapBytes.length} >>`, cmapBytes);
    addObj(
      fontFileId,
      `<< /Length ${compressedFont.length} /Length1 ${subTtfBytes.length} /Filter /FlateDecode >>`,
      compressedFont
    );

    const pageIds = [];
    for (const p of pagesSpec) {
      const pageId = allocId();
      const contentId = allocId();
      pageIds.push(pageId);

      const xobjEntries = [];
      for (const img of p.images || []) {
        const imgId = allocId();
        addObj(
          imgId,
          `<< /Type /XObject /Subtype /Image /Width ${img.pixelW} /Height ${img.pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
          img.bytes
        );
        xobjEntries.push(`/${img.name} ${imgId} 0 R`);
      }

      const xobjDict = xobjEntries.length ? `/XObject << ${xobjEntries.join(' ')} >>` : '';
      const contentBytes = new TextEncoder().encode(p.streamCommands.join('\n'));
      addObj(contentId, `<< /Length ${contentBytes.length} >>`, contentBytes);

      addObj(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${p.widthPt.toFixed(2)} ${p.heightPt.toFixed(2)}] /Resources << /Font << /F1 ${fontType0Id} 0 R >> /ExtGState << /GS1 ${gsNormalId} 0 R /GS2 ${gsOverlayId} 0 R >> ${xobjDict} >> /Contents ${contentId} 0 R >>`
      );
    }

    addObj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    addObj(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
    );

    objs.sort((a, b) => a.id - b.id);
    const enc = new TextEncoder();
    const headerBytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a
    ]);
    const chunks = [headerBytes];
    let offset = headerBytes.length;
    const xref = [0];

    for (const o of objs) {
      xref[o.id] = offset;
      const head = enc.encode(`${o.id} 0 obj\n${o.dictStr}\n`);
      chunks.push(head);
      offset += head.length;
      if (o.streamBytes) {
        const sHead = enc.encode('stream\n');
        const sTail = enc.encode('\nendstream\n');
        chunks.push(sHead, o.streamBytes, sTail);
        offset += sHead.length + o.streamBytes.length + sTail.length;
      }
      const foot = enc.encode('endobj\n');
      chunks.push(foot);
      offset += foot.length;
    }

    const xrefOff = offset;
    let xrefStr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) {
      xrefStr += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
    }
    xrefStr += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;
    const tailBytes = enc.encode(xrefStr);
    chunks.push(tailBytes);
    offset += tailBytes.length;

    const finalPdf = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) {
      finalPdf.set(c, pos);
      pos += c.length;
    }
    return finalPdf;
  }

  // --- 將區塊結構化欄位組合成乾淨完整的報讀與顯示文字 ---
  function formatBlockLines(block) {
    const lines = [];
    if (block.type === 'section') {
      const secText = [block.sectionNumber, block.sectionTitle || block.stemText || block.text]
        .filter(Boolean)
        .join('：')
        .replace(/：：+/g, '：');
      lines.push({ text: secText || block.text || '', role: 'section' });
      return lines;
    }

    // 主題號與題幹
    let stemLine = '';
    if (block.questionNumber && !String(block.stemText || '').startsWith(block.questionNumber)) {
      stemLine = `${block.questionNumber} ${block.stemText || block.text || ''}`.trim();
    } else {
      stemLine = String(block.stemText || block.text || '').trim();
    }
    if (stemLine) {
      lines.push({ text: stemLine, role: 'stem' });
    }

    // 注音內容
    if (block.zhuyinText && block.zhuyinText.trim()) {
      const zy = block.zhuyinText.trim();
      if (!stemLine.includes(zy)) {
        lines.push({ text: `【注音】${zy}`, role: 'zhuyin' });
      }
    }

    // 數學算式
    if (block.mathFormula && block.mathFormula.trim()) {
      const mf = block.mathFormula.trim();
      if (!stemLine.includes(mf)) {
        lines.push({ text: `【算式】${mf}`, role: 'math' });
      }
    }

    // 選項陣列
    if (Array.isArray(block.options) && block.options.length > 0) {
      for (const opt of block.options) {
        if (opt && String(opt).trim()) {
          lines.push({ text: String(opt).trim(), role: 'option' });
        }
      }
    }

    return lines;
  }

  /**
   * 模式 A：原稿保留 PDF（保留紙本考卷圖片＋對應位置加入可搜尋選取文字層）
   */
  async function generateModeAPdf(fontUint8, pagesData, options = {}) {
    const font = parseTtf(fontUint8);
    const usedGids = new Set([0]);
    const gidToCp = new Map();
    const visibleOverlay = !!options.visibleOverlay; // false = 3 Tr 隱形可選取文字層, true = 微透明對照文字層

    const pagesSpec = [];
    for (let pIdx = 0; pIdx < pagesData.length; pIdx++) {
      const page = pagesData[pIdx];
      const imgW = page.width || 1200;
      const imgH = page.height || 1600;
      const widthPt = 595.28;
      const heightPt = Math.round((imgH / imgW) * widthPt * 100) / 100;
      const scaleX = widthPt / imgW;
      const scaleY = heightPt / imgH;

      const images = [];
      const cmds = [];

      if (page.imageJpegDataUrl) {
        const jpegBytes = dataUrlToUint8(page.imageJpegDataUrl);
        if (jpegBytes && jpegBytes.length > 0) {
          const dims = getJpegDimensions(jpegBytes);
          images.push({
            name: 'ImBg',
            bytes: jpegBytes,
            pixelW: dims.width || imgW,
            pixelH: dims.height || imgH
          });
          cmds.push(`q ${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm /ImBg Do Q`);
        }
      }

      // 依教師校正後之閱讀順序排列區塊
      const sortedBlocks = [...(page.blocks || [])].sort(
        (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
      );

      for (const blk of sortedBlocks) {
        const bx = (blk.x || 0) * scaleX;
        const byTop = (blk.y || 0) * scaleY;
        const bw = Math.max(24, (blk.w || 100) * scaleX);
        const bh = Math.max(16, (blk.h || 40) * scaleY);

        const structLines = formatBlockLines(blk);
        // 若是表格，也將表格各列加入文字層
        if (blk.type === 'table' && Array.isArray(blk.tableRows) && blk.tableRows.length) {
          for (const row of blk.tableRows) {
            const rowStr = Array.isArray(row) ? row.join(' ｜ ') : String(row);
            if (rowStr.trim()) structLines.push({ text: rowStr.trim(), role: 'table' });
          }
        }
        if (!structLines.length) continue;

        const lineCount = structLines.length;
        const lineHeightPt = Math.min(18, Math.max(9, bh / Math.max(1, lineCount)));
        const fontSize = Math.min(14, Math.max(8, lineHeightPt * 0.82));

        cmds.push('q');
        if (visibleOverlay) {
          cmds.push('/GS2 gs 0.85 0.15 0.15 rg');
        } else {
          cmds.push('/GS1 gs');
        }
        cmds.push('BT');
        if (!visibleOverlay) {
          cmds.push('3 Tr'); // 標準隱形可選取搜尋文字層
        } else {
          cmds.push('0 Tr');
        }

        for (let idx = 0; idx < structLines.length; idx++) {
          const lineText = structLines[idx].text;
          if (!lineText) continue;
          const pdfY = Math.max(
            12,
            heightPt - byTop - (idx + 0.85) * (bh / Math.max(1, lineCount))
          );
          const availW = Math.max(40, Math.min(bw, widthPt - bx - 8));
          const fittedFontSize = Math.max(
            5.5,
            Math.min(fontSize, (availW * 0.95) / Math.max(1, lineText.length))
          );
          const hex = encodeTextToHexGids(lineText, font, usedGids, gidToCp);
          cmds.push(`/F1 ${fittedFontSize.toFixed(1)} Tf 1 0 0 1 ${bx.toFixed(2)} ${pdfY.toFixed(2)} Tm ${hex} Tj`);
        }
        cmds.push('ET');
        cmds.push('Q');
      }

      pagesSpec.push({ widthPt, heightPt, images, streamCommands: cmds });
    }

    const subTtfBytes = subsetTtf(font, usedGids);
    const compressedFont = await deflateBytes(subTtfBytes);
    return assemblePdfDocument(pagesSpec, font, usedGids, gidToCp, subTtfBytes, compressedFont);
  }

  /**
   * 模式 B：重新排版文字型 PDF（優先驗收模式：A4 直式、真正文字物件、嵌入繁體中文字型、正確閱讀順序、保留插圖與表格）
   */
  async function generateModeBPdf(fontUint8, pagesData, options = {}) {
    const font = parseTtf(fontUint8);
    const usedGids = new Set([0]);
    const gidToCp = new Map();

    const widthPt = 595.28; // A4 Portrait Width
    const heightPt = 841.89; // A4 Portrait Height
    const marginX = 46;
    const marginTop = 52;
    const marginBottom = 52;
    const contentWidthPt = widthPt - marginX * 2;

    const baseFontSize = Number(options.fontSize) || 16;
    const lineGapRatio = Number(options.lineSpacing) || 1.65;
    const examTitle = options.examTitle || '智慧考卷 OCR 掃描器 — 國小資源班重排文字型考卷';

    const pagesSpec = [];
    let curPage = null;
    let curY = 0;
    let imgCounter = 1;

    function startNewA4Page(pageNumberLabel) {
      curPage = {
        widthPt,
        heightPt,
        images: [],
        streamCommands: []
      };
      pagesSpec.push(curPage);
      curY = heightPt - marginTop;

      // 頂部標題裝飾條
      curPage.streamCommands.push('q 0.06 0.46 0.43 RG 1.5 w');
      curPage.streamCommands.push(`${marginX} ${(curY - 22).toFixed(2)} m ${(widthPt - marginX).toFixed(2)} ${(curY - 22).toFixed(2)} l S Q`);

      const headerHex = encodeTextToHexGids(pageNumberLabel || examTitle, font, usedGids, gidToCp);
      curPage.streamCommands.push('BT');
      curPage.streamCommands.push('0.06 0.25 0.35 rg');
      curPage.streamCommands.push(`/F1 ${(baseFontSize + 2).toFixed(1)} Tf 1 0 0 1 ${marginX} ${(curY - 14).toFixed(2)} Tm ${headerHex} Tj`);
      curPage.streamCommands.push('ET');
      curY -= 42;
    }

    function ensureSpace(needPt) {
      if (!curPage || curY - needPt < marginBottom) {
        startNewA4Page(pagesSpec.length === 0 ? examTitle : `${examTitle}（續頁）`);
      }
    }

    startNewA4Page(examTitle);

    for (let pIdx = 0; pIdx < pagesData.length; pIdx++) {
      const page = pagesData[pIdx];
      const sortedBlocks = [...(page.blocks || [])].sort(
        (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
      );

      for (const blk of sortedBlocks) {
        const isSection = blk.type === 'section';
        const fontSize = isSection ? baseFontSize + 2 : baseFontSize;
        const lineHeight = fontSize * lineGapRatio;

        // 1. 處理大題標題或一般題目文字行（預先計算整題高度，避免同一題的題幹與選項被跨頁拆開）
        const structLines = formatBlockLines(blk);
        const preparedLines = [];
        for (const item of structLines) {
          const indent = item.role === 'option' ? 18 : item.role === 'zhuyin' || item.role === 'math' ? 10 : 0;
          const wrapped = wrapTextByWidth(item.text, contentWidthPt - indent, fontSize, font);
          for (const wLine of wrapped) {
            preparedLines.push({ wLine, indent, role: item.role });
          }
        }
        const totalBlockHeight = preparedLines.length * lineHeight + 12;
        if (totalBlockHeight < heightPt - marginTop - marginBottom - 60) {
          ensureSpace(totalBlockHeight);
        }

        for (const pItem of preparedLines) {
          const { wLine, indent } = pItem;
          ensureSpace(lineHeight + 6);
          if (isSection) {
            // 大題淡底色背景框
            curPage.streamCommands.push(
              `q 0.93 0.96 0.99 rg ${marginX - 4} ${(curY - lineHeight + 6).toFixed(2)} ${(contentWidthPt + 8).toFixed(2)} ${(lineHeight + 4).toFixed(2)} re f Q`
            );
          }
          const hex = encodeTextToHexGids(wLine, font, usedGids, gidToCp);
          curPage.streamCommands.push('BT');
          if (isSection) {
            curPage.streamCommands.push('0.08 0.24 0.48 rg');
          } else if (pItem.role === 'zhuyin') {
            curPage.streamCommands.push('0.05 0.45 0.42 rg');
          } else if (pItem.role === 'math') {
            curPage.streamCommands.push('0.55 0.28 0.04 rg');
          } else {
            curPage.streamCommands.push('0.08 0.10 0.14 rg');
          }
          curPage.streamCommands.push(
            `/F1 ${fontSize.toFixed(1)} Tf 1 0 0 1 ${(marginX + indent).toFixed(2)} ${(curY - fontSize).toFixed(2)} Tm ${hex} Tj`
          );
          curPage.streamCommands.push('ET');
          curY -= lineHeight;
        }

        // 2. 處理表格區塊 (繪製真正向量格線 + 格內可選取文字)
        if (blk.type === 'table' && Array.isArray(blk.tableRows) && blk.tableRows.length > 0) {
          const rows = blk.tableRows;
          const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 1)));
          const colW = contentWidthPt / colCount;
          const cellFontSize = Math.max(12, baseFontSize - 2);
          const rowH = cellFontSize * 1.9;
          ensureSpace(rows.length * rowH + 16);

          for (let rIdx = 0; rIdx < rows.length; rIdx++) {
            const row = Array.isArray(rows[rIdx]) ? rows[rIdx] : [String(rows[rIdx])];
            const topY = curY;
            const botY = curY - rowH;
            if (rIdx === 0) {
              curPage.streamCommands.push(
                `q 0.94 0.97 0.96 rg ${marginX} ${botY.toFixed(2)} ${contentWidthPt.toFixed(2)} ${rowH.toFixed(2)} re f Q`
              );
            }
            for (let cIdx = 0; cIdx < colCount; cIdx++) {
              const cx = marginX + cIdx * colW;
              curPage.streamCommands.push(
                `q 0.45 0.52 0.60 RG 0.8 w ${cx.toFixed(2)} ${botY.toFixed(2)} ${colW.toFixed(2)} ${rowH.toFixed(2)} re S Q`
              );
              const cellText = String(row[cIdx] || '').trim();
              if (cellText) {
                const hex = encodeTextToHexGids(cellText, font, usedGids, gidToCp);
                curPage.streamCommands.push('BT 0.08 0.10 0.14 rg');
                curPage.streamCommands.push(
                  `/F1 ${cellFontSize.toFixed(1)} Tf 1 0 0 1 ${(cx + 8).toFixed(2)} ${(botY + (rowH - cellFontSize) * 0.45).toFixed(2)} Tm ${hex} Tj`
                );
                curPage.streamCommands.push('ET');
              }
            }
            curY -= rowH;
          }
          curY -= 8;
        }

        // 3. 處理相關插圖保留 (嵌入裁切後插圖 JPEG XObject)
        if ((blk.type === 'illustration' || blk.keepIllustration) && blk.cropJpegDataUrl) {
          const jpegBytes = dataUrlToUint8(blk.cropJpegDataUrl);
          if (jpegBytes && jpegBytes.length > 0) {
            const dims = getJpegDimensions(jpegBytes);
            const maxImgW = Math.min(260, contentWidthPt * 0.65);
            const maxImgH = 140;
            const ratio = Math.min(maxImgW / (dims.width || 200), maxImgH / (dims.height || 120));
            const drawW = Math.max(40, (dims.width || 200) * ratio);
            const drawH = Math.max(30, (dims.height || 120) * ratio);
            ensureSpace(drawH + 16);
            const imgName = `ImCrop${imgCounter++}`;
            curPage.images.push({
              name: imgName,
              bytes: jpegBytes,
              pixelW: dims.width || 200,
              pixelH: dims.height || 120
            });
            const drawY = curY - drawH - 4;
            curPage.streamCommands.push(
              `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${(marginX + 12).toFixed(2)} ${drawY.toFixed(2)} cm /${imgName} Do Q`
            );
            curY = drawY - 10;
          }
        }

        curY -= isSection ? 6 : 8;
      }
    }

    // 為每一頁加上頁尾頁碼
    const totalPages = pagesSpec.length;
    pagesSpec.forEach((p, idx) => {
      const footerText = `第 ${idx + 1} 頁 ／ 共 ${totalPages} 頁`;
      const fHex = encodeTextToHexGids(footerText, font, usedGids, gidToCp);
      p.streamCommands.push('BT 0.45 0.50 0.56 rg');
      p.streamCommands.push(`/F1 10.5 Tf 1 0 0 1 ${(widthPt / 2 - 42).toFixed(2)} 24 Tm ${fHex} Tj`);
      p.streamCommands.push('ET');
    });

    const subTtfBytes = subsetTtf(font, usedGids);
    const compressedFont = await deflateBytes(subTtfBytes);
    return assemblePdfDocument(pagesSpec, font, usedGids, gidToCp, subTtfBytes, compressedFont);
  }

  /**
   * 產生符合「第八節：支援國小特殊教育報讀」之結構化 JSON
   * 明確區分大題編號、大題名稱、小題編號、題幹文字、選項文字、注音內容、數學算式、相關插圖與閱讀順序
   */
  function generateStructuredJson(pagesData, meta = {}) {
    const allItems = [];
    let globalOrder = 1;
    let currentSecNum = '第一大題';
    let currentSecTitle = '綜合測驗';

    pagesData.forEach((page, pageIndex) => {
      const sortedBlocks = [...(page.blocks || [])].sort(
        (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
      );
      for (const blk of sortedBlocks) {
        if (blk.type === 'section') {
          if (blk.sectionNumber) currentSecNum = blk.sectionNumber;
          if (blk.sectionTitle || blk.stemText || blk.text) {
            currentSecTitle = blk.sectionTitle || blk.stemText || blk.text;
          }
        }
        allItems.push({
          readingOrder: globalOrder++,
          pageNumber: pageIndex + 1,
          pageBlockOrder: blk.readingOrder || 1,
          blockId: blk.id,
          blockType: blk.type || 'question',
          sectionNumber: blk.sectionNumber || currentSecNum,
          sectionTitle: blk.sectionTitle || currentSecTitle,
          questionNumber: blk.questionNumber || '',
          stemText: blk.stemText || blk.text || '',
          options: Array.isArray(blk.options) ? blk.options : [],
          zhuyinContent: blk.zhuyinText || '',
          mathFormula: blk.mathFormula || '',
          tableRows: Array.isArray(blk.tableRows) ? blk.tableRows : [],
          hasIllustration: !!(blk.type === 'illustration' || blk.keepIllustration),
          illustrationDataUrl:
            blk.type === 'illustration' || blk.keepIllustration ? blk.cropJpegDataUrl || null : null,
          confidence: typeof blk.confidence === 'number' ? blk.confidence : 95,
          needsManualReview: !!blk.lowConfidence,
          bbox: {
            x: Math.round(blk.x || 0),
            y: Math.round(blk.y || 0),
            width: Math.round(blk.w || 0),
            height: Math.round(blk.h || 0)
          },
          fullSpeechText: formatBlockLines(blk)
            .map((l) => l.text)
            .join(' ')
        });
      }
    });

    return {
      schemaVersion: '2.0-sped-exam-reader',
      title: meta.examTitle || '國小資源班智慧考卷辨識結果',
      exportedAt: new Date().toISOString(),
      totalPages: pagesData.length,
      totalBlocks: allItems.length,
      compatibleSystems: ['Claude 特教報讀網站', '評量報讀小幫手 (exam-reader-helper)', '通用 TTS 報讀器'],
      items: allItems
    };
  }

  /**
   * 產生純文字報讀檔 (TXT)
   */
  function generateStructuredTxt(pagesData, meta = {}) {
    const out = [];
    out.push(`================================================`);
    out.push(`考卷名稱：${meta.examTitle || '國小資源班智慧考卷辨識結果'}`);
    out.push(`匯出時間：${new Date().toLocaleString('zh-TW')}`);
    out.push(`================================================\n`);

    pagesData.forEach((page, pIdx) => {
      if (pagesData.length > 1) {
        out.push(`--- 第 ${pIdx + 1} 頁 ---\n`);
      }
      const sortedBlocks = [...(page.blocks || [])].sort(
        (a, b) => (a.readingOrder || 0) - (b.readingOrder || 0)
      );
      for (const blk of sortedBlocks) {
        const lines = formatBlockLines(blk);
        for (const l of lines) {
          out.push(l.text);
        }
        if (blk.type === 'table' && Array.isArray(blk.tableRows)) {
          for (const r of blk.tableRows) {
            out.push(Array.isArray(r) ? r.join('\t') : String(r));
          }
        }
        out.push('');
      }
    });

    return out.join('\n');
  }

  return {
    parseTtf,
    subsetTtf,
    generateModeAPdf,
    generateModeBPdf,
    generateStructuredJson,
    generateStructuredTxt,
    formatBlockLines
  };
});
