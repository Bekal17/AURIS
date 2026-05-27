import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#000;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;}</style>
</head><body><canvas id="c"></canvas><script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const SIZE=Math.min(window.innerWidth,window.innerHeight);
canvas.width=SIZE;canvas.height=SIZE;
const W=SIZE,H=SIZE,cx=W/2,cy=H/2,S=SIZE/340;
let t=0,state='idle',targetSpread=0,currentSpread=0;
window.addEventListener('message',e=>{try{const d=JSON.parse(e.data);if(d.state)setState(d.state);}catch(err){}});
document.addEventListener('message',e=>{try{const d=JSON.parse(e.data);if(d.state)setState(d.state);}catch(err){}});
function setState(s){state=s;targetSpread=s==='idle'?0:s==='listening'?1:0.6;}
const rings=[{count:180,baseR:95*S,sizeRange:[1.2*S,3.2*S],spreadMult:1.0},{count:200,baseR:105*S,sizeRange:[1.0*S,2.6*S],spreadMult:1.3},{count:160,baseR:115*S,sizeRange:[0.8*S,2.2*S],spreadMult:1.7}];
const particles=[];
rings.forEach(ring=>{for(let i=0;i<ring.count;i++){const ba=(i/ring.count)*Math.PI*2+(Math.random()-0.5)*0.04;particles.push({baseAngle:ba,baseR:ring.baseR+(Math.random()-0.5)*6*S,angle:ba,r:ring.baseR,x:0,y:0,size:ring.sizeRange[0]+Math.random()*(ring.sizeRange[1]-ring.sizeRange[0]),speed:0.002+Math.random()*0.004,drift:(Math.random()-0.5)*0.015,phase:Math.random()*Math.PI*2,brightness:0.3+Math.random()*0.7,spreadDir:Math.random()<0.5?-(0.5+Math.random()*0.5):(0.5+Math.random()*0.5),spreadPhase:Math.random()*Math.PI*2,spreadMult:ring.spreadMult});}});
let lx=0,ly=0,vx=0,vy=0,tlx=0,tly=0,lt=0,nl=0.8+Math.random()*1.2;
let bt=0,bl=false,bp=0,nb=2+Math.random()*3;
function draw(){
ctx.clearRect(0,0,W,H);
currentSpread+=(targetSpread-currentSpread)*0.035;
const ib=Math.sin(t*0.6)*25*S;
particles.forEach(p=>{
p.angle+=p.speed+p.drift*0.08;
const im=ib*p.spreadDir*0.5+Math.sin(t*0.9+p.phase)*15*S*p.spreadDir;
const as=currentSpread*p.spreadDir*p.spreadMult*(90*S+Math.sin(t*0.7+p.spreadPhase)*30*S);
const spk=state==='speaking'?Math.sin(t*9+p.baseAngle*4)*35*S*currentSpread:0;
p.r=p.baseR+im*(1-currentSpread*0.6)+as+spk;
p.x=cx+Math.cos(p.angle)*p.r;p.y=cy+Math.sin(p.angle)*p.r;});
particles.forEach(p=>{
const dist=Math.abs(p.r-p.baseR);
const alpha=p.brightness*(0.3+currentSpread*0.4+Math.sin(t*1.8+p.phase)*0.15);
const sz=p.size*(0.6+currentSpread*0.7+dist/100);
const gv=Math.floor(160+p.brightness*95);const bv=Math.floor(20+p.brightness*40);
ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.5,sz*2.2),0,Math.PI*2);ctx.fillStyle='rgba(0,'+gv+','+bv+','+(Math.min(1,alpha)*0.22)+')';ctx.fill();
ctx.beginPath();ctx.arc(p.x,p.y,Math.max(0.5,sz),0,Math.PI*2);ctx.fillStyle='rgba(0,'+gv+','+bv+','+Math.min(1,alpha)+')';ctx.fill();
if(p.brightness>0.75){ctx.beginPath();ctx.arc(p.x,p.y,sz*4,0,Math.PI*2);ctx.fillStyle='rgba(0,255,65,'+(alpha*0.07)+')';ctx.fill();}});
const ig=ctx.createRadialGradient(cx,cy,55*S,cx,cy,110*S);
ig.addColorStop(0,'rgba(0,0,0,0)');ig.addColorStop(0.6,'rgba(0,'+Math.floor(60+currentSpread*80)+',15,0.07)');ig.addColorStop(1,'rgba(0,0,0,0)');
ctx.beginPath();ctx.arc(cx,cy,110*S,0,Math.PI*2);ctx.fillStyle=ig;ctx.fill();
const bg=ctx.createRadialGradient(cx-18*S,cy-20*S,5*S,cx,cy,83*S);
bg.addColorStop(0,'#152a18');bg.addColorStop(0.4,'#0a1a0c');bg.addColorStop(0.8,'#050e06');bg.addColorStop(1,'#020604');
ctx.beginPath();ctx.arc(cx,cy,83*S,0,Math.PI*2);ctx.fillStyle=bg;ctx.fill();
const rim=ctx.createRadialGradient(cx,cy,78*S,cx,cy,88*S);
rim.addColorStop(0,'rgba(0,0,0,0)');rim.addColorStop(0.5,'rgba(0,'+Math.floor(140+currentSpread*90)+',35,'+(0.1+currentSpread*0.1)+')');rim.addColorStop(1,'rgba(0,0,0,0)');
ctx.beginPath();ctx.arc(cx,cy,88*S,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill();
lt+=0.016;if(lt>nl){lt=0;nl=0.4+Math.random()*(state==='idle'?1.8:0.5);tlx=(Math.random()-0.5)*70*S;tly=(Math.random()-0.5)*50*S;}
vx+=(tlx-lx)*0.28;vx*=0.58;vy+=(tly-ly)*0.28;vy*=0.58;lx+=vx;ly+=vy;
bt+=0.016;if(!bl&&bt>nb){bl=true;bp=0;nb=2+Math.random()*4;bt=0;}
if(bl){bp+=0.2;if(bp>=1){bl=false;bp=0;}}
const bs=bl?Math.max(0.04,Math.abs(Math.cos(bp*Math.PI))):1;
const eyeR=5.2*S,eg2=17*S,ey2=cy-3*S;
[[cx-eg2+lx,ey2+ly],[cx+eg2+lx,ey2+ly]].forEach(([ex,ey])=>{
ctx.save();ctx.translate(ex,ey);ctx.scale(1,bs);
const eg=ctx.createRadialGradient(0,0,eyeR*0.4,0,0,eyeR*4);
eg.addColorStop(0,'rgba(0,255,65,1)');eg.addColorStop(0.3,'rgba(0,255,65,0.55)');eg.addColorStop(0.65,'rgba(0,200,50,0.2)');eg.addColorStop(1,'rgba(0,0,0,0)');
ctx.beginPath();ctx.arc(0,0,eyeR*4,0,Math.PI*2);ctx.fillStyle=eg;ctx.fill();
ctx.beginPath();ctx.arc(0,0,eyeR,0,Math.PI*2);ctx.fillStyle='#00ff41';ctx.fill();
ctx.beginPath();ctx.arc(-1*S,-1.2*S,eyeR*0.38,0,Math.PI*2);ctx.fillStyle='rgba(200,255,200,0.9)';ctx.fill();
ctx.restore();});
t+=0.016;requestAnimationFrame(draw);}
draw();
</script></body></html>`;

export default function AurelFace({ state }) {
  const webViewRef = useRef(null);

  useEffect(() => {
    if (webViewRef.current) {
      const faceState = state === 'WAKE'
        ? 'idle'
        : state === 'LISTENING'
          ? 'listening'
          : state === 'SPEAKING'
            ? 'speaking'
            : 'idle';
      webViewRef.current.postMessage(JSON.stringify({ state: faceState }));
    }
  }, [state]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: HTML }}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        backgroundColor="#000000"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 300,
    height: 300,
    backgroundColor: '#000',
    borderRadius: 150,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
