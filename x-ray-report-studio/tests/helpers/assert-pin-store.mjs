import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
/** Check the storage contract rather than searching random hash substrings. */
export function assertHashedPin(raw,pin){
 const record=JSON.parse(raw);
 assert.deepEqual(Object.keys(record).sort(),['attempts','hash','lastObservedAt','lockedUntil','salt','schemaVersion']);
 assert.equal(record.schemaVersion,1);
 assert.match(record.salt,/^[a-f0-9]{32}$/);
 assert.match(record.hash,/^[a-f0-9]{64}$/);
 assert.equal(record.hash,scryptSync(pin,record.salt,32).toString('hex'));
 assert.ok(!Object.values(record).includes(pin),'PIN is never stored as a plaintext value');
}
