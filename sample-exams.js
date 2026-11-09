/**
 * 智慧考卷 OCR 掃描器 — 內建國小考卷測試範本庫與高解析度模擬考卷繪製器 (sample-exams.js)
 * 涵蓋指令要求之全部 13 項測試情境與最核心驗收情境
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartExamSamples = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SAMPLE_EXAMS = {
    acceptance_mixed: {
      id: 'acceptance_mixed',
      badge: '🎯 核心驗收情境',
      name: '國小國語混合排版考卷（左欄第一大題・右欄第二大題・下方第三大題）',
      desc: '完全對應驗收標準：上半部左右雙欄（左欄第一大題、右欄第二大題），下半部水平分隔線下為第三大題（含注音、算式與插圖）。',
      width: 1200,
      height: 1660,
      dividers: {
        hLines: [{ id: 'hl_init_1', y: 1030, x1: 45, x2: 1155, auto: true }],
        vLines: [{ id: 'vl_init_1', x: 600, y1: 130, y2: 1025, auto: true }]
      },
      blocks: [
        // 左欄：第一大題
        {
          id: 'blk_m_1',
          x: 60,
          y: 150,
          w: 515,
          h: 58,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '國字注音與選擇題（每題 10 分）',
          questionNumber: '',
          stemText: '第一大題：國字注音與選擇題（每題 10 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_m_2',
          x: 60,
          y: 230,
          w: 515,
          h: 225,
          type: 'zhuyin',
          sectionNumber: '第一大題',
          sectionTitle: '國字注音與選擇題',
          questionNumber: '第 1 題',
          stemText: '小明今天帶什麼去學校？（ㄕㄨ ㄅㄠ）',
          options: ['A. 雨傘', 'B. 書包', 'C. 玩具', 'D. 球鞋'],
          zhuyinText: 'ㄕㄨ ㄅㄠ',
          mathFormula: '',
          confidence: 97,
          readingOrder: 2
        },
        {
          id: 'blk_m_3',
          x: 60,
          y: 480,
          w: 515,
          h: 225,
          type: 'zhuyin',
          sectionNumber: '第一大題',
          sectionTitle: '國字注音與選擇題',
          questionNumber: '第 2 題',
          stemText: '妹妹最喜歡在公園裡做什麼運動？（ㄆㄠˇ ㄅㄨˋ）',
          options: ['A. 睡覺', 'B. 跑步', 'C. 寫字', 'D. 畫圖'],
          zhuyinText: 'ㄆㄠˇ ㄅㄨˋ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 3
        },
        {
          id: 'blk_m_4',
          x: 60,
          y: 730,
          w: 515,
          h: 245,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '國字注音與選擇題',
          questionNumber: '第 3 題',
          stemText: '春天來了，花園裡開滿五顏六色的花朵（ㄏㄨㄚ ㄉㄨㄛˇ），請問這是哪一個季節？',
          options: ['A. 冬天', 'B. 夏天', 'C. 春天', 'D. 秋天'],
          zhuyinText: 'ㄏㄨㄚ ㄉㄨㄛˇ',
          mathFormula: '',
          confidence: 74,
          lowConfidence: true,
          previousOcrText: '第 3 題：春天來了，花園裡開滿五顏六色的花朶（ㄏㄨㄚ ㄉㄨㄛˇ），請問這是哪一個季節？',
          readingOrder: 4
        },
        // 右欄：第二大題
        {
          id: 'blk_m_5',
          x: 625,
          y: 150,
          w: 515,
          h: 58,
          type: 'section',
          sectionNumber: '第二大題',
          sectionTitle: '語詞選填與是非題（每題 10 分）',
          questionNumber: '',
          stemText: '第二大題：語詞選填與是非題（每題 10 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 98,
          readingOrder: 5
        },
        {
          id: 'blk_m_6',
          x: 625,
          y: 230,
          w: 515,
          h: 225,
          type: 'zhuyin',
          sectionNumber: '第二大題',
          sectionTitle: '語詞選填與是非題',
          questionNumber: '第 4 題',
          stemText: '（　）奶奶會在過年時滷（ㄌㄨˇ）臘肉分送給親朋好友。',
          options: ['A. ○ 正確', 'B. ✕ 錯誤'],
          zhuyinText: 'ㄌㄨˇ',
          mathFormula: '',
          confidence: 95,
          readingOrder: 6
        },
        {
          id: 'blk_m_7',
          x: 625,
          y: 480,
          w: 515,
          h: 225,
          type: 'zhuyin',
          sectionNumber: '第二大題',
          sectionTitle: '語詞選填與是非題',
          questionNumber: '第 5 題',
          stemText: '（　）下大雨前，我們應該未雨綢繆（ㄔㄡˊ ㄇㄡˊ），提早收好衣服。',
          options: ['A. ○ 正確', 'B. ✕ 錯誤'],
          zhuyinText: 'ㄔㄡˊ ㄇㄡˊ',
          mathFormula: '',
          confidence: 94,
          readingOrder: 7
        },
        {
          id: 'blk_m_8',
          x: 625,
          y: 730,
          w: 515,
          h: 245,
          type: 'question',
          sectionNumber: '第二大題',
          sectionTitle: '語詞選填與是非題',
          questionNumber: '第 6 題',
          stemText: '農夫每天在田裡辛勤耕耘（ㄍㄥ ㄩㄣˊ），最後終於獲得豐收。請問「耕耘」的意思是什麼？',
          options: ['A. 努力工作與付出', 'B. 在樹下休息', 'C. 到海邊玩水', 'D. 買新衣服'],
          zhuyinText: 'ㄍㄥ ㄩㄣˊ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 8
        },
        // 下方跨欄區：第三大題
        {
          id: 'blk_m_9',
          x: 60,
          y: 1060,
          w: 1080,
          h: 58,
          type: 'section',
          sectionNumber: '第三大題',
          sectionTitle: '看圖閱讀理解與生活應用題（每題 20 分）',
          questionNumber: '',
          stemText: '第三大題：看圖閱讀理解與生活應用題（每題 20 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 9
        },
        {
          id: 'blk_m_10',
          x: 60,
          y: 1140,
          w: 690,
          h: 210,
          type: 'math',
          sectionNumber: '第三大題',
          sectionTitle: '看圖閱讀理解與生活應用題',
          questionNumber: '第 7 題',
          stemText: '請看右方文具插圖：小華原本有 8 枝鉛筆，媽媽又買了 4 枝鉛筆放進書包，現在共有幾枝鉛筆？',
          options: ['A. 10 枝', 'B. 12 枝', 'C. 14 枝', 'D. 16 枝'],
          zhuyinText: 'ㄑㄧㄢ ㄅㄧˇ',
          mathFormula: '8 ＋ 4 ＝ 12',
          confidence: 97,
          readingOrder: 10
        },
        {
          id: 'blk_m_11',
          x: 775,
          y: 1140,
          w: 365,
          h: 210,
          type: 'illustration',
          sectionNumber: '第三大題',
          sectionTitle: '看圖閱讀理解與生活應用題',
          questionNumber: '第 7 題附圖',
          stemText: '【插圖】書包與文具數量圖示（8 枝鉛筆 ＋ 4 枝鉛筆）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          keepIllustration: true,
          confidence: 99,
          readingOrder: 11
        },
        {
          id: 'blk_m_12',
          x: 60,
          y: 1375,
          w: 1080,
          h: 210,
          type: 'question',
          sectionNumber: '第三大題',
          sectionTitle: '看圖閱讀理解與生活應用題',
          questionNumber: '第 8 題',
          stemText: '承上題，如果小華把 12 枝鉛筆平分裝進 3 個筆袋裡，每個筆袋可以裝幾枝鉛筆？',
          options: ['A. 2 枝', 'B. 3 枝', 'C. 4 枝', 'D. 6 枝'],
          zhuyinText: 'ㄅㄧˇ ㄉㄞˋ',
          mathFormula: '12 ÷ 3 ＝ 4',
          confidence: 98,
          readingOrder: 12
        }
      ]
    },

    single_col: {
      id: 'single_col',
      badge: '📄 測試 1：單欄考卷',
      name: '單欄標準考卷（國小三年級自然科平時測驗）',
      desc: '測試單欄由上而下標準排版之大題、題幹與選項辨識。',
      width: 1200,
      height: 1600,
      dividers: { hLines: [], vLines: [] },
      blocks: [
        {
          id: 'blk_s_1',
          x: 70,
          y: 150,
          w: 1060,
          h: 60,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '自然觀察選擇題（每題 25 分）',
          questionNumber: '',
          stemText: '第一大題：自然觀察選擇題（每題 25 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_s_2',
          x: 70,
          y: 240,
          w: 1060,
          h: 250,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '自然觀察選擇題',
          questionNumber: '第 1 題',
          stemText: '植物行光合作用時，最需要下列哪一種自然資源才能製造養分？',
          options: ['A. 陽光與水分', 'B. 塑膠袋', 'C. 鐵釘', 'D. 玻璃珠'],
          zhuyinText: 'ㄍㄨㄤ ㄏㄜˊ ㄗㄨㄛˋ ㄩㄥˋ',
          mathFormula: '',
          confidence: 98,
          readingOrder: 2
        },
        {
          id: 'blk_s_3',
          x: 70,
          y: 520,
          w: 1060,
          h: 250,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '自然觀察選擇題',
          questionNumber: '第 2 題',
          stemText: '把冰塊放在太陽下照射十分鐘後，冰塊會發生什麼變化？',
          options: ['A. 變成石頭', 'B. 融化成液態水', 'C. 變成木頭', 'D. 體積變大十倍'],
          zhuyinText: 'ㄖㄨㄥˊ ㄏㄨㄚˋ',
          mathFormula: '',
          confidence: 97,
          readingOrder: 3
        },
        {
          id: 'blk_s_4',
          x: 70,
          y: 800,
          w: 1060,
          h: 250,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '自然觀察選擇題',
          questionNumber: '第 3 題',
          stemText: '毛毛蟲長大結蛹（ㄩㄥˇ）之後，最後會羽化成什麼昆蟲？',
          options: ['A. 蝴蝶', 'B. 青蛙', 'C. 麻雀', 'D. 金魚'],
          zhuyinText: 'ㄩㄥˇ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 4
        }
      ]
    },

    two_col: {
      id: 'two_col',
      badge: '◫ 測試 2：左右雙欄',
      name: '左右雙欄考卷（左欄第 1~3 題・右欄第 6~8 題）',
      desc: '完全對應指令第三節 A 表：自動找出左右欄分界，先辨識左欄第 1~3 題，再辨識右欄第 6~8 題，絕不跨欄混合。',
      width: 1200,
      height: 1600,
      dividers: {
        hLines: [],
        vLines: [{ id: 'vl_twocol_1', x: 600, y1: 130, y2: 1480, auto: true }]
      },
      blocks: [
        {
          id: 'blk_tc_1',
          x: 60,
          y: 160,
          w: 515,
          h: 60,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '基礎語文測驗（左欄）',
          questionNumber: '',
          stemText: '第一大題：基礎語文測驗',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_tc_2',
          x: 60,
          y: 250,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '基礎語文測驗',
          questionNumber: '第 1 題',
          stemText: '早晨起床後，我們應該先做什麼事來保持牙齒健康？',
          options: ['A. 刷牙洗臉', 'B. 吃糖果', 'C. 看電視', 'D. 打電動'],
          zhuyinText: 'ㄕㄨㄚ ㄧㄚˊ',
          mathFormula: '',
          confidence: 98,
          readingOrder: 2
        },
        {
          id: 'blk_tc_3',
          x: 60,
          y: 540,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '基礎語文測驗',
          questionNumber: '第 2 題',
          stemText: '過馬路時看到紅綠燈亮起「紅燈」，行人應該怎麼做？',
          options: ['A. 加速跑過去', 'B. 停在斑馬線前等待', 'C. 閉上眼睛走', 'D. 倒退走路'],
          zhuyinText: 'ㄏㄨㄥˊ ㄉㄥ',
          mathFormula: '',
          confidence: 97,
          readingOrder: 3
        },
        {
          id: 'blk_tc_4',
          x: 60,
          y: 830,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '基礎語文測驗',
          questionNumber: '第 3 題',
          stemText: '在圖書館看書時，下列哪一種行為最有禮貌？',
          options: ['A. 大聲喧嘩', 'B. 保持安靜輕聲細語', 'C. 邊跑邊丟書', 'D. 在書上亂畫'],
          zhuyinText: 'ㄢ ㄐㄧㄥˋ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 4
        },
        {
          id: 'blk_tc_5',
          x: 625,
          y: 160,
          w: 515,
          h: 60,
          type: 'section',
          sectionNumber: '第二大題',
          sectionTitle: '閱讀進階測驗（右欄）',
          questionNumber: '',
          stemText: '第二大題：閱讀進階測驗',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 5
        },
        {
          id: 'blk_tc_6',
          x: 625,
          y: 250,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第二大題',
          sectionTitle: '閱讀進階測驗',
          questionNumber: '第 6 題',
          stemText: '當同學忘記帶橡皮擦（ㄒㄧㄤˋ ㄆㄧˊ ㄘㄚ）時，我們可以怎麼幫助他？',
          options: ['A. 借給他使用', 'B. 嘲笑他', 'C. 把他的筆藏起來', 'D. 不理他'],
          zhuyinText: 'ㄒㄧㄤˋ ㄆㄧˊ ㄘㄚ',
          mathFormula: '',
          confidence: 97,
          readingOrder: 6
        },
        {
          id: 'blk_tc_7',
          x: 625,
          y: 540,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第二大題',
          sectionTitle: '閱讀進階測驗',
          questionNumber: '第 7 題',
          stemText: '台灣四面環海，請問台灣本島東邊緊鄰哪一個海洋？',
          options: ['A. 太平洋', 'B. 大西洋', 'C. 印度洋', 'D. 北極海'],
          zhuyinText: 'ㄊㄞˋ ㄆㄧㄥˊ ㄧㄤˊ',
          mathFormula: '',
          confidence: 95,
          readingOrder: 7
        },
        {
          id: 'blk_tc_8',
          x: 625,
          y: 830,
          w: 515,
          h: 260,
          type: 'question',
          sectionNumber: '第二大題',
          sectionTitle: '閱讀進階測驗',
          questionNumber: '第 8 題',
          stemText: '「團結力量大」這句話告訴我們什麼道理？',
          options: ['A. 大家分工合作能完成大事', 'B. 自己一個人最好', 'C. 不用跟別人溝通', 'D. 凡事都靠運氣'],
          zhuyinText: 'ㄊㄨㄢˊ ㄐㄧㄝˊ',
          mathFormula: '',
          confidence: 98,
          readingOrder: 8
        }
      ]
    },

    top_bottom: {
      id: 'top_bottom',
      badge: '⊟ 測試 3：上下分區',
      name: '上下分區考卷（上半部第一大題・水平線・下半部第二大題）',
      desc: '測試水平分隔線偵測與上下分區獨立辨識，避免把不同大題的文字接在一起。',
      width: 1200,
      height: 1600,
      dividers: {
        hLines: [{ id: 'hl_tb_1', y: 820, x1: 50, x2: 1150, auto: true }],
        vLines: []
      },
      blocks: [
        {
          id: 'blk_tb_1',
          x: 70,
          y: 150,
          w: 1060,
          h: 60,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '是非題（上半部區域）',
          questionNumber: '',
          stemText: '第一大題：是非題（每題 20 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_tb_2',
          x: 70,
          y: 240,
          w: 1060,
          h: 230,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '是非題',
          questionNumber: '第 1 題',
          stemText: '（　）使用電腦或平板學習時，每 30 分鐘應該讓眼睛休息 10 分鐘。',
          options: ['A. ○ 正確', 'B. ✕ 錯誤'],
          zhuyinText: 'ㄧㄢˇ ㄐㄧㄥ',
          mathFormula: '',
          confidence: 98,
          readingOrder: 2
        },
        {
          id: 'blk_tb_3',
          x: 70,
          y: 500,
          w: 1060,
          h: 230,
          type: 'question',
          sectionNumber: '第一大題',
          sectionTitle: '是非題',
          questionNumber: '第 2 題',
          stemText: '（　）地震發生時，應該立刻記住「趴下、掩護、穩住」三個保護動作。',
          options: ['A. ○ 正確', 'B. ✕ 錯誤'],
          zhuyinText: 'ㄧㄢˇ ㄏㄨˋ',
          mathFormula: '',
          confidence: 97,
          readingOrder: 3
        },
        {
          id: 'blk_tb_4',
          x: 70,
          y: 860,
          w: 1060,
          h: 60,
          type: 'section',
          sectionNumber: '第二大題',
          sectionTitle: '選擇題（下半部區域）',
          questionNumber: '',
          stemText: '第二大題：選擇題（每題 30 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 4
        },
        {
          id: 'blk_tb_5',
          x: 70,
          y: 950,
          w: 1060,
          h: 260,
          type: 'question',
          sectionNumber: '第二大題',
          sectionTitle: '選擇題',
          questionNumber: '第 3 題',
          stemText: '遇到火災濃煙時，下列哪一種逃生方式最安全？',
          options: ['A. 搭乘電梯', 'B. 壓低身體沿牆壁走安全梯', 'C. 躲在衣櫃裡睡覺', 'D. 打開所有窗戶跳樓'],
          zhuyinText: 'ㄊㄠˊ ㄕㄥ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 5
        }
      ]
    },

    zhuyin_special: {
      id: 'zhuyin_special',
      badge: 'ㄅㄆ 測試 5：國語注音',
      name: '具有細小注音與改錯字的國語考卷（含低信心度標示測試）',
      desc: '測試臺灣繁體中文、細小注音符號及聲調（ˊˇˋ˙），並展示低信心度醒目框線與人工修正錯字流程。',
      width: 1200,
      height: 1600,
      dividers: { hLines: [], vLines: [] },
      blocks: [
        {
          id: 'blk_zy_1',
          x: 70,
          y: 150,
          w: 1060,
          h: 60,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '國字與注音拼讀測驗',
          questionNumber: '',
          stemText: '第一大題：國字與注音拼讀測驗（每題 25 分）',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_zy_2',
          x: 70,
          y: 240,
          w: 1060,
          h: 250,
          type: 'zhuyin',
          sectionNumber: '第一大題',
          sectionTitle: '國字與注音拼讀測驗',
          questionNumber: '第 1 題',
          stemText: '請選出「豐饒」正確的國語注音讀音：',
          options: ['A. ㄈㄥ ㄖㄠˊ', 'B. ㄈㄥ ㄋㄠˊ', 'C. ㄏㄨㄥ ㄖㄠˇ', 'D. ㄈㄥˋ ㄧㄠˊ'],
          zhuyinText: 'ㄈㄥ ㄖㄠˊ',
          mathFormula: '',
          confidence: 96,
          readingOrder: 2
        },
        {
          id: 'blk_zy_3',
          x: 70,
          y: 520,
          w: 1060,
          h: 250,
          type: 'zhuyin',
          sectionNumber: '第一大題',
          sectionTitle: '國字與注音拼讀測驗',
          questionNumber: '第 2 題',
          stemText: '請選出「倘佯（ㄊㄤˇ ㄧㄤˊ）」在句子中的正確用法：',
          options: [
            'A. 我們倘佯在翠綠的草原上欣賞藍天',
            'B. 我把倘佯放進冰箱裡冷凍',
            'C. 這枝倘佯寫起來很順手',
            'D. 媽媽煮了一碗好喝的倘佯'
          ],
          zhuyinText: 'ㄊㄤˇ ㄧㄤˊ',
          mathFormula: '',
          confidence: 71,
          lowConfidence: true,
          previousOcrText: '第 2 題：請選出「倘伴（ㄊㄤˇ ㄧㄤˊ）」在句子中的正確用法：',
          readingOrder: 3
        }
      ]
    },

    math_table: {
      id: 'math_table',
      badge: '➗ 測試 6：數學與表格',
      name: '具有數學算式、直式與統計表格的數學考卷',
      desc: '測試四則運算符號（＋－×÷＝）、直式算式、統計表格與幾何圖形插圖辨識及重排 PDF 輸出。',
      width: 1200,
      height: 1620,
      dividers: { hLines: [], vLines: [] },
      blocks: [
        {
          id: 'blk_mt_1',
          x: 70,
          y: 150,
          w: 1060,
          h: 60,
          type: 'section',
          sectionNumber: '第一大題',
          sectionTitle: '四則運算與直式計算題',
          questionNumber: '',
          stemText: '第一大題：四則運算與直式計算題',
          options: [],
          zhuyinText: '',
          mathFormula: '',
          confidence: 99,
          readingOrder: 1
        },
        {
          id: 'blk_mt_2',
          x: 70,
          y: 235,
          w: 1060,
          h: 230,
          type: 'math',
          sectionNumber: '第一大題',
          sectionTitle: '四則運算與直式計算題',
          questionNumber: '第 1 題',
          stemText: '請計算下列算式的正確答案：125 ＋ 75 × 2 ＝（　）',
          options: ['A. 200', 'B. 275', 'C. 400', 'D. 350'],
          zhuyinText: '',
          mathFormula: '125 ＋ 75 × 2 ＝ 275',
          confidence: 98,
          readingOrder: 2
        },
        {
          id: 'blk_mt_3',
          x: 70,
          y: 490,
          w: 1060,
          h: 230,
          type: 'math',
          sectionNumber: '第一大題',
          sectionTitle: '四則運算與直式計算題',
          questionNumber: '第 2 題',
          stemText: '【直式算式】三年甲班有 248 張貼紙，三年乙班有 165 張貼紙，兩班共有幾張貼紙？',
          options: ['A. 393 張', 'B. 403 張', 'C. 413 張', 'D. 423 張'],
          zhuyinText: '',
          mathFormula: '248 ＋ 165 ＝ 413',
          confidence: 97,
          readingOrder: 3
        },
        {
          id: 'blk_mt_4',
          x: 70,
          y: 750,
          w: 1060,
          h: 310,
          type: 'table',
          sectionNumber: '第二大題',
          sectionTitle: '統計圖表閱讀題',
          questionNumber: '第 3 題',
          stemText: '下表是三年級學生最喜愛的水果人數統計表，請問喜歡「蘋果」和「香蕉」的學生合起來共有幾人？',
          options: ['A. 25 人', 'B. 30 人', 'C. 33 人', 'D. 40 人'],
          zhuyinText: '',
          mathFormula: '18 ＋ 15 ＝ 33',
          tableRows: [
            ['水果項目', '蘋果', '香蕉', '草莓', '西瓜'],
            ['喜愛人數（人）', '18', '15', '12', '9']
          ],
          confidence: 96,
          readingOrder: 4
        }
      ]
    }
  };

  /**
   * 在瀏覽器 Canvas 上繪製逼真的紙本考卷影像（供拍照/範本載入、畫線框選、裁切插圖與 PDF 測試）
   */
  function renderSampleToCanvas(sample, targetCanvas) {
    const canvas = targetCanvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    if (!canvas) return null;
    canvas.width = sample.width || 1200;
    canvas.height = sample.height || 1660;
    const ctx = canvas.getContext('2d');

    // 1. 紙張柔和米白底色與細微紙張邊框
    ctx.fillStyle = '#fcfcfa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    // 2. 考卷頂部校名與標題列
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sample.name.replace(/（.*）/, ''), canvas.width / 2, 82);
    ctx.font = '18px "Microsoft JhengHei", "PingFang TC", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('班級：三年___班　座號：___號　姓名：___________　得分：_______', canvas.width / 2, 116);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(45, 130);
    ctx.lineTo(canvas.width - 45, 130);
    ctx.stroke();

    // 3. 繪製考卷上的分隔線（水平分隔線、垂直分欄線）
    if (sample.dividers) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 3;
      for (const hl of sample.dividers.hLines || []) {
        ctx.beginPath();
        ctx.moveTo(hl.x1 || 45, hl.y);
        ctx.lineTo(hl.x2 || canvas.width - 45, hl.y);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      for (const vl of sample.dividers.vLines || []) {
        ctx.beginPath();
        ctx.moveTo(vl.x, vl.y1 || 135);
        ctx.lineTo(vl.x, vl.y2 || canvas.height - 50);
        ctx.stroke();
      }
    }

    // 4. 繪製每個題目區塊的真實考卷文字、表格與插圖
    ctx.textAlign = 'left';
    for (const blk of sample.blocks || []) {
      const bx = blk.x;
      const by = blk.y;
      const bw = blk.w;
      const bh = blk.h;

      if (blk.type === 'section') {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 23px "Microsoft JhengHei", "PingFang TC", sans-serif';
        ctx.fillText(blk.stemText, bx + 14, by + 37);
        continue;
      }

      if (blk.type === 'illustration') {
        // 繪製精美書包與文具插圖
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);

        // 書包圖示
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(bx + 35, by + 45, 95, 110);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(bx + 48, by + 85, 69, 55);
        ctx.strokeStyle = '#0369a1';
        ctx.lineWidth = 4;
        ctx.strokeRect(bx + 62, by + 26, 40, 20);

        // 鉛筆排排站 (8 + 4)
        for (let i = 0; i < 12; i++) {
          const px = bx + 160 + (i % 6) * 28;
          const py = by + 48 + Math.floor(i / 6) * 72;
          ctx.fillStyle = i < 8 ? '#f59e0b' : '#10b981';
          ctx.fillRect(px, py, 14, 46);
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + 7, py - 12);
          ctx.lineTo(px + 14, py);
          ctx.fill();
        }
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 17px "Microsoft JhengHei", sans-serif';
        ctx.fillText('圖：書包與鉛筆（8枝＋4枝）', bx + 45, by + bh - 16);
        continue;
      }

      // 繪製一般題幹、注音、算式與選項
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 21px "Microsoft JhengHei", "PingFang TC", sans-serif';
      const titlePrefix = blk.questionNumber ? `${blk.questionNumber}：` : '';
      const fullStem = `${titlePrefix}${blk.stemText}`;

      // 自動折行繪製題幹
      const maxCharsPerLine = Math.max(12, Math.floor((bw - 24) / 21));
      let curY = by + 30;
      for (let i = 0; i < fullStem.length; i += maxCharsPerLine) {
        ctx.fillText(fullStem.slice(i, i + maxCharsPerLine), bx + 10, curY);
        curY += 30;
      }

      if (blk.mathFormula) {
        ctx.fillStyle = '#1e3a8a';
        ctx.font = 'bold 20px "Microsoft JhengHei", sans-serif';
        ctx.fillText(`算式：${blk.mathFormula}`, bx + 16, curY + 4);
        curY += 30;
      }

      // 若是表格題，繪製表格
      if (blk.type === 'table' && Array.isArray(blk.tableRows)) {
        const rows = blk.tableRows;
        const cols = rows[0].length;
        const cellW = (bw - 40) / cols;
        const cellH = 38;
        let ty = curY + 2;
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < cols; c++) {
            const cx = bx + 16 + c * cellW;
            ctx.fillStyle = r === 0 ? '#e2e8f0' : '#ffffff';
            ctx.fillRect(cx, ty, cellW, cellH);
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(cx, ty, cellW, cellH);
            ctx.fillStyle = '#0f172a';
            ctx.font = r === 0 ? 'bold 18px "Microsoft JhengHei"' : '18px "Microsoft JhengHei"';
            ctx.fillText(String(rows[r][c]), cx + 12, ty + 25);
          }
          ty += cellH;
        }
        curY = ty + 28;
      }

      // 繪製選項
      if (Array.isArray(blk.options) && blk.options.length) {
        ctx.fillStyle = '#1e293b';
        ctx.font = '20px "Microsoft JhengHei", "PingFang TC", sans-serif';
        const isShort = blk.options.every((o) => o.length <= 10);
        if (isShort && bw > 460) {
          // 兩欄並列選項
          for (let idx = 0; idx < blk.options.length; idx++) {
            const col = idx % 2;
            const row = Math.floor(idx / 2);
            ctx.fillText(blk.options[idx], bx + 20 + col * Math.floor(bw / 2), curY + row * 32);
          }
        } else {
          for (const opt of blk.options) {
            ctx.fillText(opt, bx + 20, curY);
            curY += 29;
          }
        }
      }
    }

    return canvas;
  }

  return {
    SAMPLE_EXAMS,
    renderSampleToCanvas
  };
});
