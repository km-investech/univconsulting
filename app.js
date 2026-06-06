const state = {
  data: null,
  subjectIndex: null,
  input: {},
  schoolInput: {},   // 내신 직접입력: { [code]: number | "" }
  initialized: false,
  track: "science",
  query: "",
  status: "",
  round: "",
  province: "",
  sortBy: "status",
};

const APP_PASSWORD = "0428";
const statusRank = {
  "적정점수 이상": 1,
  "예상점수 이상": 2,
  "소신점수 이상": 3,
  "소신점수 미만": 4,
};

const $ = (id) => document.getElementById(id);
const inputIds = [
  "koreanSubject",
  "koreanScore",
  "mathSubject",
  "mathScore",
  "englishGrade",
  "historyGrade",
  "inquirySubject1",
  "inquiryScore1",
  "inquirySubject2",
  "inquiryScore2",
];

function text(value, fallback = "-") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function numberText(value, digits = 2) {
  if (value === "" || value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  return Number.isInteger(number) ? number.toLocaleString("ko-KR") : number.toFixed(digits);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function statusClass(status) {
  if (status.includes("적정")) return "good";
  if (status.includes("예상")) return "ok";
  if (status.includes("소신점수 이상")) return "watch";
  if (status.includes("미만")) return "bad";
  return "neutral";
}

function makeSubjectIndex(lookup) {
  const bySubject = {};
  Object.values(lookup).forEach((entry) => {
    bySubject[entry.subject] ||= [];
    bySubject[entry.subject].push(entry);
  });
  Object.values(bySubject).forEach((rows) => rows.sort((a, b) => Number(a.score) - Number(b.score)));
  return bySubject;
}

function metric(subject, score) {
  const rows = state.subjectIndex?.[subject] || [];
  if (!rows.length || score === "" || score === undefined) return null;
  const target = Number(score);
  let best = rows[0];
  rows.forEach((row) => {
    if (Math.abs(Number(row.score) - target) < Math.abs(Number(best.score) - target)) {
      best = row;
    }
  });
  return best;
}

function scoreValue(subject, score, mode) {
  const found = metric(subject, score);
  if (!found) return asNumber(score);
  if (mode === "standard") return asNumber(score);
  return asNumber(found.percentile, asNumber(score));
}

function conversionValue(subject, score, code) {
  const found = metric(subject, score);
  if (!found) return 0;
  const exact = found.conversions?.[code];
  if (exact !== undefined && exact !== "") return asNumber(exact);
  return asNumber(found.percentile, asNumber(score));
}

function normalizeKoreanSubject(subject) {
  // SUBJECT3 lookup은 국어(언매)/국어(화작) 선택과목을 "국어"로 통합 저장
  if (subject === "국어(언매)" || subject === "국어(화작)") return "국어";
  return subject;
}

function inquiryKind(subject) {
  return ["물리학", "화학", "생명과학", "지구과학"].some((name) => subject.includes(name)) ? "science" : "social";
}

function rowRestriction(row, input, computeRule = null) {
  const rule = computeRule?.mathChoice || text(row.mathScienceRule, "");
  const inquiryRule = computeRule?.inquiryChoice || text(row.mathScienceRule, "");
  const mathIsScience = input.mathSubject === "수학(미적)" || input.mathSubject === "수학(기하)";
  const inquiryKinds = [inquiryKind(input.inquirySubject1), inquiryKind(input.inquirySubject2)];
  const hasScience = inquiryKinds.includes("science");
  const hasSocial = inquiryKinds.includes("social");
  const requiredInquiryCount = Math.max(1, Math.round(asNumber(computeRule?.inquiryCount, 1)));
  if ((text(row.mathScienceRule, "").includes("미적기하+과탐") || rule === "가") && (!mathIsScience || !hasScience)) return "제외(수탐결격)";
  if (rule === "나" && mathIsScience) return "제외(수학결격)";
  if ((text(row.mathScienceRule, "").includes("과탐") || inquiryRule === "과") && !hasScience) return "제외(과탐결격)";
  if (inquiryRule === "사" && !hasSocial) return "제외(사탐결격)";
  if (inquiryRule === "(사)과" && !hasScience) return "제외(과탐결격)";
  if (inquiryRule === "사(과)" && !hasSocial) return "제외(사탐결격)";
  if (requiredInquiryCount === 2 && (!input.inquiryScore1 || !input.inquiryScore2)) return "제외(탐구부족)";
  return "";
}

function englishAdjustment(row, grade) {
  const cleanGrade = Math.min(9, Math.max(1, Math.round(asNumber(grade, 1))));
  return asNumber(row[`english${cleanGrade}`], 0);
}

function rawScore(row, input) {
  const examMode = text(row.examElements, "");
  const primaryMode = examMode.startsWith("백") ? "percentile" : "standard";
  const inquiryMode = examMode.includes("변") || examMode.includes("백") ? "percentile" : "standard";
  let koreanRatio = asNumber(row.koreanRatio);
  let mathRatio = asNumber(row.mathRatio);
  let inquiryRatio = asNumber(row.inquiryRatio);
  if (koreanRatio + mathRatio + inquiryRatio <= 0) {
    const total = asNumber(row.koreanWeight) + asNumber(row.mathWeight) + asNumber(row.inquiryWeight);
    koreanRatio = total ? asNumber(row.koreanWeight) / total : 0.3333;
    mathRatio = total ? asNumber(row.mathWeight) / total : 0.3333;
    inquiryRatio = total ? asNumber(row.inquiryWeight) / total : 0.3333;
  }

  const korean = scoreValue(normalizeKoreanSubject(input.koreanSubject), input.koreanScore, primaryMode);
  const math = scoreValue(input.mathSubject, input.mathScore, primaryMode);
  const inquiry = [
    scoreValue(input.inquirySubject1, input.inquiryScore1, inquiryMode),
    scoreValue(input.inquirySubject2, input.inquiryScore2, inquiryMode),
  ].sort((a, b) => b - a);
  const inquiryCount = Math.max(1, Math.min(2, Math.round(asNumber(row.inquiryCount, 2))));
  const inquiryAverage = inquiry.slice(0, inquiryCount).reduce((sum, value) => sum + value, 0) / inquiryCount;
  return korean * koreanRatio + math * mathRatio + inquiryAverage * inquiryRatio + englishAdjustment(row, input.englishGrade);
}

function topValues(values, count) {
  return [...values].map(asNumber).filter((value) => Number.isFinite(value)).sort((a, b) => b - a).slice(0, count);
}

function groupValue(group, cells, inquiryTopOne = false) {
  if (group === "국") return cells[46] || 0;
  if (group === "수") return cells[47] || 0;
  if (group === "영") return cells[48] || 0;
  if (group === "탐") return inquiryTopOne ? Math.max(cells[52] || 0, cells[53] || 0, cells[54] || 0, cells[55] || 0) : cells[51] || 0;
  if (group === "한") return cells[57] || 0;
  return 0;
}

function parseGroups(textValue) {
  const left = text(textValue, "").split("中")[0];
  const groups = [];
  ["국", "수", "영", "탐", "한"].forEach((group) => {
    if (left.includes(group)) groups.push(group);
  });
  return groups;
}

function parsePickCount(textValue, fallback = 0) {
  const match = text(textValue, "").match(/택(\d+)/);
  return match ? Number(match[1]) : fallback;
}

function requiredScore(required, cells) {
  return parseGroups(required).reduce((sum, group) => sum + groupValue(group, cells), 0);
}

function optionalScore(optional, cells) {
  if (!optional) return 0;
  const count = parsePickCount(optional, 1);
  const inquiryTopOne = optional.includes("탐(1)");
  const values = parseGroups(optional).map((group) => groupValue(group, cells, inquiryTopOne));
  return topValues(values, count).reduce((sum, value) => sum + value, 0);
}

function evalComputeFormula(formula, cells) {
  if (!formula || !formula.startsWith("=")) return 0;
  let expr = formula.slice(1);
  const large = (values, n) => topValues(values, n)[n - 1] ?? 0;
  const sum = (...values) => values.flat().reduce((total, value) => total + asNumber(value), 0);
  const round = (value, digits = 0) => {
    const factor = 10 ** asNumber(digits, 0);
    return Math.round(asNumber(value) * factor) / factor;
  };
  const IFX = (condition, yes, no) => (condition ? yes : no);
  expr = expr
    .replace(/%/g, "/100")
    .replace(/LARGE\(\(([^()]+)\),\s*([0-9]+)\)/g, "large([$1],$2)")
    .replace(/\bSUM\(/g, "sum(")
    .replace(/\bROUND\(/g, "round(")
    .replace(/\bIF\(/g, "IFX(")
    .replace(/\$?([A-Z]+)\$?([0-9]+)/g, (_, col, row) => {
      if (col === "B" && row === "12") return "inputMathCalculus";
      if (col === "B" && row === "13") return "inputMathGeometry";
      return `(cells[${Number(row)}]||0)`;
    });
  try {
    return Function("large", "sum", "round", "IFX", "cells", "inputMathCalculus", "inputMathGeometry", `return ${expr};`)(
      large,
      sum,
      round,
      IFX,
      cells,
      state.input.mathSubject === "수학(미적)" ? asNumber(state.input.mathScore) : 0,
      state.input.mathSubject === "수학(기하)" ? asNumber(state.input.mathScore) : 0,
    );
  } catch {
    return 0;
  }
}

function computeExamScore(row, input) {
  const rule = state.data.compute?.rules?.[row.conversion];
  if (!rule) return null;
  const code = row.conversion;
  const inquiryValues = [
    conversionValue(input.inquirySubject1, input.inquiryScore1, code),
    conversionValue(input.inquirySubject2, input.inquiryScore2, code),
    0,
    0,
  ];
  const inquiryCount = Math.max(0, Math.min(2, Math.round(asNumber(rule.inquiryCount, 0))));
  const cells = {};
  cells[46] = conversionValue(normalizeKoreanSubject(input.koreanSubject), input.koreanScore, code);
  cells[47] = conversionValue(input.mathSubject, input.mathScore, code);
  cells[49] = conversionValue("영어", input.englishGrade, code);
  cells[50] = rule.historySubstitution === "한→영대체" ? conversionValue("한국사", input.historyGrade, code) : 0;
  cells[48] = Math.max(cells[49], cells[50]);
  cells[52] = topValues(inquiryValues, 1)[0] || 0;
  cells[53] = topValues(inquiryValues, 2)[1] || 0;
  cells[54] = rule.historySubstitution === "한→탐대체" ? conversionValue("한국사", input.historyGrade, code) : 0;
  cells[55] = 0;
  cells[56] = 0;
  const inquiryPool = [cells[52], cells[53], cells[54], cells[55]];
  cells[51] = inquiryCount === 0 ? 0 : topValues(inquiryPool, inquiryCount).reduce((sum, value) => sum + value, 0) + cells[56];
  cells[57] = rule.historySubstitution === "한→영대체" || rule.historySubstitution === "한→탐대체"
    ? 0
    : conversionValue("한국사", input.historyGrade, code);
  cells[58] = asNumber(rule.base);
  // cells[59]: 엑셀 row59 수식 재현
  // =D46*IF("국"∈D65) + D47*IF("수"∈D65) + D48*IF("영"∈D65) + D51*IF("탐"∈D65)
  // + D57*(1 - IF("한"∈D66 OR D67 OR D71))
  // 즉, 한국사(D57)는 optional/weighted/historySubstitution 중 어디에도 "한"이 없으면 자동 포함
  cells[59] = requiredScore(rule.required, cells);
  const koreanHistoryElsewhere = [rule.optional, rule.weighted, rule.historySubstitution]
    .some((field) => field && String(field).includes("한"));
  if (!koreanHistoryElsewhere) {
    cells[59] += cells[57];
  }
  cells[60] = evalComputeFormula(rule.optionalFormula, cells) || optionalScore(rule.optional, cells);
  cells[61] = evalComputeFormula(rule.weightedFormula, cells) || optionalScore(rule.weighted, cells);
  cells[62] = evalComputeFormula(rule.adjustFormula, cells);
  return {
    examScore: cells[58] + cells[59] + cells[60] + cells[61] + cells[62],
    rule,
  };
}

function evaluateRow(row) {
  const input = state.input;
  const exact = computeExamScore(row, input);
  const restriction = rowRestriction(row, input, exact?.rule);
  const baseExam = asNumber(row.examScore);
  let computedExam = exact?.examScore;
  if (!Number.isFinite(computedExam) || computedExam <= 0) {
    const baseline = state.data.meta.defaultInput;
    const baseRaw = rawScore(row, baseline);
    const nextRaw = rawScore(row, input);
    computedExam = baseRaw > 0 && baseExam > 0 ? baseExam * (nextRaw / baseRaw) : baseExam;
  }
  // 내신점수: 직접입력 → 비교내신(기본값) → row.schoolScore(엑셀 캐시) 순으로 적용
  const convCode = row.conversion || "";
  const schoolMeta = (state.data.schoolInput || {})[convCode];
  const userSchool = state.schoolInput[convCode];
  let schoolScore;
  if (userSchool !== undefined && userSchool !== "") {
    schoolScore = asNumber(userSchool);
  } else if (schoolMeta) {
    schoolScore = schoolMeta.defaultScore;
  } else {
    schoolScore = asNumber(row.schoolScore);
  }
  const totalScore = computedExam + schoolScore;
  const safeScore = asNumber(row.safeScore, Infinity);
  const expectedScore = asNumber(row.expectedScore, Infinity);
  const reachScore = asNumber(row.reachScore, Infinity);
  let status = restriction;
  if (!status) {
    if (totalScore >= safeScore) status = "적정점수 이상";
    else if (totalScore >= expectedScore) status = "예상점수 이상";
    else if (totalScore >= reachScore) status = "소신점수 이상";
    else status = "소신점수 미만";
  }
  const basePercentile = asNumber(row.percentile, 0);
  const percentile = computedExam > 0 ? Math.max(0.0001, basePercentile * (baseExam / computedExam)) : basePercentile;
  return { ...row, computedExam, computedSchool: schoolScore, computedTotal: totalScore, computedStatus: status, computedPercentile: percentile };
}

function currentRows() {
  return state.data.rows[state.track] || [];
}

function filteredRows() {
  const query = state.query.trim().toLowerCase();
  let rows = currentRows().map(evaluateRow).filter((row) => {
    const haystack = [
      row.university,
      row.major,
      row.shortUniversity,
      row.shortMajor,
      row.province,
      row.city,
      row.category,
      row.selection,
    ].join(" ").toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!state.status || row.computedStatus === state.status) &&
      (!state.round || row.round === state.round) &&
      (!state.province || row.province === state.province)
    );
  });

  rows = rows.sort((a, b) => {
    if (state.sortBy === "status") {
      return (statusRank[a.computedStatus] || 99) - (statusRank[b.computedStatus] || 99)
        || Number(b.computedTotal || 0) - Number(a.computedTotal || 0);
    }
    if (state.sortBy === "totalScore") {
      return Number(b.computedTotal || 0) - Number(a.computedTotal || 0);
    }
    if (state.sortBy === "percentile") {
      return Number(a.computedPercentile || 999) - Number(b.computedPercentile || 999);
    }
    return text(a.university).localeCompare(text(b.university), "ko-KR");
  });

  return rows;
}

function optionList(rows, field) {
  return [...new Set(rows.map((row) => row[field]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko-KR"));
}

function fillSelect(select, values, selected) {
  const first = select.options[0];
  select.replaceChildren(first);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(selected) ? selected : "";
}

function refreshFilters() {
  const rows = currentRows().map(evaluateRow);
  fillSelect($("statusFilter"), optionList(rows.map((row) => ({ status: row.computedStatus })), "status"), state.status);
  fillSelect($("roundFilter"), optionList(rows, "round"), state.round);
  fillSelect($("provinceFilter"), optionList(rows, "province"), state.province);
}

function renderCards(rows) {
  const cards = $("cards");
  cards.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "조건에 맞는 모집단위가 없습니다.";
    cards.append(empty);
    return;
  }

  rows.slice(0, 120).forEach((row) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="program">
        <strong>${text(row.university)} ${text(row.major, "")}</strong>
        <span>${text(row.category)} · ${text(row.round)}군 · ${text(row.province)} ${text(row.city, "")} · 정원 ${numberText(row.quota, 0)}</span>
      </div>
      <div><span class="badge ${statusClass(text(row.computedStatus, ""))}">${text(row.computedStatus)}</span></div>
      <div class="metric"><small>수능+내신</small><b>${numberText(row.computedTotal, 3)}</b></div>
      <div class="metric"><small>수능 / 내신</small><b>${numberText(row.computedExam, 3)} / ${row.computedSchool > 0 ? numberText(row.computedSchool, 3) : "없음"}</b></div>
      <div class="metric"><small>누백</small><b>${numberText(row.computedPercentile, 4)}%</b></div>
      <div class="metric"><small>지원선</small><b>${numberText(row.safeScore, 2)} / ${numberText(row.expectedScore, 2)} / ${numberText(row.reachScore, 2)}</b></div>
      <div class="metric"><small>반영</small><b>${text(row.examElements)} · ${text(row.subjectCombo)}</b></div>
    `;
    cards.append(card);
  });
}

function renderSchoolPanel() {
  const container = $("schoolInputPanel");
  if (!container || !state.data) return;

  const schoolInfo = state.data.schoolInput || {};
  // 현재 track에서 실제 사용되는 conversion 코드만 추출 (중복 제거, defaultScore>0 우선)
  const seen = new Map();
  (state.data.rows[state.track] || []).forEach((row) => {
    const code = row.conversion || "";
    if (!code || seen.has(code)) return;
    const meta = schoolInfo[code];
    if (meta) seen.set(code, { code, meta, university: row.shortUniversity || row.university || code });
  });

  const items = [...seen.values()].sort((a, b) => a.university.localeCompare(b.university, "ko"));

  container.replaceChildren();
  if (!items.length) {
    container.innerHTML = `<p class="note">이 계열에 내신 반영 대학이 없습니다.</p>`;
    return;
  }

  items.forEach(({ code, meta, university }) => {
    const userVal = state.schoolInput[code] ?? "";
    const defaultLabel = meta.defaultScore > 0
      ? `기본값 ${numberText(meta.defaultScore, 2)}${meta.maxScore ? ` / ${numberText(meta.maxScore, 0)}점` : ""}`
      : "기본값 없음";
    const isCustom = userVal !== "";

    const row = document.createElement("div");
    row.className = "school-row" + (isCustom ? " school-row--custom" : "");
    row.innerHTML = `
      <label class="school-label" title="${code}">
        <span class="school-univ">${university}</span>
        <span class="school-code">${code}</span>
      </label>
      <div class="school-input-wrap">
        <input class="school-score-input" type="text" inputmode="decimal"
          data-code="${code}"
          value="${userVal}"
          placeholder="${defaultLabel}">
        ${isCustom ? `<button class="school-clear" data-code="${code}" title="초기화">✕</button>` : ""}
      </div>
    `;
    container.append(row);
  });

  // 이벤트: 입력
  container.querySelectorAll(".school-score-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const code = e.target.dataset.code;
      state.schoolInput[code] = e.target.value.trim();
      render();
    });
  });
  // 이벤트: 초기화 버튼
  container.querySelectorAll(".school-clear").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const code = e.target.dataset.code;
      delete state.schoolInput[code];
      render();
    });
  });
}

function render() {
  const rows = filteredRows();
  if ($("totalRows")) $("totalRows").textContent = currentRows().length.toLocaleString("ko-KR");
  if ($("visibleRows")) $("visibleRows").textContent = rows.length.toLocaleString("ko-KR");
  $("resultTitle").textContent = state.track === "science" ? "이과계열 분석결과" : "문과계열 분석결과";
  $("scienceTab").classList.toggle("active", state.track === "science");
  $("humanitiesTab").classList.toggle("active", state.track === "humanities");
  renderSchoolPanel();
  renderCards(rows);
}

function readInput() {
  state.input = Object.fromEntries(inputIds.map((id) => [id, $(id)?.value ?? ""]));
}

function applyDefaultInput() {
  const defaults = state.data?.meta?.defaultInput || {};
  inputIds.forEach((id) => {
    if ($(id) && defaults[id] !== undefined) {
      $(id).value = defaults[id];
    }
  });
  readInput();
}

function resetScoreInputs() {
  ["koreanScore", "mathScore", "englishGrade", "historyGrade", "inquiryScore1", "inquiryScore2"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  readInput();
}

function fillSubjectSelect(id, values, selected) {
  const select = $(id);
  select.replaceChildren();
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = selected;
}

function bindEvents() {
  $("scienceTab").addEventListener("click", () => {
    state.track = "science";
    state.status = "";
    state.round = "";
    state.province = "";
    refreshFilters();
    render();
  });
  $("humanitiesTab").addEventListener("click", () => {
    state.track = "humanities";
    state.status = "";
    state.round = "";
    state.province = "";
    refreshFilters();
    render();
  });
  $("query").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    render();
  });
  $("roundFilter").addEventListener("change", (event) => {
    state.round = event.target.value;
    render();
  });
  $("provinceFilter").addEventListener("change", (event) => {
    state.province = event.target.value;
    render();
  });
  $("sortBy").addEventListener("change", (event) => {
    state.sortBy = event.target.value;
    render();
  });
  inputIds.forEach((id) => {
    $(id)?.addEventListener("input", () => {
      readInput();
      render();
    });
    $(id)?.addEventListener("change", () => {
      readInput();
      render();
    });
  });
  $("resetScores")?.addEventListener("click", () => {
    resetScoreInputs();
    render();
  });
}

async function init() {
  if (state.initialized) return;
  try {
    const response = await fetch(`app-data.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`app-data.json 로드 실패 (${response.status})`);
    state.data = await response.json();
  } catch (error) {
    $("cards").innerHTML = `<div class="empty">데이터를 불러오지 못했습니다: ${error.message}</div>`;
    if ($("totalRows")) $("totalRows").textContent = "!";
    console.error("init error:", error);
    return;
  }

  state.subjectIndex = makeSubjectIndex(state.data.subjects.lookup);
  if ($("sourceDate")) $("sourceDate").textContent = text((state.data.meta.title.match(/date:(\d+)/) || [])[1], "xlsx");

  fillSubjectSelect("koreanSubject", state.data.subjects.korean, state.data.meta.defaultInput.koreanSubject);
  fillSubjectSelect("mathSubject", state.data.subjects.math, state.data.meta.defaultInput.mathSubject);
  fillSubjectSelect("inquirySubject1", state.data.subjects.inquiry, state.data.meta.defaultInput.inquirySubject1);
  fillSubjectSelect("inquirySubject2", state.data.subjects.inquiry, state.data.meta.defaultInput.inquirySubject2);
  applyDefaultInput();

  bindEvents();
  refreshFilters();
  render();
  state.initialized = true;
}

function showApp() {
  $("passwordGate")?.setAttribute("hidden", "");
  $("appShell")?.removeAttribute("hidden");
  init();
}

function setupPasswordGate() {
  if (sessionStorage.getItem("jungsiconsulting-auth") === "ok") {
    showApp();
    return;
  }

  $("appShell")?.setAttribute("hidden", "");
  $("passwordGate")?.removeAttribute("hidden");
  $("passwordInput")?.focus();

  $("passwordForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = $("passwordInput")?.value.trim();
    if (password === APP_PASSWORD) {
      sessionStorage.setItem("jungsiconsulting-auth", "ok");
      $("passwordError").textContent = "";
      showApp();
      return;
    }
    $("passwordError").textContent = "비밀번호가 올바르지 않습니다.";
    $("passwordInput")?.select();
  });
}

setupPasswordGate();
