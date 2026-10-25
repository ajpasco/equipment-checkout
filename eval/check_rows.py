"""The row check: a report passes only when every expected row has a passing case in it.

Usage: python3 -I eval/check_rows.py <name> <report.xml> <rows.txt>

A runner's exit code is not the verdict. pytest exits 0 when a case is skipped, and Playwright
writes the production rows into the journey report as skipped when a journey row fails, so a
build could be graded on fewer rows than it owes. This reads the JUnit report instead and, for
each row id listed in <rows.txt>, requires at least one case carrying that id and every case
carrying it to have passed. A row with no case, or whose case failed, errored or was skipped,
fails the check, and each is named.

A case's row id is its `row` property when it has one (the API rows write it, eval/api/conftest.py)
and otherwise the id that opens its name (the browser and journey rows' titles, DD-24).

Standard library only, run with -I, so nothing in the tree under test can change how it reads.
"""

import re
import sys
import xml.etree.ElementTree as ET

ROW = re.compile(r"T-\d{3}-[PN]\d+")
PYTHON_ROW = re.compile(r"test_T_(\d{3})_([PN]\d+)")


def expected_rows(path):
    with open(path, encoding="utf-8") as handle:
        lines = (line.strip() for line in handle)
        return [line for line in lines if line and not line.startswith("#")]


def row_of(case):
    for prop in case.iter("property"):
        if prop.get("name") == "row" and prop.get("value"):
            return prop.get("value")
    name = (case.get("name") or "").strip()
    found = ROW.match(name)
    if found:
        return found.group(0)
    found = PYTHON_ROW.match(name)
    if found:
        return f"T-{found.group(1)}-{found.group(2)}"
    return None


def outcome_of(case):
    for kind in ("failure", "error", "skipped"):
        if case.find(kind) is not None:
            return {"failure": "failed", "error": "errored", "skipped": "skipped"}[kind]
    return "passed"


def wrap(ids):
    return "\n      ".join(" ".join(ids[i : i + 8]) for i in range(0, len(ids), 8))


def main(name, report, rows_file):
    expected = expected_rows(rows_file)
    try:
        cases = list(ET.parse(report).getroot().iter("testcase"))
    except FileNotFoundError:
        print(f"[rows] {name}: FAIL, no report at {report}; all {len(expected)} rows are missing:")
        print(f"      {wrap(expected)}")
        return 1
    except ET.ParseError as problem:
        print(f"[rows] {name}: FAIL, the report {report} cannot be read ({problem}); "
              f"all {len(expected)} rows count as missing")
        return 1

    outcomes = {}
    for case in cases:
        row = row_of(case)
        if row is not None:
            outcomes.setdefault(row, []).append(outcome_of(case))

    verdict = {}
    for row in expected:
        seen = outcomes.get(row)
        if not seen:
            verdict[row] = "missing"
        elif all(each == "passed" for each in seen):
            verdict[row] = "passed"
        else:
            # The worst of its cases, so a row with one passing and one skipped case still fails.
            verdict[row] = next(k for k in ("failed", "errored", "skipped") if k in seen)

    passed = [row for row in expected if verdict[row] == "passed"]
    status = 0 if len(passed) == len(expected) else 1
    word = "pass" if status == 0 else "FAIL"
    print(f"[rows] {name}: {word}, {len(passed)} of {len(expected)} expected rows passed")
    for kind in ("missing", "failed", "errored", "skipped"):
        ids = [row for row in expected if verdict[row] == kind]
        if ids:
            print(f"    {kind} ({len(ids)}):\n      {wrap(ids)}")
    if passed and status:
        print(f"    passed ({len(passed)}):\n      {wrap(passed)}")
    unexpected = sorted(set(outcomes) - set(expected))
    if unexpected:
        print(f"    note: cases for rows not on the list, not counted: {' '.join(unexpected)}")
    return status


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(*sys.argv[1:]))
