
const $=id=>document.getElementById(id);

const POINTS=[
  {id:'A01',name:'南區綜合大樓A棟1樓'},
  {id:'B01',name:'南區綜合大樓B棟1樓'},
  {id:'C01',name:'南區綜合大樓C棟1樓'},
  {id:'N01',name:'新創大樓'},
  {id:'F01',name:'鴻海大樓'}
];

const STORAGE_KEY='ksp_checkpoint_gps_drafts_v1';

let serverPoints={};
let drafts=loadDrafts();
let locatingId='';

document.addEventListener('DOMContentLoaded',()=>{
  $('reloadBtn').addEventListener('click',loadServerPoints);
  $('downloadCsvBtn').addEventListener('click',downloadCsv);

  renderCards();
  checkApi();
  loadServerPoints();
});

function esc(v){
  return String(v??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function status(id,msg,type='info'){
  $(id).innerHTML=msg
    ? `<div class="status ${type}">${esc(msg)}</div>`
    : '';
}

function apiCall(action,payload={}){
  return new Promise((resolve,reject)=>{
    if(typeof API_URL==='undefined' || !API_URL || API_URL.includes('PASTE_')){
      reject(new Error('尚未設定 config.js 的 API 網址。'));
      return;
    }

    const requestId='gps_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const frameName='frame_'+requestId;

    const iframe=document.createElement('iframe');
    iframe.name=frameName;
    iframe.style.display='none';

    const form=document.createElement('form');
    form.method='POST';
    form.action=API_URL;
    form.target=frameName;
    form.style.display='none';

    Object.entries({
      requestId,
      action,
      payload:JSON.stringify(payload)
    }).forEach(([name,value])=>{
      const input=document.createElement('input');
      input.type='hidden';
      input.name=name;
      input.value=value;
      form.appendChild(input);
    });

    let done=false;

    const cleanup=()=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      setTimeout(()=>{
        try{form.remove()}catch(e){}
        try{iframe.remove()}catch(e){}
      },50);
    };

    const onMessage=e=>{
      const d=e.data;
      if(!d || d.source!=='ksp-api' || d.requestId!==requestId)return;

      cleanup();

      if(d.response?.ok){
        resolve(d.response);
      }else{
        reject(new Error(d.response?.message||'API執行失敗'));
      }
    };

    window.addEventListener('message',onMessage);

    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error('API連線逾時。'));
    },typeof API_TIMEOUT_MS==='number'?API_TIMEOUT_MS:30000);

    document.body.append(iframe,form);
    form.submit();
  });
}

async function checkApi(){
  try{
    const r=await apiCall('ping',{});

    if(r.service!=='KSP Security Fresh API'){
      throw new Error(`API服務不符：${r.service||'未知'}`);
    }

    $('apiStatus').className='badge ok';
    $('apiStatus').textContent='已連線';
    $('apiDetail').textContent=`${r.version||''}｜巡查點專屬 GPS`;

  }catch(e){
    $('apiStatus').className='badge err';
    $('apiStatus').textContent='未連線';
    $('apiDetail').textContent=e.message;
  }
}

async function loadServerPoints(){
  status('topMessage','正在讀取巡查點設定…','info');

  try{
    const r=await apiCall('checkpointList',{});

    serverPoints={};

    (r.checkpoints||[]).forEach(cp=>{
      serverPoints[String(cp.checkpointId||'').toUpperCase()]=cp;
    });

    renderCards();

    const configured=POINTS.filter(p=>serverPoints[p.id]?.gpsConfigured).length;

    $('configuredCount').textContent=`${configured} / 5 已設定`;
    $('configuredCount').className=`badge ${configured===5?'ok':'waiting'}`;

    status(
      'topMessage',
      configured===5
        ? '5個巡查點均已設定專屬 GPS。'
        : `目前已有 ${configured} 個巡查點設定 GPS；其餘請到現場定位後貼回 Google Sheet。`,
      configured===5?'ok':'warn'
    );

  }catch(e){
    status('topMessage',e.message,'err');
  }
}

