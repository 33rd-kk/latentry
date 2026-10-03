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

export function done(name: string): void {
  console.log(`${name}: ${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}
