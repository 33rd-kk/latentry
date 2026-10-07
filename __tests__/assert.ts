// The smallest harness that does the job: count, report, exit non-zero on a miss.

let passed = 0
let failed = 0

export function check(condition: boolean, label: string): void {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL: ${label}`)
  }
}

export function eq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`)
  }
}

/**
 * A known gap from an audit, pinned as it is today. `wanted` is the behaviour
 * we want; while it is false the gap is reported and counts as a pass, so CI
 * stays green. Once a fix makes it true this fails, and the fix turns the
 * call into a plain check().
 */
export function knownGap(wanted: boolean, id: string, label: string): void {
  if (wanted) {
    failed += 1
    console.error(`FAIL: ${id} looks fixed, make it a check(): ${label}`)
  } else {
    passed += 1
    console.log(`KNOWN GAP ${id}: ${label}`)
  }
}

export function done(name: string): void {
  console.log(`${name}: ${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
