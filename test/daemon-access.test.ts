import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import * as service from '../server/service';
import { daemonAccessRpc } from '../shared/contracts';
import { hash, run, policyEnvironment, findExecutable } from '../server/policy';

test('default-home wildcard listener retains its local TCP port restriction', () => {
  const metadata = {listen:'0.0.0.0:47689'};
  assert.equal(service.defaultDaemonPort(metadata.listen),47689);
  assert.equal(service.defaultDaemonPort('[::]:47689'),47689);
  assert.equal(service.defaultDaemonPort('/tmp/paseo.sock'),null);
});

test('workspace daemon choice is atomic, independent and snapshot-bound', { skip: process.platform !== 'darwin' }, async t => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.homedir(), '.safehouse-access-')));
  const home = path.join(base, 'home'), cwd = path.join(base, 'workspace'), other = path.join(base, 'other');
  for (const dir of [home, cwd, other]) await fs.mkdir(dir);
  const oldHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  t.after(async () => { if (oldHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = oldHome; await fs.rm(base, {recursive:true,force:true}); });
  const listener = net.createServer(socket => socket.end());
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); t.after(() => listener.close());
  const port = (listener.address() as net.AddressInfo).port;
  const ipv6 = net.createServer(socket => socket.end());
  ipv6.listen(port, '::1'); await once(ipv6, 'listening'); t.after(() => ipv6.close());
  const socketPath = path.join(home, 'test.sock'), unix = net.createServer(socket => socket.end());
  unix.listen(socketPath); await once(unix, 'listening'); t.after(() => unix.close());
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({daemon:{listen:`127.0.0.1:${port}`},plugins:{'paseo-safehouse':{path:process.cwd()}}}));
  let config: any = {providers:{probe:{extends:'acp',command:[process.execPath],paseoTools:{enabled:true}}}};
  const paseo: any = {config:{get:async()=>({config}),patch:async(p:any)=>{config={...config,providers:{...config.providers,...p.providers}};}},workspaces:{ref:(id:string)=>({refresh:async()=>({workspaceDirectory:id})})},agents:{list:async()=>({entries:[{agent:{id:'agent',provider:'safehouse-probe',workspaceId:cwd}}]})}};
  await service.setup(paseo);
  const opening = (dir=cwd):any => ({agentId:dir===cwd?'agent':'other',provider:'safehouse-probe',cwd:dir,reason:'create',env:{PASEO_HOME:'/untrusted',PASEO_TOKEN:'bad'},tools:[],mcpServers:{}});
  assert.throws(() => daemonAccessRpc.input.parse({workspaceId:cwd,enabled:'true',revision:''}));
  const before = await service.status(paseo,cwd);
  assert.equal((before as any).daemonAccess,false);
  const off = await service.prepareOpening(opening(),paseo);
  const launch = config.providers['safehouse-probe'].command;
  const probe = `const net=require('node:net');const s=net.connect(${port},'127.0.0.1');s.on('connect',()=>{console.log('allowed');s.destroy()});s.on('error',e=>console.log(e.code));`;
  const execute = async(env:any,script=probe) => (await run(launch[0],[...launch.slice(1),'-e',script],{cwd,env:{...process.env,...env},timeout:45000})).stdout.trim();
  assert.equal(await execute(off.env),'EPERM');
  const native = async(script:string, args:string[] = []) => (await run((await findExecutable('safehouse'))!,
    ['--workdir',cwd,...args,'--',process.execPath,'-e',script],{cwd,env:policyEnvironment(process.env,''),timeout:45000})).stdout.trim();
  assert.equal(await native(probe),'allowed'); // No home grant or credentials.
  const socketProbe = probe.replace(`${port},'127.0.0.1'`,JSON.stringify(socketPath));
  assert.equal(await native(socketProbe),'EPERM');
  const profile = path.join(cwd,'socket.sb');
  await fs.writeFile(profile,`(allow network-outbound (remote unix-socket (path-literal ${JSON.stringify(socketPath)})))`);
  assert.equal(await native(socketProbe,[`--add-dirs=${home}`,'--append-profile',profile]),'allowed');
  const save = (service as any).setDaemonAccess;
  await service.setWorkspaceRouting(paseo,cwd,false);
  const routing = await fs.readFile(path.join(home,'safehouse','workspaces',`${hash(cwd)}.json`),'utf8');
  const results = await Promise.allSettled([save(paseo,cwd,true,(before as any).daemonAccessRevision),save(paseo,cwd,true,(before as any).daemonAccessRevision)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
  assert.equal(await fs.readFile(path.join(home,'safehouse','workspaces',`${hash(cwd)}.json`),'utf8'),routing);
  await assert.rejects(fs.stat(path.join(cwd,'.safehouse')),{code:'ENOENT'});
  assert.equal((await service.status(paseo,other) as any).daemonAccess,false);
  assert.equal((await service.status(paseo,cwd)).agents[0].changed,true);
  assert.equal(await execute(off.env),'EPERM');
  await fs.writeFile(path.join(cwd,'.safehouse'),`add-dirs=${home}\nappend-profile=${profile}\n`);
  const on = await service.prepareOpening(opening(),paseo);
  assert.equal(await execute(on.env),'allowed');
  for (const transport of [probe.replace('127.0.0.1','localhost'),probe.replace('127.0.0.1','::1'),socketProbe])
    assert.equal(await execute(on.env,transport),'allowed');
  assert.equal(on.env.PASEO_HOME,home); assert.equal(on.env.PASEO_TOKEN,'');
  assert.equal(await execute(on.env,'console.log(process.env.PASEO_HOME)'),home);
  assert.equal((await service.status(paseo,cwd)).agents[0].changed,false);
  assert.equal(config.providers['safehouse-probe'].paseoTools.enabled,false);
  assert.equal(config.providers.probe.paseoTools.enabled,true);
  const record = path.join(home,'safehouse','workspaces',`${hash(cwd)}.daemon-access.json`);
  const receiptFile = service.receiptPath('agent');
  const receipt = JSON.parse(await fs.readFile(receiptFile,'utf8'));
  const legacy = {...receipt}; delete legacy.daemonAccess;
  await fs.writeFile(receiptFile,JSON.stringify(legacy));
  const unknown = (await service.status(paseo,cwd)).agents[0];
  assert.equal(unknown.daemonAccess,null); assert.equal(unknown.changed,true);
  await fs.writeFile(receiptFile,JSON.stringify(receipt));
  const protectedProbe = `try{require('node:fs').writeFileSync(${JSON.stringify(record)},'bad');console.log('allowed')}catch(e){console.log(e.code)}`;
  assert.equal(await execute(on.env,protectedProbe),'EPERM');
  assert.equal(await execute(policyEnvironment(process.env,path.join(home,'safehouse','catalog'))),'EPERM');
  const saved = await service.status(paseo,cwd);
  await save(paseo,cwd,false,(saved as any).daemonAccessRevision);
  assert.equal((await service.status(paseo,cwd)).agents[0].changed,true);
  assert.equal(await execute(on.env),'allowed');
  const denied = await service.prepareOpening(opening(),paseo);
  for (const transport of [probe,probe.replace('127.0.0.1','localhost'),probe.replace('127.0.0.1','::1'),socketProbe])
    assert.equal(await execute(denied.env,transport),'EPERM');
  const writes = [record,path.join(cwd,'.safehouse'),profile,path.join(on.env.SAFEHOUSE_WORKDIR,'.safehouse')];
  const boundary = `const fs=require('node:fs');console.log(JSON.stringify(${JSON.stringify(writes)}.map(p=>{try{fs.writeFileSync(p,'bad');return 'allowed'}catch(e){return e.code}})))`;
  const privateFile = path.join(other,'private'); await fs.writeFile(privateFile,'private');
  const io = `const fs=require('node:fs');fs.writeFileSync('allowed','ok');try{fs.readFileSync(${JSON.stringify(privateFile)});console.log('allowed')}catch(e){console.log(e.code)}`;
  for (const env of [on.env,denied.env]) {
    assert.deepEqual(JSON.parse(await execute(env,boundary)),writes.map(()=>'EPERM'));
    assert.equal(await execute(env,io),'EPERM');
    assert.equal(await fs.readFile(path.join(cwd,'allowed'),'utf8'),'ok');
  }
  assert.equal(await execute((await service.prepareOpening(opening(other),paseo)).env),'EPERM');
  const valid = await fs.readFile(record,'utf8');
  await fs.chmod(record,0); await assert.rejects(service.prepareOpening(opening(),paseo),/daemon access/i); await fs.chmod(record,0o600);
  await fs.rm(record); await fs.symlink(path.join(home,'missing'),record);
  await assert.rejects(service.prepareOpening(opening(),paseo),/daemon access/i);
  await fs.rm(record); await fs.writeFile(record,valid);
  for (const contents of ['invalid' , JSON.stringify({cwd:other,enabled:true}), JSON.stringify({cwd,enabled:'true'})]) {
    await fs.writeFile(record,contents);
    await assert.rejects(service.prepareOpening(opening(),paseo),/daemon access/i);
  }
});
