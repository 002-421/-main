import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_UPDATE_CHECK_INTERVAL_MS, isAutomaticUpdateCheckDue } from '../src/update-schedule.ts';

test('automatic update checks are due at most once every twelve hours', () => {
  const now = 1_800_000_000_000;
  assert.equal(isAutomaticUpdateCheckDue(undefined, now), true);
  assert.equal(isAutomaticUpdateCheckDue(now, now + AUTO_UPDATE_CHECK_INTERVAL_MS - 1), false);
  assert.equal(isAutomaticUpdateCheckDue(now, now + AUTO_UPDATE_CHECK_INTERVAL_MS), true);
  assert.equal(isAutomaticUpdateCheckDue('invalid', now), true);
});
