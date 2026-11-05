// Isolated staging RPC simulator. No wallet, keys, network broadcast or disk writes.
import http from 'node:http';
const ADDRESS=/^F[1-9A-HJ-NP-Za-km-z]{20,80}$/;
const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/') {res.writeHead(404);res.end();return;}
  let raw='';
  try{
    for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('Too large');}
    const msg=JSON.parse(raw);
    let result;
    if(msg.method==='validateaddress')result={isvalid:typeof msg.params?.[0]==='string'&&ADDRESS.test(msg.params[0])};
    else if(msg.method==='getbalance')result=0;
    else {res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({result:null,error:{code:-32601,message:'Method blocked in mock Core'},id:msg.id??null}));return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({result,error:null,id:msg.id??null}));
  }catch{res.writeHead(400);res.end();}
});
server.listen(16664,'127.0.0.1',()=>console.log('Mock Core listening on loopback 16664; broadcast forbidden'));
