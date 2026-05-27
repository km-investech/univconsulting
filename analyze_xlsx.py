import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
CELL = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"
TEXT = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"


def load_shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("a:si", NS):
        strings.append("".join(t.text or "" for t in si.iter(TEXT)))
    return strings


def sheet_paths(z):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    paths = {}
    for sheet in wb.find("a:sheets", NS):
        target = relmap[sheet.attrib[REL_ID]].lstrip("/")
        paths[sheet.attrib["name"]] = target if target.startswith("xl/") else "xl/" + target
    return paths


def cell_value(cell, shared_strings):
    value = cell.find("a:v", NS)
    formula = cell.find("a:f", NS)
    inline = cell.find("a:is", NS)
    cell_type = cell.attrib.get("t")
    if cell_type == "s" and value is not None:
        return shared_strings[int(value.text)]
    if cell_type == "inlineStr" and inline is not None:
        return "".join(t.text or "" for t in inline.iter(TEXT))
    if formula is not None:
        return "=" + (formula.text or "")
    return value.text if value is not None else ""


def coord(ref):
    match = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for char in match.group(1):
        col = col * 26 + ord(char) - 64
    return int(match.group(2)), col


def dump_cells(z, paths, shared_strings, sheet_names, limit=300):
    for sheet_name in sheet_names:
        root = ET.fromstring(z.read(paths[sheet_name]))
        cells = []
        for cell in root.iter(CELL):
            ref = cell.attrib.get("r", "")
            value = cell_value(cell, shared_strings)
            if value != "":
                row, col = coord(ref)
                cells.append((row, col, ref, value))
        print(f"\n## {sheet_name}")
        for _, _, ref, value in sorted(cells)[:limit]:
            print(f"{ref}\t{value}")


