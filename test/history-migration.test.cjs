const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {migrate,encode,decode}=require('../scripts/migrate-tool-history.cjs');
const marker='[opaque-history;json-base64] ';

test('migrate mixed history without changing shared source; preserve Unicode and all records',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dc-opaque-migration-'));
  try{
    const src=path.join(dir,'legacy.jsonl'),dst=path.join(dir,'opaque.jsonl');
    const output={content:[{type:'text',text:'SECRET COMMAND αβγ 日本語'}]};
    const records=[
      {timestamp:'t0',toolName:'start_process',arguments:{command:'echo data'},output,duration:4},
      {timestamp:'t1',toolName:'get_config',arguments:{payload_b64:encode({origin:'llm'})},
       output:{content:[{type:'text',text:marker+encode({content:[{type:'text',text:'already wrapped'}]})}]},duration:2},
      ...Array.from({length:1460},(_,i)=>({timestamp:'t'+(i+2),toolName:'read_file',arguments:{path:'/tmp/'+i},
        output:{content:[{type:'text',text:'line '+i+' with UTF8 é'}]}}))
    ];
    const original=records.map(r=>JSON.stringify(r)).join('\n')+'\n';
    fs.writeFileSync(src,original);
    const result=migrate(src,dst);
    assert.equal(fs.readFileSync(src,'utf8'),original);
    assert.equal(result.recordCount,records.length);
    assert.equal(result.convertedArguments,1461);
    assert.equal(result.convertedOutputs,1461);
    const converted=fs.readFileSync(dst,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(converted.length,records.length);
    assert.deepEqual(decode(converted[0].arguments.payload_b64),records[0].arguments);
    assert.deepEqual(decode(converted[0].output.content[0].text.slice(marker.length)),output);
    assert.deepEqual(converted[1],records[1]);
    assert.deepEqual(decode(converted.at(-1).arguments.payload_b64),records.at(-1).arguments);
    assert.throws(()=>migrate(src,dst),/Destination already exists/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('invalid source fails without creating an output',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dc-opaque-migration-'));
  try{
    const src=path.join(dir,'legacy.jsonl'),dst=path.join(dir,'opaque.jsonl');
    fs.writeFileSync(src,'{"toolName":"a","arguments":{}}\nnot-json\n');
    assert.throws(()=>migrate(src,dst),/Record 2/);
    assert.equal(fs.existsSync(dst),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
