"""Writes __tests__/fixtures/pose-bend.json: poseorbit's own bends of a figure,
which components/pose3d/bend.ts must reproduce (checked in pose.verify.ts).

Run it with a Python that has poseorbit 0.3 or later, after poseorbit's
bending changes:

    python scripts/pose-bend-fixture.py
"""

import json
from pathlib import Path

import numpy as np
from poseorbit import Edit, apply_edits


def figure(x: float) -> np.ndarray:
    """A figure in picture widths, with depth, every point somewhere different."""
    rng = np.random.default_rng(int(x * 100))
    points = rng.uniform(-0.05, 0.05, (133, 3))
    body = np.array([
        [0, -0.4, -0.01], [-0.02, -0.42, -0.01], [0.02, -0.42, -0.01], [-0.04, -0.41, 0.01], [0.04, -0.41, 0.01],
        [-0.1, -0.3, 0], [0.1, -0.3, 0], [-0.17, -0.17, -0.03], [0.17, -0.17, 0.03],
        [-0.22, -0.05, -0.05], [0.22, -0.05, 0.05], [-0.06, 0, 0], [0.06, 0, 0],
        [-0.07, 0.2, 0.01], [0.07, 0.2, -0.01], [-0.075, 0.4, 0], [0.075, 0.4, 0],
    ])
    points[:17] = body
    points[17:23] = body[[15, 15, 15, 16, 16, 16]] + points[17:23] / 2
    points[23:91] = body[0] + points[23:91] / 2
    points[91:112] += body[9]
    points[112:133] += body[10]
    return points + [x, 0.9, 0]


def main() -> None:
    people = [figure(0.3), figure(0.7)]
    cases = {
        "elbow then wrist": [Edit(0, 7, (0.05, 0.5, -0.1)), Edit(0, 9, (0.1, 0.4, 0.05))],
        "shoulder after its elbow": [Edit(0, 7, (0.0, 0.8, 0.1)), Edit(0, 5, (0.15, 0.55, 0.05))],
        "the head and its face": [Edit(1, 0, (0.75, 0.48, -0.08))],
        "a knee and a toe, both people": [Edit(0, 13, (0.15, 1.05, -0.1)), Edit(1, 17, (0.68, 1.4, -0.05))],
        "straight back": [Edit(0, 7, tuple(2 * people[0][5] - people[0][7]))],
        "a target on the parent": [Edit(1, 8, tuple(people[1][6]))],
        "the same joint twice": [Edit(1, 10, (0.95, 0.7, 0.0)), Edit(1, 10, (0.9, 0.6, 0.1))],
    }
    fixture = {
        "people": [p.round(6).tolist() for p in people],
        "cases": [],
    }
    base = [np.array(p) for p in fixture["people"]]
    for name, edits in cases.items():
        edits = [Edit(e.person, e.joint, tuple(round(float(v), 6) for v in e.to)) for e in edits]
        fixture["cases"].append({
            "name": name,
            "edits": [{"person": e.person, "joint": e.joint, "to": list(e.to)} for e in edits],
            "expected": [p.tolist() for p in apply_edits(base, edits)],
        })
    out = Path(__file__).resolve().parent.parent / "__tests__" / "fixtures" / "pose-bend.json"
    out.write_text(json.dumps(fixture) + "\n", encoding="utf-8")
    print(f"Wrote {len(fixture['cases'])} cases to {out.name}")


if __name__ == "__main__":
    main()