function renderCards(){
  const box=$('checkpointCards');
  if(!box)return;

  box.innerHTML=POINTS.map(point=>{
    const server=serverPoints[point.id]||{};
    const draft=drafts[point.id]||{};

    const serverText=
      server.gpsConfigured
        ? `${fmt(server.lat)}, ${fmt(server.lng)}`
        : '尚未設定';

    const draftText=
      draft.lat
        ? `${fmt(draft.lat)}, ${fmt(draft.lng)}`
        : '尚未現場取樣';

    const accuracyText=
      draft.accuracy
        ? `約 ±${Math.round(draft.accuracy)} 公尺｜${draft.samples||0}筆樣本`
        : '—';

    const radius=Number(server.radius||100);

    return `
      <article class="checkpoint-gps-card" data-id="${point.id}">
        <div class="checkpoint-gps-head">
          <div>
            <strong>${esc(point.id)}</strong>
            <span>${esc(point.name)}</span>
          </div>
          <span class="badge ${server.gpsConfigured?'ok':'waiting'}">
            ${server.gpsConfigured?'GPS已設定':'待設定'}
          </span>
        </div>

        <div class="gps-data-grid">
          <div>
            <span>Google Sheet 現值</span>
            <strong>${esc(serverText)}</strong>
          </div>
          <div>
            <span>允許半徑</span>
            <strong>${radius} 公尺</strong>
          </div>
          <div>
            <span>本機取樣</span>
            <strong>${esc(draftText)}</strong>
          </div>
          <div>
            <span>取樣精度</span>
            <strong>${esc(accuracyText)}</strong>
          </div>
        </div>

        <div class="gps-button-grid">
          <button class="btn primary locate-btn" data-id="${point.id}" ${locatingId?'disabled':''}>
            ${locatingId===point.id?'定位中…':'📍 現場定位'}
          </button>

          <button class="btn outline copy-btn" data-id="${point.id}" ${draft.lat?'':'disabled'}>
            複製 C/D 座標
          </button>

          <button class="btn outline test-btn" data-id="${point.id}" ${server.gpsConfigured?'':'disabled'}>
            測試目前距離
          </button>
        </div>

        <div id="msg-${point.id}" class="gps-card-message"></div>
      </article>
    `;
  }).join('');

  box.querySelectorAll('.locate-btn').forEach(btn=>{
    btn.addEventListener('click',()=>capturePoint(btn.dataset.id));
  });

  box.querySelectorAll('.copy-btn').forEach(btn=>{
    btn.addEventListener('click',()=>copyPoint(btn.dataset.id));
  });

  box.querySelectorAll('.test-btn').forEach(btn=>{
    btn.addEventListener('click',()=>testPoint(btn.dataset.id));
  });
}

async function capturePoint(id){
  if(locatingId)return;

  if(!navigator.geolocation){
    cardStatus(id,'此瀏覽器不支援 GPS 定位。','err');
    return;
  }

  locatingId=id;
  renderCards();
  cardStatus(id,'正在收集高精度 GPS 樣本，請保持手機靜止約 10～20 秒…','info');

  try{
    const samples=await collectGpsSamples(7,18000);

    if(!samples.length){
      throw new Error('沒有取得有效 GPS 樣本。');
    }

    // 依 accuracy 排序，取最佳 3～5 筆平均，降低單筆漂移。
    samples.sort((a,b)=>a.accuracy-b.accuracy);

    const useCount=Math.min(5,Math.max(3,samples.length));
    const chosen=samples.slice(0,useCount);

    const lat=chosen.reduce((s,x)=>s+x.lat,0)/chosen.length;
    const lng=chosen.reduce((s,x)=>s+x.lng,0)/chosen.length;
    const accuracy=chosen.reduce((s,x)=>s+x.accuracy,0)/chosen.length;

    drafts[id]={
      lat,
      lng,
      accuracy,
      samples:samples.length,
      capturedAt:new Date().toISOString()
    };

    saveDrafts();
    locatingId='';
    renderCards();

    cardStatus(
      id,
      `定位完成：${fmt(lat)}, ${fmt(lng)}｜平均精度約 ±${Math.round(accuracy)} 公尺。`,
      accuracy<=30?'ok':(accuracy<=60?'warn':'err')
    );

  }catch(e){
    locatingId='';
    renderCards();
    cardStatus(id,e.message,'err');
  }
}

