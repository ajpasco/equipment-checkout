"""The plan check: no automated row of the eval plan can be left out of the exam unnoticed.

Usage: python3 -I eval/check_plan.py

Reads the test table of docs/eval-plan.md (section 3) and the row lists of the exam's groups
(eval/*/rows.txt), and fails unless both directions hold:

  - every row of the plan whose kind is not `review` is listed in exactly one rows.txt. The review
    rows (mechanism R, eval plan 1.5) are a person's record and never a case in a report, so they
    are the only rows no group lists;
  - every id in a rows.txt is a row of the plan, and not a review row.

A row the founder has deferred (eval/deferred.txt, read by eval/check_rows.py) stays on its group's
list, so it counts here as a row with a test. Each deferred id must be such a row; a line naming
anything else is refused.

The journey pair rule (eval plan 1.6): every requirement that the plan's rows or the PRD's headings
name, and that is not on the plan's look list, has at least one positive and one negative row in
eval/e2e/rows.txt, the rows that drive the real application end to end. The look list is the one
line of the plan that reads `Look list: REQ-nnn, REQ-nnn.`, or `Look list: none.` (a requirement whose criteria are all about how the page looks, which
the browser rows measure on the same build the stack serves); a plan without that line fails. A
deferred journey row still counts towards its pair, as it counts as a row here.

This exists because 146 rows (the component, unit and database rows) were once left out of the exam
by default and nothing said so. Standard library only, run with -I, so nothing in the tree under
test can change how it reads.
"""

import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PLAN = os.path.join(ROOT, "docs", "eval-plan.md")
DEFERRED = os.path.join(HERE, "deferred.txt")
ROW = re.compile(r"T-\d{3}-[PN]\d+")
JOURNEY = os.path.join(HERE, "e2e", "rows.txt")
JOURNEY_KINDS = {"e2e", "production", "restraint"}
LOOK_LIST = re.compile(r"^Look list: (none|REQ-\d{3}(?:, REQ-\d{3})*)\.$", re.MULTILINE)
PRD = os.path.join(ROOT, "docs", "PRD.md")
PRD_REQUIREMENT = re.compile(r"^### (REQ-\d{3}):", re.MULTILINE)


def plan_rows(path):
    """{row id: kind} for every row of the plan's section 3 table."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    start = re.search(r"^## 3\. ", text, re.MULTILINE)
    end = re.search(r"^## 4\. ", text, re.MULTILINE)
    if start is None or end is None or end.start() < start.start():
        sys.exit(f"[plan] FAIL, cannot find sections 3 and 4 of {path}")
    rows = {}
    for line in text[start.start() : end.start()].splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or not ROW.fullmatch(cells[0]):
            continue
        if len(cells) < 5:
            sys.exit(f"[plan] FAIL, row {cells[0]} of {path} does not have the table's five columns")
        if cells[0] in rows:
            sys.exit(f"[plan] FAIL, row {cells[0]} appears twice in {path}")
        # Columns: ID, Given / When / Then, kind, owner story, state. The sentence may hold a "|"
        # only escaped, so the kind is counted from the right.
        rows[cells[0]] = cells[-3]
    return rows


def look_list(path):
    """The requirements on the plan's look list, or None when the plan has no such line."""
    with open(path, encoding="utf-8") as handle:
        found = LOOK_LIST.findall(handle.read())
    if len(found) != 1:
        return None
    return set() if found[0] == "none" else set(found[0].split(", "))


def prd_requirements(path):
    """The requirements the PRD numbers (its `### REQ-nnn:` headings); none when it is absent."""
    try:
        with open(path, encoding="utf-8") as handle:
            return set(PRD_REQUIREMENT.findall(handle.read()))
    except FileNotFoundError:
        return set()


