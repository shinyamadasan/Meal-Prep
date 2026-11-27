// TASK-092: the household calendar day (HOUSEHOLD_TIME_ZONE, PROP-041 owner decision 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { householdDay, householdDayFromEnv } from '../src/householdDay.js';
import { InfrastructureError } from '../src/firestore.js';

test('Asia/Manila (UTC+8) turns the day at 16:00 UTC, not at UTC midnight', () => {
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-11-26T15:59:59.999Z')), '2026-11-26');
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-11-26T16:00:00.000Z')), '2026-11-27');
  // Between 16:00 and 24:00 UTC the UTC date is a day behind the household's.
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-11-26T23:59:59Z')), '2026-11-27');
  assert.equal(householdDay('UTC', Date.parse('2026-11-26T23:59:59Z')), '2026-11-26');
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-11-26T00:00:00Z')), '2026-11-26');
});

test('month end, year end and leap day roll over on the household calendar', () => {
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-12-31T16:00:00Z')), '2027-01-01');
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-12-31T15:59:59Z')), '2026-12-31');
  assert.equal(householdDay('Asia/Manila', Date.parse('2028-02-28T16:00:00Z')), '2028-02-29');
  assert.equal(householdDay('Asia/Manila', Date.parse('2028-02-29T16:00:00Z')), '2028-03-01');
  assert.equal(householdDay('Asia/Manila', Date.parse('2026-11-30T16:30:00Z')), '2026-12-01');
});

test('the clock is injectable as a Date or epoch milliseconds', () => {
  const instant = Date.parse('2027-01-15T08:00:00Z');
  assert.equal(householdDay('Asia/Manila', instant), '2027-01-15');
  assert.equal(householdDay('Asia/Manila', new Date(instant)), '2027-01-15');
  assert.equal(householdDayFromEnv({ HOUSEHOLD_TIME_ZONE: 'Asia/Manila' }, () => new Date('2027-01-15T16:00:00Z')), '2027-01-16');
  assert.equal(householdDayFromEnv({ HOUSEHOLD_TIME_ZONE: 'Asia/Manila' }, () => Date.parse('2027-01-15T15:00:00Z')), '2027-01-15');
});

test('a missing, empty or invalid zone, or an invalid clock, fails closed instead of guessing a day', () => {
  for (const zone of [undefined, null, '', '   ', 'Mars/Olympus_Mons', 'GMT+99', 42]) {
    assert.throws(() => householdDay(zone, Date.parse('2026-11-26T00:00:00Z')), InfrastructureError, String(zone));
  }
  assert.throws(() => householdDayFromEnv({}, () => Date.now()), InfrastructureError);
  assert.throws(() => householdDayFromEnv(undefined), InfrastructureError);
  for (const clock of [NaN, Infinity, 'now', new Date('not a date')]) {
    assert.throws(() => householdDay('Asia/Manila', clock), InfrastructureError, String(clock));
  }
});

test('wrangler.jsonc sets HOUSEHOLD_TIME_ZONE to Asia/Manila as a plain var', () => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const vars = text.match(/"vars"\s*:\s*\{([^}]*)\}/);
  assert.ok(vars, 'wrangler.jsonc has a vars block');
  assert.match(vars[1], /"HOUSEHOLD_TIME_ZONE"\s*:\s*"Asia\/Manila"/);
  assert.equal(householdDay('Asia/Manila', 0), '1970-01-01');
});