function collectGpsSamples(targetCount=7,maxMs=18000){
  return new Promise((resolve,reject)=>{
    const samples=[];
    let done=false;
    let watchId=null;

    const finish=()=>{
      if(done)return;
      done=true;

      if(watchId!==null){
        navigator.geolocation.clearWatch(watchId);
      }

      clearTimeout(timer);

      if(samples.length){
        resolve(samples);
      }else{
        reject(new Error('GPS定位失敗，請確認已允許精確位置權限。'));
      }
    };

    const timer=setTimeout(finish,maxMs);

    watchId=navigator.geolocation.watchPosition(
      pos=>{
        const c=pos.coords;

        if(
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude) &&
          Number.isFinite(c.accuracy)
        ){
          samples.push({
            lat:c.latitude,
            lng:c.longitude,
            accuracy:c.accuracy,
            time:Date.now()
          });

          if(samples.length>=targetCount){
            finish();
          }
        }
      },
      err=>{
        if(!samples.length){
          clearTimeout(timer);
          done=true;
          if(watchId!==null)navigator.geolocation.clearWatch(watchId);
          reject(new Error(gpsErrorMessage(err)));
        }else{
          finish();
        }
      },
      {
        enableHighAccuracy:true,
        maximumAge:0,
        timeout:15000
      }
    );
  });
}

function gpsErrorMessage(err){
  if(err?.code===1)return 'GPS權限被拒絕，請允許此網站使用精確位置。';
  if(err?.code===2)return '目前無法取得GPS位置，請移動到訊號較佳處再試。';
  if(err?.code===3)return 'GPS定位逾時，請保持手機靜止並重新定位。';
  return err?.message||'GPS定位失敗。';
}

async function copyPoint(id){
  const d=drafts[id];

  if(!d?.lat){
    cardStatus(id,'請先完成現場定位。','warn');
    return;
  }

  const text=`${fmt(d.lat)}\t${fmt(d.lng)}`;

  try{
    await navigator.clipboard.writeText(text);
    cardStatus(id,'已複製「緯度 + Tab + 經度」，可直接貼到 Google Sheet C/D 欄。','ok');
  }catch(e){
    cardStatus(id,`請手動複製：${text}`,'warn');
  }
}

async function testPoint(id){
  const cp=serverPoints[id];

  if(!cp?.gpsConfigured){
    cardStatus(id,'Google Sheet 尚未設定此巡查點 GPS。','warn');
    return;
  }

  cardStatus(id,'正在取得目前手機位置…','info');

  try{
    const pos=await getCurrentGps();
    const distance=Math.round(distanceMeters(
      pos.lat,pos.lng,
      Number(cp.lat),Number(cp.lng)
    ));

    const radius=Number(cp.radius||100);

    cardStatus(
      id,
      `目前距離 ${distance} 公尺｜允許 ${radius} 公尺｜GPS精度約 ±${Math.round(pos.accuracy)} 公尺。`+
      (distance<=radius?' 驗證通過。':' 超出允許範圍。'),
      distance<=radius?'ok':'err'
    );

  }catch(e){
    cardStatus(id,e.message,'err');
  }
}

function getCurrentGps(){
  return new Promise((resolve,reject)=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({
        lat:pos.coords.latitude,
        lng:pos.coords.longitude,
        accuracy:pos.coords.accuracy
      }),
      err=>reject(new Error(gpsErrorMessage(err))),
      {
        enableHighAccuracy:true,
        maximumAge:0,
        timeout:15000
      }
    );
  });
}

function distanceMeters(lat1,lng1,lat2,lng2){
  const R=6371000;
  const rad=x=>x*Math.PI/180;
  const dLat=rad(lat2-lat1);
  const dLng=rad(lng2-lng1);

  const a=
    Math.sin(dLat/2)**2+
    Math.cos(rad(lat1))*
    Math.cos(rad(lat2))*
    Math.sin(dLng/2)**2;

  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function cardStatus(id,msg,type){
  const el=$(`msg-${id}`);
  if(!el)return;
  el.innerHTML=`<div class="status ${type||'info'}">${esc(msg)}</div>`;
}

function downloadCsv(){
  const rows=[
    ['巡查點編號','名稱','緯度','經度','建議貼入欄位']
  ];

  POINTS.forEach(p=>{
    const d=drafts[p.id]||{};
    rows.push([
      p.id,
      p.name,
      d.lat?fmt(d.lat):'',
      d.lng?fmt(d.lng):'',
      'C/D'
    ]);
  });

  const csv='\uFEFF'+rows.map(row=>
    row.map(v=>{
      const s=String(v??'').replaceAll('"','""');
      return /[",\n]/.test(s)?`"${s}"`:s;
    }).join(',')
  ).join('\r\n');

  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='KSP_巡查點GPS定位.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);

  status('sheetMessage','已下載本次定位 CSV。','ok');
}

function fmt(n){
  return Number(n).toFixed(6);
}

function loadDrafts(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};
  }catch(e){
    return {};
  }
}

function saveDrafts(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(drafts));
}
