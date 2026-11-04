// Rasterize the existing Android launcher's rectangular paths, without a new
// logo, external renderer, font, network dependency or image-generation call.
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const xml = await readFile(new URL('../android/app/src/main/res/mipmap-anydpi/ic_launcher.xml',import.meta.url),'utf8');
const rectangles = [...xml.matchAll(/fillColor="#([A-Fa-f0-9]{6})" android:pathData="([^"]+)"/g)].flatMap(([,color,path])=>
  [...path.matchAll(/M(\d+),(\d+)h(\d+)v(\d+)h-\d+z/g)].map(([,x,y,w,h])=>({x:+x,y:+y,w:+w,h:+h,color:Buffer.from(color,'hex')})));
if(rectangles.length!==6) throw new Error('Review launcher shape before regenerating icons.');
function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0; }
function chunk(type,bytes){const data=Buffer.concat([Buffer.from(type),bytes]),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(data));return Buffer.concat([length,data,crc]);}
for(const size of [192,512]){
  const pixels=Buffer.alloc((size*3+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=(x+.5)*108/size,py=(y+.5)*108/size;
    const rect=rectangles.findLast(r=>px>=r.x&&px<r.x+r.w&&py>=r.y&&py<r.y+r.h);
    rect.color.copy(pixels,y*(size*3+1)+1+x*3);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  await writeFile(new URL(`../public/icon-${size}.png`,import.meta.url),png);
}
console.log('PWA_ICONS_FROM_EXISTING_ANDROID_LAUNCHER');