def col_name(index):
    name = ""
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def export_app_data(z, paths, shared_strings):
    selected = {
        "science": {
            "sheet": "이과계열분석결과",
            "columns": {
                "track": "A",
                "university": "B",
                "major": "C",
                "status": "D",
                "examScore": "E",
                "schoolScore": "F",
                "totalScore": "G",
                "percentile": "H",
                "rank": "I",
                "fitCount": "J",
                "cut70Count": "K",
                "safeScore": "L",
                "expectedScore": "M",
                "reachScore": "N",
                "safePercentile": "O",
                "expectedPercentile": "P",
                "reachPercentile": "Q",
                "category": "AD",
                "round": "AE",
                "quota": "AF",
                "province": "AG",
                "city": "AH",
                "feature": "AI",
                "shortUniversity": "AJ",
                "shortMajor": "AK",
                "selection": "AL",
                "conversion": "AM",
                "mathScienceRule": "AN",
                "examElements": "AO",
                "subjectCombo": "AP",
                "required": "AQ",
                "optional": "AR",
                "weightedChoice": "AS",
                "inquiryCount": "AT",
                "koreanWeight": "AU",
                "mathWeight": "AV",
                "inquiryWeight": "AW",
                "koreanRatio": "AX",
                "mathRatio": "AY",
                "inquiryRatio": "AZ",
                "english1": "BA",
                "english2": "BB",
                "english3": "BC",
            },
        },
        "humanities": {
            "sheet": "문과계열분석결과",
            "columns": {
                "track": "A",
                "university": "B",
                "major": "C",
                "status": "D",
                "examScore": "E",
                "schoolScore": "F",
                "totalScore": "G",
                "percentile": "H",
                "rank": "I",
                "safeScore": "J",
                "expectedScore": "K",
                "reachScore": "L",
                "safePercentile": "M",
                "expectedPercentile": "N",
                "reachPercentile": "O",
                "category": "AB",
                "round": "AC",
                "quota": "AD",
                "province": "AE",
                "city": "AF",
                "feature": "AG",
                "shortUniversity": "AH",
                "shortMajor": "AI",
                "selection": "AJ",
                "conversion": "AK",
                "mathScienceRule": "AL",
                "examElements": "AM",
                "subjectCombo": "AN",
                "required": "AO",
                "optional": "AP",
                "weightedChoice": "AQ",
                "inquiryCount": "AR",
                "koreanWeight": "AS",
                "mathWeight": "AT",
                "inquiryWeight": "AU",
                "koreanRatio": "AV",
                "mathRatio": "AW",
                "inquiryRatio": "AX",
                "english1": "AY",
                "english2": "AZ",
                "english3": "BA",
            },
        },
    }

    def normalize(value):
        if value is None or value == "":
            return ""
        try:
            number = float(value)
            if number.is_integer():
                return int(number)
            return round(number, 6)
        except (TypeError, ValueError):
            return value

    def read_sheet(sheet_name):
        root = ET.fromstring(z.read(paths[sheet_name]))
        rows = {}
        for cell in root.iter(CELL):
            ref = cell.attrib.get("r", "")
            row, col = coord(ref)
            value_node = cell.find("a:v", NS)
            formula = cell.find("a:f", NS)
            if formula is not None and value_node is not None:
                value = value_node.text or ""
            else:
                value = cell_value(cell, shared_strings)
            rows.setdefault(row, {})[col_name(col)] = normalize(value)
        return rows

    def formula_or_value(cell, shared):
        formula = cell.find("a:f", NS)
        if formula is not None:
            return "=" + (formula.text or "")
        return cell_value(cell, shared)

    def subject_tables(conversion_codes):
        subject1 = read_sheet("SUBJECT1")
        subject3 = read_sheet("SUBJECT3")
        subjects = []
        populations = {}
        for row_index, row in subject1.items():
            if row_index < 5:
                continue
            name = row.get("A", "")
            if not name:
                continue
            subjects.append(name)
            populations[name] = {
                "maxStandard": normalize(row.get("B", "")),
                "maxPercentile": normalize(row.get("C", "")),
                "population": normalize(row.get("D", "")),
            }

        root = ET.fromstring(z.read(paths["SUBJECT3"]))
        rows = {}
        for cell in root.iter(CELL):
            ref = cell.attrib.get("r", "")
            row, col = coord(ref)
            rows.setdefault(row, {})[col_name(col)] = cell_value(cell, shared_strings)

        header_to_col = {value: col for col, value in rows.get(4, {}).items() if value}
        code_cols = {code: header_to_col[code] for code in conversion_codes if code in header_to_col}
        lookup = {}
        for row_index, row in rows.items():
            if row_index < 5:
                continue
            subject = row.get("B", "")
            score = row.get("C", "")
            if not subject or score == "":
                continue
            conversions = {}
            for code, column in code_cols.items():
                value = normalize(row.get(column, ""))
                if value != "":
                    conversions[code] = value
            lookup[f"{subject}-{score}"] = {
                "subject": subject,
                "score": normalize(score),
                "percentile": normalize(row.get("E", "")),
                "choicePercentile": normalize(row.get("F", "")),
                "grade": normalize(row.get("G", "")),
                "choiceGrade": normalize(row.get("H", "")),
                "cumulative": normalize(row.get("I", "")),
                "choiceCumulative": normalize(row.get("J", "")),
                "conversions": conversions,
            }
        return subjects, populations, lookup

    def compute_rules():
        root = ET.fromstring(z.read(paths["COMPUTE"]))
        cells = {}
        for cell in root.iter(CELL):
            row, col = coord(cell.attrib.get("r", ""))
            cells[(row, col_name(col))] = formula_or_value(cell, shared_strings)
        rules = {}
        codes = []
        for col_index in range(4, 563):
            column = col_name(col_index)
            code = cells.get((2, column), "")
            if not code:
                continue
            codes.append(code)
            rules[code] = {
                "column": column,
                "base": normalize(cells.get((58, column), 0)),
                "required": cells.get((65, column), ""),
                "optional": cells.get((66, column), ""),
                "weighted": cells.get((67, column), ""),
                "inquiryCount": normalize(cells.get((68, column), 0)),
                "mathChoice": cells.get((69, column), ""),
                "inquiryChoice": cells.get((70, column), ""),
                "historySubstitution": cells.get((71, column), ""),
                "foreignSubstitution": cells.get((72, column), ""),
                "optionalFormula": cells.get((60, column), ""),
                "weightedFormula": cells.get((61, column), ""),
                "adjustFormula": cells.get((62, column), ""),
            }
        return codes, rules

    conversion_codes, rules = compute_rules()
    payload = {"meta": {}, "subjects": {}, "compute": {"rules": rules}, "rows": {}}
    input_rows = read_sheet("수능입력")
    subjects, populations, lookup = subject_tables(conversion_codes)
    payload["meta"]["title"] = input_rows.get(1, {}).get("A", "고속성장분석기")
    payload["meta"]["defaultInput"] = {
        "koreanSubject": "국어(언매)" if input_rows.get(10, {}).get("C", "") else "국어(화작)",
        "koreanScore": input_rows.get(10, {}).get("C", "") or input_rows.get(9, {}).get("C", ""),
        "mathSubject": "수학(미적)"
        if input_rows.get(12, {}).get("C", "")
        else "수학(기하)"
        if input_rows.get(13, {}).get("C", "")
        else "수학(확통)",
        "mathScore": input_rows.get(12, {}).get("C", "")
        or input_rows.get(13, {}).get("C", "")
        or input_rows.get(14, {}).get("C", ""),
        "englishGrade": input_rows.get(18, {}).get("C", ""),
        "historyGrade": input_rows.get(19, {}).get("C", ""),
        "inquirySubject1": "생명과학 Ⅰ",
        "inquiryScore1": input_rows.get(22, {}).get("C", ""),
        "inquirySubject2": "지구과학 Ⅰ",
        "inquiryScore2": input_rows.get(24, {}).get("C", ""),
        "schoolScore": "",
    }
    payload["subjects"] = {
        "all": subjects,
        "korean": [s for s in subjects if s.startswith("국어(")],
        "math": [s for s in subjects if s.startswith("수학(") and s in ["수학(미적)", "수학(기하)", "수학(확통)"]],
        "inquiry": [
            s
            for s in subjects
            if s
            not in [
                "국어",
                "국어(언매)",
                "국어(화작)",
                "수학",
                "수학(미적)",
                "수학(기하)",
                "수학(확통)",
                "수학(미기)",
                "수학(이과)",
                "수학(문과)",
                "영어",
                "한국사",
            ]
            and "Ⅰ" in s or "Ⅱ" in s or s in ["경제", "동아시아사", "사회·문화", "생활과 윤리", "세계사", "세계지리", "윤리와 사상", "정치와 법", "한국지리"]
        ],
        "population": populations,
        "lookup": lookup,
    }

    for key, config in selected.items():
        rows = read_sheet(config["sheet"])
        colmap = config["columns"]
        output = []
        allowed_rounds = {"가", "나", "다"}
        for row_index in sorted(rows):
            if row_index < 6:
                continue
            row = rows[row_index]
            item = {"id": f"{key}-{row_index}"}
            for field, column in colmap.items():
                item[field] = row.get(column, "")
            if item.get("university") and item.get("major") and item.get("round") in allowed_rounds:
                output.append(item)
        payload["rows"][key] = output
    return payload


def summarize(z, paths):
    summary = []
    for name, path in paths.items():
        root = ET.fromstring(z.read(path))
        dimension = root.find("a:dimension", NS)
        cells = 0
        formulas = 0
        for cell in root.iter(CELL):
            has_value = cell.find("a:v", NS) is not None or cell.find("a:is", NS) is not None
            has_formula = cell.find("a:f", NS) is not None
            cells += 1 if has_value or has_formula else 0
            formulas += 1 if has_formula else 0
        summary.append(
            {
                "name": name,
                "dimension": dimension.attrib.get("ref") if dimension is not None else None,
                "cells": cells,
                "formulas": formulas,
            }
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "summary"
    with zipfile.ZipFile("source.xlsx") as z:
        shared_strings = load_shared_strings(z)
        paths = sheet_paths(z)
        if mode == "inputs":
            dump_cells(z, paths, shared_strings, ["수능입력", "내신입력"])
        elif mode == "export":
            print(json.dumps(export_app_data(z, paths, shared_strings), ensure_ascii=False))
        else:
            summarize(z, paths)


if __name__ == "__main__":
    main()
