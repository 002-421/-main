import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {compareVersions,isUpdateAvailable}=require('../electron/update-version.cjs');

test('forward rollback release numbers are normal monotonic updates',()=>{
 assert.equal(compareVersions('0.4.55','0.4.54'),1);
 assert.equal(isUpdateAvailable('0.4.55','0.4.54'),true);
 assert.equal(isUpdateAvailable('0.4.53','0.4.54'),false);
 assert.equal(isUpdateAvailable('0.4.54','0.4.54'),false);
 assert.equal(isUpdateAvailable('0.4.x','0.4.54'),false);
});
