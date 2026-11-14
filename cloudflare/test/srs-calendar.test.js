import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleWord, reviewBank} from '../../lib/practice.js';
const attempt = (created_at, extra={}) => ({word:'light',word_id:1,list_id:1,mode:'test',step:0,correct:false,first_try:true,created_at,...extra});
test('review intervals cross leap day, year boundary, and DST using UTC dates', () => {
  assert.equal(scheduleWord(undefined,attempt('2028-02-28T23:59:59.999Z')).due,'2028-02-29');
  assert.equal(scheduleWord(undefined,attempt('2026-12-31T23:59:59.999Z')).due,'2027-01-01');
  assert.equal(scheduleWord(undefined,attempt('2026-03-08T01:30:00-08:00')).due,'2026-03-09');
  const due = scheduleWord(undefined,attempt('2026-11-14T23:59:59.999Z'));
  assert.equal(reviewBank([due],'2026-11-14T23:59:59.999Z').due.length,0);
  assert.equal(reviewBank([due],'2026-11-15T00:00:00.000Z').due.length,1);
});
