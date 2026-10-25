"""The row check: a report passes only when every expected row has a passing case in it.

Usage: python3 -I eval/check_rows.py <name> <report.xml> <rows.txt>

A runner's exit code is not the verdict. pytest exits 0 when a case is skipped, and Playwright
writes the production rows into the journey report as skipped when a journey row fails, so a
build could be graded on fewer rows than it owes. This reads the JUnit report instead and, for
each row id listed in <rows.txt>, requires at least one case carrying that id and every case
carrying it to have passed. A row with no case, or whose case failed, errored or was skipped,
fails the check, and each is named.

A row the founder has deferred is the one exception. eval/deferred.txt, beside this file, lists such
rows one per line as `<row id> <defect id>` (the defect record is docs/defects/<defect id>.md). A
deferred row that does not pass is reported, with its defect, and does not fail the check; a
deferred row that passes is reported too, so that its line can be removed. Nothing else about the
row changes: it stays on its group's list and its case still runs.

A case's row id is its `row` property when it has one (the API rows write it, eval/api/conftest.py)
and otherwise the id that opens its name (the browser and journey rows' titles, DD-24).

Standard library only, run with -I, so nothing in the tree under test can change how it reads.
"""

import os
import re
import sys
import xml.etree.ElementTree as ET

ROW = re.compile(r"T-\d{3}-[PN]\d+")
PYTHON_ROW = re.compile(r"test_T_(\d{3})_([PN]\d+)")


def expected_rows(path):
    with open(path, encoding="utf-8") as handle:
        lines = (line.strip() for line in handle)
        return [line for line in lines if line and not line.startswith("#")]


DEFERRED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "deferred.txt")
DEFECT = re.compile(r"D-[1-9]\d*")


def deferred_rows(path=DEFERRED):
    """{row id: defect id} from eval/deferred.txt; an absent file defers nothing. A line that is not
    `<row id> <defect id>` is refused, so a typo cannot quietly defer the wrong row or none."""
    try:
        with open(path, encoding="utf-8") as handle:
            lines = [line.split("#", 1)[0].strip() for line in handle]
    except FileNotFoundError:
        return {}
    deferred = {}
    for number, line in enumerate(lines, start=1):
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2 or not ROW.fullmatch(parts[0]) or not DEFECT.fullmatch(parts[1]):
            sys.exit(f"[rows] eval/deferred.txt, line {number}: expected '<row id> <defect id>', got {line!r}")
        deferred[parts[0]] = parts[1]
    return deferred


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


def report_deferred(expected, verdict, deferred):
    """Print the deferred rows of this list, and return those that do not pass."""
    held = [row for row in expected if row in deferred]
    owed = [row for row in held if verdict.get(row) != "passed"]
    if owed:
        print(f"    deferred by the founder, reported and not failed ({len(owed)}):")
        for row in owed:
            print(f"      {row} {verdict.get(row, 'missing')}, defect {deferred[row]}")
    cured = [row for row in held if verdict.get(row) == "passed"]
    if cured:
        print(f"    note: deferred rows that now pass; remove their lines from eval/deferred.txt: {' '.join(cured)}")
    return owed


def main(name, report, rows_file):
    expected = expected_rows(rows_file)
    deferred = deferred_rows()
    try:
        cases = list(ET.parse(report).getroot().iter("testcase"))
    except (FileNotFoundError, ET.ParseError) as problem:
        why = (f"no report at {report}" if isinstance(problem, FileNotFoundError)
               else f"the report {report} cannot be read ({problem})")
        owed = [row for row in expected if row not in deferred]
        word = "FAIL" if owed else "pass"
        print(f"[rows] {name}: {word}, {why}; all {len(expected)} rows are missing:")
        print(f"      {wrap(expected)}")
        report_deferred(expected, {}, deferred)
        return 1 if owed else 0

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
    owed = [row for row in expected if verdict[row] != "passed" and row not in deferred]
    status = 0 if not owed else 1
    word = "pass" if status == 0 else "FAIL"
    print(f"[rows] {name}: {word}, {len(passed)} of {len(expected)} expected rows passed")
    for kind in ("missing", "failed", "errored", "skipped"):
        ids = [row for row in owed if verdict[row] == kind]
        if ids:
            print(f"    {kind} ({len(ids)}):\n      {wrap(ids)}")
    report_deferred(expected, verdict, deferred)
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
