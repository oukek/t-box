import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSystemVersions, nextSystemVersion, parseSystemVersion } from '../packages/app-contracts/src/system-version.ts'

test('versions compare each segment numerically without a precision limit', () => {
  const ordered = ['0.0.0', '1.1.9', '1.1.10', '1.1.15', '1.9.99', '1.10.0', '9.99.99', '10.0.0', '12.15.103', '12.15.9007199254740992', '12.15.9007199254740993']
  for (const [i, left] of ordered.entries()) {
    for (const [j, right] of ordered.entries()) {
      assert.equal(compareSystemVersions(left, right), Math.sign(i - j))
    }
  }
})

test('only canonical three-part release versions are accepted', () => {
  for (const value of [null, 1, '', ' 1.1.0', '1.1.0\n', '01.2.3', '1.02.3', '1.2.03', 'v1.2.3', '1.2', '1.2.3.4', '-1.2.3', '1.2.3-beta', '1.2.3+build']) {
    assert.throws(() => parseSystemVersion(value))
  }
})

test('automatic increments reset only lower segments and manual assignments strictly advance', () => {
  assert.equal(nextSystemVersion('1.1.9', 'patch'), '1.1.10')
  assert.equal(nextSystemVersion('1.19.123', 'minor'), '1.20.0')
  assert.equal(nextSystemVersion('19.19.123', 'major'), '20.0.0')
  assert.equal(nextSystemVersion('1.1.9', 'manual', '1.1.15'), '1.1.15')
  for (const target of [undefined, '1.1.08', '1.1.9', '1.1.8']) {
    assert.throws(() => nextSystemVersion('1.1.9', 'manual', target))
  }
})
