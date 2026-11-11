import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export function save(file,value,{exclusive=false}={}){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(exclusive&&fs.existsSync(file))throw new Error('Journal already exists; resume it');
  const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  try{fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
}
export function read(file){const stat=fs.lstatSync(file);if(!stat.isFile()||(stat.mode&0o077))throw new Error('Journal must be an owner-only regular file');const j=JSON.parse(fs.readFileSync(file,'utf8'));if(j.version!==1)throw new Error('Unknown journal version');return j}
export async function locked(file,fn){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  let fd;try{fd=fs.openSync(file+'.lock','wx',0o600)}catch{throw new Error('Journal locked; another process or interrupted run needs attention')}
  try{fs.writeFileSync(fd,String(process.pid));return await fn()}finally{fs.closeSync(fd);fs.unlinkSync(file+'.lock')}
}
