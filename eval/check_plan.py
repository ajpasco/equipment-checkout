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
          f"({counts}); the {review_count} review rows are a person's")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 1:
        sys.exit(__doc__)
    sys.exit(main())