def journey_pairs(plan, journey_ids, look):
    """The requirements of the plan or the PRD, not on the look list, that lack a P or an N journey
    row. The PRD is read too, so that a requirement with no row at all is not missed."""
    requirements = sorted({f"REQ-{row[2:5]}" for row in plan} | prd_requirements(PRD))
    # Only a row of a journey kind counts: a unit or component row listed here would not drive the
    # real application, whatever list it is on.
    held = {(f"REQ-{row[2:5]}", row[6]) for row in journey_ids if plan.get(row) in JOURNEY_KINDS}
    missing = []
    for requirement in requirements:
        if requirement in look:
            continue
        lacking = [sense for sense in ("P", "N") if (requirement, sense) not in held]
        if lacking:
            missing.append(f"{requirement} has no {' and no '.join(lacking)} journey row")
    return missing


def listed_rows(path):
    with open(path, encoding="utf-8") as handle:
        lines = (line.strip() for line in handle)
        return [line for line in lines if line and not line.startswith("#")]


def deferred_ids(path):
    try:
        with open(path, encoding="utf-8") as handle:
            lines = [line.split("#", 1)[0].split() for line in handle]
    except FileNotFoundError:
        return []
    return [parts[0] for parts in lines if parts]


def wrap(ids):
    return "\n      ".join(" ".join(ids[i : i + 8]) for i in range(0, len(ids), 8))


def main():
    if not os.path.isfile(PLAN):
        print(f"[plan] FAIL, the plan is not in this tree: {os.path.relpath(PLAN, ROOT)}")
        return 1
    plan = plan_rows(PLAN)
    automated = {row for row, kind in plan.items() if kind != "review"}

    where = {}
    lists = sorted(glob.glob(os.path.join(HERE, "*", "rows.txt")))
    for path in lists:
        group = os.path.relpath(path, ROOT)
        for row in listed_rows(path):
            where.setdefault(row, []).append(group)

    problems = []
    left_out = sorted(automated - set(where))
    if left_out:
        problems.append(f"rows of the plan that no group lists ({len(left_out)}):\n      {wrap(left_out)}")
    twice = sorted(row for row, groups in where.items() if len(groups) > 1)
    for row in twice:
        problems.append(f"{row} is listed {len(where[row])} times: {', '.join(where[row])}")
    unknown = sorted(row for row in where if row not in plan)
    for row in unknown:
        problems.append(f"{row} in {', '.join(where[row])} is not a row of the plan")
    reviews = sorted(row for row in where if plan.get(row) == "review")
    for row in reviews:
        problems.append(f"{row} in {', '.join(where[row])} is a review row, a person's record, which no report holds")
    for row in deferred_ids(DEFERRED):
        if row not in where or row not in automated:
            problems.append(f"{row} in eval/deferred.txt is not an automated row on a group's list")

    look = look_list(PLAN)
    if not prd_requirements(PRD):
        problems.append(f"no requirement can be read from {os.path.relpath(PRD, ROOT)}, so the journey pair "
                        "rule cannot see a requirement that has no row")
    if look is None:
        problems.append("the plan has no single line 'Look list: REQ-nnn, ...' (eval plan 1.6), "
                        "so the journey pair rule cannot be read")
    else:
        named = {f"REQ-{row[2:5]}" for row in plan} | prd_requirements(PRD)
        unknown_look = sorted(r for r in look if r not in named)
        for requirement in unknown_look:
            problems.append(f"{requirement} is on the look list but neither the plan nor the PRD names it")
        journey = listed_rows(JOURNEY) if os.path.isfile(JOURNEY) else []
        for gap in journey_pairs(plan, journey, look):
            problems.append(f"journey pair rule: {gap} in eval/e2e/rows.txt and is not on the look list")

    counts = ", ".join(
        f"{os.path.relpath(path, ROOT)} {len(listed_rows(path))}" for path in lists
    )
    if problems:
        print(f"[plan] FAIL, the groups' lists do not match docs/eval-plan.md section 3 "
              f"({len(automated)} automated rows; {counts})")
        for problem in problems:
            print(f"    {problem}")
        return 1
    review_count = len(plan) - len(automated)
    print(f"[plan] pass, all {len(automated)} automated rows of the plan are each in exactly one group "
          f"({counts}); the {review_count} review rows are a person's; every requirement but the look "
          f"list ({', '.join(sorted(look)) or 'none'}) has a positive and a negative journey row")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 1:
        sys.exit(__doc__)
    sys.exit(main())
