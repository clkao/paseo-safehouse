import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createPaseoApi } from '@getpaseo/client';
import { client, home } from './live-client.mjs';
import { setup } from '../server/service.ts';
import { run, policyEnvironment, prepareSnapshot, resolvePolicy, hash } from '../server/policy.ts';
assert.ok(process.env.SAFEHOUSE_TEST_HOME, 'Use an allocated isolated daemon home');
process.env.PASEO_HOME = home;
const api = createPaseoApi(client), phase = process.argv[2];
const markerFile = path.resolve('.local/live-fixture-path');
await fs.mkdir(path.dirname(markerFile), { recursive: true });
if (phase === 'interrupt') await fs.writeFile(markerFile, await fs.mkdtemp(path.join(os.homedir(),'.safehouse-recovery-live-')));
assert.ok(['interrupt', 'retry'].includes(phase), 'Choose interrupt or retry');
const fixture = (await fs.readFile(markerFile,'utf8')).trim(), cwd = path.join(fixture,'workspace'), sibling = path.join(fixture,'sibling');
const evidence = path.join(fixture,'before.json');
await fs.mkdir(cwd,{recursive:true}); await fs.mkdir(sibling,{recursive:true});
const code = `const fs=require('node:fs');const r={};const a=(k,f)=>{try{r[k]=f()??'allowed'}catch(e){r[k]=e.code}};a('write',()=>fs.writeFileSync(${JSON.stringify(path.join(cwd,'allowed'))},'ok'));a('read',()=>fs.readFileSync(${JSON.stringify(path.join(cwd,'allowed'))},'utf8'));a('sibling',()=>fs.readFileSync(${JSON.stringify(path.join(sibling,'canary'))},'utf8'));a('siblingWrite',()=>fs.writeFileSync(${JSON.stringify(path.join(sibling,'marker'))},'bad'));console.log(JSON.stringify(r));`;
try {
  await client.connect();
  if (phase === 'interrupt') {
    await fs.writeFile(path.join(sibling,'canary'),'private');
    await api.config.patch({providers:{probe:{label:'Recovery probe',extends:'copilot',command:[process.execPath,'-e',code],env:{FIXTURE:'preserved'},models:[{id:'fixture',label:'Fixture'}]}}});
    const existing = JSON.parse(await fs.readFile(path.join(home,'safehouse/installation.json'),'utf8').catch(()=>'{}'));
    const before = Object.fromEntries(Object.entries((await api.config.get()).config.providers).filter(([id])=>!existing.entries?.[id]));
    await fs.writeFile(evidence,JSON.stringify(before));
    await setup(api); await setup(api);
    const old = JSON.parse(await fs.readFile(path.join(home,'safehouse/installation.json'),'utf8'));
    await fs.writeFile(path.join(fixture,'old.json'),JSON.stringify(old));
    const extension = path.join(fixture,'extension.ts'); await fs.writeFile(extension,'');
    const wrapped = {config:{get:api.config.get.bind(api.config),patch:async p=>{await api.config.patch(p);throw new Error('deliberately lost actual patch response');}}};
    await assert.rejects(setup(wrapped,{piCatalogExtensions:[extension]}),/deliberately lost actual patch response/);
    const pending = JSON.parse(await fs.readFile(path.join(home,'safehouse/setup-pending.json'),'utf8'));
    const current = (await api.config.get()).config.providers;
    for (const [id,entry] of Object.entries(pending.installation.entries)) assert.deepEqual(current[id],entry);
    console.log(JSON.stringify({phase,targets:Object.keys(pending.installation.entries),pendingDigest:pending.digest,oldGuard:hash(await fs.readFile(old.guard,'utf8')),applied:true}));
  } else {
    const pending = JSON.parse(await fs.readFile(path.join(home,'safehouse/setup-pending.json'),'utf8'));
    await setup(api); await setup(api);
    const saved = JSON.parse(await fs.readFile(path.join(home,'safehouse/installation.json'),'utf8'));
    const current = (await api.config.get()).config.providers;
    const before = JSON.parse(await fs.readFile(evidence,'utf8'));
    for(const [id,entry] of Object.entries(before)) assert.deepEqual(current[id],entry);
    assert.deepEqual(saved.entries,pending.installation.entries); assert.deepEqual(saved.sources,pending.installation.sources);
    for (const [id,entry] of Object.entries(saved.entries)) assert.deepEqual(current[id],entry);
    await assert.rejects(fs.access(path.join(home,'safehouse/setup-pending.json')));
    for(const f of pending.files) assert.equal(await fs.readFile(f.file,'utf8'),f.text);
    const snapshot = await prepareSnapshot(path.join(home,'safehouse'),await resolvePolicy('',cwd,[]));
    const command = saved.entries['probe-safehouse'].command;
    const sandbox = JSON.parse((await run(command[0],command.slice(1),{cwd,env:policyEnvironment(process.env,snapshot),timeout:45000})).stdout);
    assert.deepEqual(sandbox,{write:'allowed',read:'ok',sibling:'EPERM',siblingWrite:'EPERM'});
    const direct = JSON.parse((await run(process.execPath,['-e',code],{cwd})).stdout);
    assert.equal(direct.sibling,'private'); assert.equal(direct.siblingWrite,'allowed');
    console.log(JSON.stringify({phase,targets:Object.keys(saved.entries),sourcesPreserved:true,nativePreserved:true,files:pending.files.map(f=>({file:f.file,hash:hash(f.text)})),sandbox,direct}));
  }
} finally { await client.close(); }
