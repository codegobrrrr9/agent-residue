const fs=require('fs');
const edit=(p,pairs)=>{let s=fs.readFileSync(p,'utf8');for(const [a,b,all] of pairs){if(!s.includes(a))throw new Error(p+' missing: '+a.slice(0,60));s=all?s.split(a).join(b):s.replace(a,()=>b)}fs.writeFileSync(p,s)};
edit('tests/helpers.js',[["sessionId: 's1', ",'',true]]);
edit('tests/scan.test.js',[
["assert.ok(real && !iso.home.startsWith(real), 'the temp home is outside the real home');","assert.ok(real && iso.home.toLowerCase().startsWith(tmpdir().toLowerCase()), 'the temp home is under the temp dir');"],
["import { join } from 'node:path';","import { join } from 'node:path';\nimport { tmpdir } from 'node:os';"],
["'{\"type\":\"user\",\"message\":{\"content\":\"' + bad + '\"', '{not json ' + bad + '\n']","'{\"type\":\"user\",\"message\":{\"content\":\"' + bad + '\"\n', '{not json ' + bad + '\n']"],
["assert.equal(commandHead('FOO=' + K.password(7) + ' node server.js'), 'node server.js');","assert.equal(commandHead('FOO=' + K.password(7) + ' node server.js'), 'node');"]]);
