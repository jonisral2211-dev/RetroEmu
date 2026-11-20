// Espejo JS de LibretroPatch.hpp + encoders independientes para generar parches de prueba
const assert = require('assert');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}let crc=0xFFFFFFFF;for(const b of buf)crc=(t[(crc^b)&0xFF]^(crc>>>8))>>>0;return (crc^0xFFFFFFFF)>>>0;}
const le32=(n)=>Buffer.from([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
function varintEnc(v){const out=[];for(;;){const x=v%128;v=Math.floor(v/128);if(v===0){out.push(0x80|x);break;}out.push(x);v-=1;}return out;}
function Reader(data,limit,pos){return{data,limit,pos,ok:true,byte(){if(this.pos>=this.limit){this.ok=false;return 0;}return this.data[this.pos++];},varint(){let value=0,shift=1;for(;;){const x=this.byte();if(!this.ok)return 0;value+=(x&0x7f)*shift;if(x&0x80)break;shift*=128;value+=shift;}return value;}};}
function applyIps(p,rom){if(p.length<8||p.toString('latin1',0,5)!=='PATCH')throw'no IPS';let pos=5;const end=p.length;for(;;){if(pos+3>end)throw'IPS incompleto';if(p.toString('latin1',pos,pos+3)==='EOF'){pos+=3;break;}const off=(p[pos]<<16)|(p[pos+1]<<8)|p[pos+2];pos+=3;const size=(p[pos]<<8)|p[pos+1];pos+=2;if(size===0){const run=(p[pos]<<8)|p[pos+1];const v=p[pos+2];pos+=3;if(off+run>rom.length)rom=Buffer.concat([rom,Buffer.alloc(off+run-rom.length)]);rom.fill(v,off,off+run);}else{if(pos+size>end)throw'IPS incompleto';if(off+size>rom.length)rom=Buffer.concat([rom,Buffer.alloc(off+size-rom.length)]);p.copy(rom,off,pos,pos+size);pos+=size;}}if(pos+3<=end){const ns=(p[pos]<<16)|(p[pos+1]<<8)|p[pos+2];rom=ns<=rom.length?rom.subarray(0,ns):Buffer.concat([rom,Buffer.alloc(ns-rom.length)]);}return rom;}
function applyBps(p,src){if(p.length<19||p.toString('latin1',0,4)!=='BPS1')throw'no BPS';const total=p.length;const srcCrc=p.readUInt32LE(total-12),tgtCrc=p.readUInt32LE(total-8);if(crc32(src)!==srcCrc)throw'CRC origen BPS';const r=Reader(p,total-12,4);const srcSize=r.varint(),tgtSize=r.varint(),meta=r.varint();if(srcSize!==src.length||r.pos+meta>r.limit)throw'cabecera BPS';r.pos+=meta;const out=Buffer.alloc(tgtSize);let outOff=0,srcRel=0,tgtRel=0;while(r.pos<r.limit){const data=r.varint();if(!r.ok)break;const cmd=data&3,len=Math.floor(data/4)+1;if(outOff+len>tgtSize)throw'acción BPS fuera';if(cmd===0){for(let i=0;i<len;i++){const s=outOff+i;out[s]=s<src.length?src[s]:0;}}else if(cmd===1){if(r.pos+len>r.limit)throw'BPS truncado';p.copy(out,outOff,r.pos,r.pos+len);r.pos+=len;}else if(cmd===2){const d=r.varint();const delta=(d&1)?-Math.floor(d/2):Math.floor(d/2);srcRel+=delta;for(let i=0;i<len;i++){if(srcRel<0||srcRel>=src.length)throw'ref src';out[outOff+i]=src[srcRel];srcRel++;}}else{const d=r.varint();const delta=(d&1)?-Math.floor(d/2):Math.floor(d/2);tgtRel+=delta;for(let i=0;i<len;i++){if(tgtRel<0||tgtRel>=tgtSize)throw'ref tgt';out[outOff+i]=out[tgtRel];tgtRel++;}}outOff+=len;}if(outOff!==tgtSize||crc32(out)!==tgtCrc)throw'CRC destino BPS';return out;}
function applyUps(p,src){if(p.length<18||p.toString('latin1',0,4)!=='UPS1')throw'no UPS';const total=p.length;const srcCrc=p.readUInt32LE(total-12),tgtCrc=p.readUInt32LE(total-8);if(crc32(src)!==srcCrc)throw'CRC origen UPS';const r=Reader(p,total-12,4);const srcSize=r.varint(),tgtSize=r.varint();if(srcSize!==src.length)throw'cab UPS';const out=Buffer.alloc(tgtSize);src.copy(out,0,0,Math.min(src.length,tgtSize));let off=0;while(r.pos<r.limit){off+=r.varint();if(!r.ok)throw'UPS trunc';for(;;){const x=r.byte();if(!r.ok)throw'UPS trunc';if(x===0)break;if(off>=tgtSize)throw'ref UPS';out[off]^=x;off++;}off++;}if(crc32(out)!==tgtCrc)throw'CRC destino UPS';return out;}

// ---- datos de prueba
const rom=Buffer.from([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
const target=Buffer.from([0,1,0xAA,0xBB,0x11,0x11,0x11,7,8,9,10,11,12,13,14,15,0xCC,0xDD]);
// IPS: registro normal + RLE + extensión (truncate/crecimiento incluido)
const ipsBody=Buffer.concat([Buffer.from('PATCH'),Buffer.from([0,0,2,0,2,0xAA,0xBB]),Buffer.from([0,0,4,0,0,0,3,0x11]),Buffer.from([0,0,16,0,2,0xCC,0xDD]),Buffer.from('EOF')]);
let res=applyIps(ipsBody,Buffer.from(rom));
assert.deepStrictEqual(res,target,'IPS');
// IPS truncado debe fallar
assert.throws(()=>applyIps(ipsBody.subarray(0,ipsBody.length-6),Buffer.from(rom)),/incompleto|no IPS/);
// IPS con truncado final (recorta a 8 bytes)
const ipsTrunc=Buffer.concat([Buffer.from('PATCH'),Buffer.from('EOF'),Buffer.from([0,0,8])]);
assert.strictEqual(applyIps(ipsTrunc,Buffer.from(rom)).length,8,'IPS truncate');
console.log('IPS ok');

// BPS: SourceRead(2) TargetRead(AA BB) SourceRead(12 de pos 4) TargetRead(CC DD) — target completo con 0x11 no aplica aquí
const tgtB=Buffer.from([0,1,0xAA,0xBB,...rom.subarray(4),0xCC,0xDD]);
const acts=[];
acts.push(...varintEnc(((2-1)<<2)|0));
acts.push(...varintEnc(((2-1)<<2)|1),0xAA,0xBB);
acts.push(...varintEnc(((12-1)<<2)|0));
acts.push(...varintEnc(((2-1)<<2)|1),0xCC,0xDD);
const bpsBody=Buffer.concat([Buffer.from('BPS1'),Buffer.from(varintEnc(rom.length)),Buffer.from(varintEnc(tgtB.length)),Buffer.from(varintEnc(0)),Buffer.from(acts),le32(crc32(rom)),le32(crc32(tgtB)),le32(0)]);
assert.deepStrictEqual(applyBps(bpsBody,Buffer.from(rom)),tgtB,'BPS');
// BPS con ROM distinta debe fallar por CRC
assert.throws(()=>applyBps(bpsBody,Buffer.from(rom).fill(1)),/CRC origen/);
console.log('BPS ok');

// BPS SourceCopy con retroceso: copia bytes 0..3 desde origen tras escribir literal
const tgt2=Buffer.from([0xEE,1,2,3]);
const acts2=[...varintEnc(((1-1)<<2)|1),0xEE,...varintEnc(((3-1)<<2)|2),...varintEnc(2)]; // SourceCopy desde src pos 1 (rel +1 desde 0 => offset 1: d=2 => +1)
// srcRel empieza en 0; d=2 => +1 => pos 1 => copia 1,2,3? (len=3) -> 1,2,3
const bps2=Buffer.concat([Buffer.from('BPS1'),Buffer.from(varintEnc(rom.length)),Buffer.from(varintEnc(4)),Buffer.from(varintEnc(0)),Buffer.from(acts2),le32(crc32(rom)),le32(crc32(tgt2)),le32(0)]);
assert.deepStrictEqual(applyBps(bps2,Buffer.from(rom)),tgt2,'BPS SourceCopy');
console.log('BPS copy ok');

// UPS: XOR en 2..3 con 0x05,0x06; en 16..17 con 0x01 0x02 (origen 0)
// Target = rom XOR delta
const tgtU=Buffer.alloc(18);rom.copy(tgtU);tgtU[2]^=0x05;tgtU[3]^=0x06;tgtU[16]=0x01;tgtU[17]=0x02;
const recs=[];
// run 1: a=2,b=3 -> rel 2-0=2, bytes, 0; cursor=b+2=5
recs.push(...varintEnc(2),0x05,0x06,0x00);
// run 2: a=16,b=17 -> rel 16-5=11; bytes xor against origen (0 más allá de 16)
recs.push(...varintEnc(11),0x01,0x02,0x00);
const upsBody=Buffer.concat([Buffer.from('UPS1'),Buffer.from(varintEnc(rom.length)),Buffer.from(varintEnc(18)),Buffer.from(recs),le32(crc32(rom)),le32(crc32(tgtU)),le32(0)]);
assert.deepStrictEqual(applyUps(upsBody,Buffer.from(rom)),tgtU,'UPS');
console.log('UPS ok');
// UPS con CRC de destino incorrecto debe fallar
const badUps=Buffer.from(upsBody);badUps.writeUInt32LE(0x12345678,badUps.length-8);
assert.throws(()=>applyUps(badUps,Buffer.from(rom)),/CRC destino UPS/);
console.log('UPS CRC guard ok');
console.log('TODOS LOS TESTS PASAN');
