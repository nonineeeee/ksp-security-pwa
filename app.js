
let currentPerson=null;
let currentDuty=null;
let scanner=null;
let scanBusy=false;

const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  const saved=localStorage.getItem('ksp_guard_person_id');
  if(saved)$('personId').value=saved;

  $('loginBtn').addEventListener('click',login);
  $('logoutBtn').addEventListener('click',logout);
  $('clockInBtn').addEventListener('click',()=>doClock('clockIn'));
  $('clockOutBtn').addEventListener('click',()=>doClock('clockOut'));

  $('patrolBtn').addEventListener('click',openPatrol);
  $('patrolBackBtn').addEventListener('click',()=>showView('mainView'));
  $('manualQrBtn').addEventListener('click',()=>processQr($('manualQr').value));

  $('recordsBtn').addEventListener('click',openRecords);
  $('recordsBackBtn').addEventListener('click',()=>showView('mainView'));
  $('refreshRecordsBtn').addEventListener('click',loadTodayRecords);

  $('incidentBtn').addEventListener('click',openIncident);
  $('incidentBackBtn').addEventListener('click',()=>showView('mainView'));
  $('incidentPhoto').addEventListener('change',previewPhoto);
  $('removePhotoBtn').addEventListener('click',clearPhoto);
  $('submitIncidentBtn').addEventListener('click',submitIncident);

  $('correctionBtn').addEventListener('click',openCorrection);
  $('correctionBackBtn').addEventListener('click',()=>showView('mainView'));
  $('correctionType').addEventListener('change',toggleCorrectionCheckpoint);
  $('submitCorrectionBtn').addEventListener('click',submitCorrection);
  $('refreshCorrectionsBtn').addEventListener('click',loadCorrections);

  $('successCloseBtn').addEventListener('click',hideSuccess);

  checkApi();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
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
  $(id).innerHTML=msg?`<div class="status ${type}">${esc(msg)}</div>`:'';
}

function showView(id){
  ['mainView','patrolView','recordsView','incidentView','correctionView']
    .forEach(v=>$(v).classList.add('hidden'));

  $(id).classList.remove('hidden');

  if(id!=='patrolView'){
    stopScanner();
  }
}

function apiCall(action,payload={}){
  return new Promise((resolve,reject)=>{
    if(typeof API_URL==='undefined' || !API_URL || API_URL.includes('PASTE_')){
      reject(new Error('尚未設定 config.js 的 fresh-v1 API 網址。'));
      return;
    }

    const requestId='ksp_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const frameName='frame_'+requestId;

    const iframe=document.createElement('iframe');
    iframe.name=frameName;
    iframe.style.display='none';

    const form=document.createElement('form');
    form.method='POST';
    form.action=API_URL;
    form.target=frameName;
    form.style.display='none';

    const params={
      requestId,
      action,
      payload:JSON.stringify(payload)
    };

    Object.entries(params).forEach(([name,value])=>{
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

      if(d.response && d.response.ok){
        resolve(d.response);
      }else{
        reject(new Error(d.response?.message || 'API 執行失敗'));
      }
    };

    window.addEventListener('message',onMessage);

    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error('API 連線逾時。'));
    },typeof API_TIMEOUT_MS==='number'?API_TIMEOUT_MS:30000);

    document.body.append(iframe,form);
    form.submit();
  });
}

async function checkApi(){
  const b=$('apiStatus');

  try{
    const r=await apiCall('ping',{});

    if(r.version!=='fresh-v1'){
      throw new Error(`API 版本不符：${r.version||'未知'}`);
    }

    b.className='badge ok';
    b.textContent='已連線';
    $('apiDetail').textContent=`${r.service}｜${r.version}｜${r.rosterSource||''}`;

  }catch(e){
    b.className='badge err';
    b.textContent='未連線';
    $('apiDetail').textContent=e.message;
  }
}

async function login(){
  const personId=$('personId').value.trim().toUpperCase();
  const password=$('password').value.trim();

  if(!personId || !password){
    status('loginMessage','請輸入人員編號及密碼。','warn');
    return;
  }

  const btn=$('loginBtn');
  btn.disabled=true;
  btn.textContent='登入驗證中…';

  try{
    const r=await apiCall('login',{personId,password});

    currentPerson=r.person;
    currentDuty=r.duty||null;

    localStorage.setItem('ksp_guard_person_id',personId);

    $('staffLabel').textContent=`${currentPerson.name}｜${currentPerson.personId}`;
    renderDuty(currentDuty);

    const exempt=r.patrolExempt;
    if(exempt?.exempt){
      $('patrolExempt').textContent=`目前免巡查：${exempt.reason}`;
      $('patrolExempt').classList.remove('hidden');
    }else{
      $('patrolExempt').classList.add('hidden');
    }

    $('loginView').classList.add('hidden');
    $('mainView').classList.remove('hidden');

    status(
      'mainMessage',
      currentDuty
        ? `登入成功。伺服器時間：${r.serverTime}`
        : '登入成功，但目前查無勤務班表。',
      currentDuty?'ok':'warn'
    );

  }catch(e){
    status('loginMessage',e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='登入系統';
  }
}

function renderDuty(duty){
  $('todayShift').textContent=duty?.shift||'今日無排班';
  $('dutyDate').textContent=duty?.dutyDate||'—';
  $('dutyStart').textContent=duty?.startTime||'—';
  $('dutyEnd').textContent=duty?.endTime||'—';
}

function logout(){
  currentPerson=null;
  currentDuty=null;
  stopScanner();
  $('password').value='';
  ['mainView','patrolView','recordsView','incidentView','correctionView']
    .forEach(id=>$(id).classList.add('hidden'));
  $('loginView').classList.remove('hidden');
  status('loginMessage','');
}

function getGps(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('此裝置不支援 GPS。'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      p=>resolve({
        lat:p.coords.latitude,
        lng:p.coords.longitude,
        accuracy:p.coords.accuracy
      }),
      e=>{
        let msg='無法取得 GPS 定位。';
        if(e.code===1)msg='定位權限被拒絕，請允許網站使用位置資訊。';
        if(e.code===2)msg='目前無法取得位置資訊。';
        if(e.code===3)msg='GPS 定位逾時，請重新操作。';
        reject(new Error(msg));
      },
      {
        enableHighAccuracy:true,
        timeout:20000,
        maximumAge:0
      }
    );
  });
}

async function doClock(action){
  if(!currentPerson)return;

  const isOut=action==='clockOut';
  const title=isOut?'下班簽退':'上班簽到';

  if(isOut && !confirm('確認本班勤務已完成，現在進行下班簽退？')){
    return;
  }

  status('mainMessage',`正在取得 GPS，準備${title}…`,'info');

  try{
    const gps=await getGps();

    const r=await apiCall(action,{
      personId:currentPerson.personId,
      lat:gps.lat,
      lng:gps.lng
    });

    currentDuty=r.duty||currentDuty;
    renderDuty(currentDuty);

    showSuccess(
      title+'完成',
      `${r.message}\n時間：${r.serverTime}\nGPS距離：約 ${r.distance} 公尺`
    );

    status('mainMessage',r.message,'ok');

  }catch(e){
    status('mainMessage',e.message,'err');
  }
}

function openPatrol(){
  showView('patrolView');
  $('manualQr').value='';
  $('pointCard').classList.add('hidden');
  status('patrolMessage','');
  startScanner();
}

function normalizeQr(raw){
  const text=String(raw||'').trim();

  if(/^https?:\/\//i.test(text)){
    try{
      const u=new URL(text);
      return (
        u.searchParams.get('qr') ||
        u.searchParams.get('code') ||
        text
      );
    }catch(e){}
  }

  return text;
}

async function startScanner(){
  await stopScanner();
  scanBusy=false;

  if(typeof Html5Qrcode==='undefined'){
    $('cameraStatus').textContent='QR掃描元件載入失敗，可使用手動輸入。';
    return;
  }

  try{
    scanner=new Html5Qrcode('reader',{
      formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported:true
    });

    await scanner.start(
      {facingMode:'environment'},
      {
        fps:12,
        qrbox:(w,h)=>{
          const s=Math.max(210,Math.min(310,Math.floor(Math.min(w,h)*.72)));
          return {width:s,height:s};
        },
        disableFlip:true
      },
      text=>{
        if(scanBusy)return;
        scanBusy=true;
        processQr(text);
      },
      ()=>{}
    );

    $('cameraStatus').textContent='後置鏡頭已啟動';

  }catch(e){
    $('cameraStatus').textContent='無法啟動相機，可改用手動輸入 QR 識別碼。';
  }
}

async function stopScanner(){
  if(scanner){
    try{
      if(scanner.isScanning)await scanner.stop();
      scanner.clear();
    }catch(e){}
    scanner=null;
  }

  if($('reader')){
    $('reader').innerHTML='';
  }
}

async function processQr(raw){
  if(!currentPerson){
    scanBusy=false;
    return;
  }

  const qr=normalizeQr(raw);

  if(!qr){
    status('patrolMessage','請掃描或輸入 QR 識別碼。','warn');
    scanBusy=false;
    return;
  }

  try{
    status('patrolMessage','正在辨識巡查點…','info');

    const cpResp=await apiCall('checkpoint',{qr});
    const cp=cpResp.checkpoint;

    $('pointCard').classList.remove('hidden');
    $('pointName').textContent=cp.name||cp.checkpointId;
    $('pointCode').textContent=`${cp.checkpointId}｜${cp.qr}`;
    $('maxDistance').textContent=`${cp.radius||350} 公尺`;

    status('patrolMessage','QR辨識成功，正在取得 GPS…','info');

    const gps=await getGps();
    $('gpsAccuracy').textContent=`約 ±${Math.round(gps.accuracy)} 公尺`;

    const r=await apiCall('patrol',{
      personId:currentPerson.personId,
      qr,
      lat:gps.lat,
      lng:gps.lng
    });

    await stopScanner();

    showSuccess(
      '巡查完成',
      `${r.checkpoint?.name||'巡查點'}\n時間：${r.serverTime}\nGPS距離：約 ${r.distance} 公尺`
    );

    status('patrolMessage',r.message,'ok');

  }catch(e){
    status('patrolMessage',e.message,'err');
    setTimeout(()=>{scanBusy=false;},1600);
  }
}

async function openRecords(){
  showView('recordsView');
  await loadTodayRecords();
}

async function loadTodayRecords(){
  if(!currentPerson)return;

  status('recordsMessage','正在讀取今日紀錄…','info');
  $('recordsList').innerHTML='';

  try{
    const r=await apiCall('todayRecords',{
      personId:currentPerson.personId
    });

    renderRecords(r.records||[]);
    status('recordsMessage','');

  }catch(e){
    status('recordsMessage',e.message,'err');
  }
}

function renderRecords(records){
  const box=$('recordsList');

  if(!records.length){
    box.innerHTML='<div class="empty">今日尚無勤務紀錄。</div>';
    return;
  }

  box.innerHTML=records.map(r=>`
    <div class="record-item">
      <div class="record-top">
        <div>
          <strong>${esc(r.action||'勤務紀錄')}</strong>
          <div class="eyebrow">${esc(r.checkpointName||r.checkpointId||'')}</div>
        </div>
        <div class="record-time">${esc(r.time||'')}</div>
      </div>
      <div class="record-meta">
        <span class="chip">${esc(r.result||'通過')}</span>
        ${r.checkpointId?`<span class="chip">${esc(r.checkpointId)}</span>`:''}
      </div>
    </div>
  `).join('');
}

function openIncident(){
  showView('incidentView');
  $('incidentCheckpoint').value='';
  $('incidentType').value='';
  $('incidentDescription').value='';
  clearPhoto();
  status('incidentMessage','');
}

function previewPhoto(e){
  const file=e.target.files?.[0];
  if(!file){
    clearPhoto();
    return;
  }

  const reader=new FileReader();
  reader.onload=()=>{
    $('photoPreview').src=reader.result;
    $('photoPreviewWrap').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearPhoto(){
  $('incidentPhoto').value='';
  $('photoPreview').src='';
  $('photoPreviewWrap').classList.add('hidden');
}

async function compressImage(file){
  if(!file)return '';

  const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('照片讀取失敗。'));
    reader.onload=()=>resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const img=await new Promise((resolve,reject)=>{
    const i=new Image();
    i.onload=()=>resolve(i);
    i.onerror=()=>reject(new Error('照片格式無法處理。'));
    i.src=data;
  });

  const maxSide=1280;
  const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
  const w=Math.round(img.width*scale);
  const h=Math.round(img.height*scale);

  const canvas=document.createElement('canvas');
  canvas.width=w;
  canvas.height=h;

  canvas.getContext('2d').drawImage(img,0,0,w,h);

  return canvas.toDataURL('image/jpeg',.68);
}

async function submitIncident(){
  if(!currentPerson)return;

  const type=$('incidentType').value.trim();
  const description=$('incidentDescription').value.trim();
  const checkpointName=$('incidentCheckpoint').value.trim();

  if(!type){
    status('incidentMessage','請選擇異常類型。','warn');
    return;
  }

  if(!description){
    status('incidentMessage','請填寫異常說明。','warn');
    return;
  }

  const btn=$('submitIncidentBtn');
  btn.disabled=true;
  btn.textContent='送出中…';

  try{
    status('incidentMessage','正在取得 GPS…','info');
    const gps=await getGps();

    const file=$('incidentPhoto').files?.[0];
    const photoDataUrl=file?await compressImage(file):'';

    const r=await apiCall('incident',{
      personId:currentPerson.personId,
      checkpointName,
      type,
      description,
      lat:gps.lat,
      lng:gps.lng,
      photoDataUrl
    });

    showSuccess(
      '異常事件已回報',
      `事件編號：${r.eventId}${r.photoUrl?'\n照片已儲存':''}`
    );

    $('incidentType').value='';
    $('incidentDescription').value='';
    clearPhoto();
    status('incidentMessage',r.message,'ok');

  }catch(e){
    status('incidentMessage',e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='送出異常回報';
  }
}

function openCorrection(){
  showView('correctionView');

  const now=new Date();
  $('correctionType').value='';
  $('correctionReason').value='';
  $('correctionCheckpointWrap').classList.add('hidden');
  $('correctionDate').value=
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  $('correctionTime').value=
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  status('correctionMessage','');
  loadCorrections();
}

function toggleCorrectionCheckpoint(){
  $('correctionCheckpointWrap')
    .classList.toggle(
      'hidden',
      $('correctionType').value!=='巡查'
    );
}

async function submitCorrection(){
  if(!currentPerson)return;

  const correctionType=$('correctionType').value.trim();
  const targetDate=$('correctionDate').value.trim();
  const targetTime=$('correctionTime').value.trim();
  const checkpoint=$('correctionCheckpoint').value.trim();
  const reason=$('correctionReason').value.trim();

  if(!correctionType || !targetDate || !targetTime || !reason){
    status('correctionMessage','請完整填寫補登類型、日期、時間及原因。','warn');
    return;
  }

  if(correctionType==='巡查' && !checkpoint){
    status('correctionMessage','巡查補登請選擇巡查點。','warn');
    return;
  }

  const btn=$('submitCorrectionBtn');
  btn.disabled=true;
  btn.textContent='送出中…';

  try{
    const gps=await getGps();

    const r=await apiCall('correction',{
      personId:currentPerson.personId,
      correctionType,
      targetDate,
      targetTime,
      checkpoint:correctionType==='巡查'?checkpoint:'',
      reason,
      lat:gps.lat,
      lng:gps.lng
    });

    showSuccess(
      '補登已送出',
      `申請編號：${r.requestId}`
    );

    $('correctionReason').value='';
    status('correctionMessage',r.message,'ok');
    await loadCorrections();

  }catch(e){
    status('correctionMessage',e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='送出補登';
  }
}

async function loadCorrections(){
  if(!currentPerson)return;

  const box=$('correctionList');
  box.innerHTML='<div class="empty">讀取中…</div>';

  try{
    const r=await apiCall('myCorrections',{
      personId:currentPerson.personId
    });

    const items=r.records||[];

    if(!items.length){
      box.innerHTML='<div class="empty">尚無補登紀錄。</div>';
      return;
    }

    box.innerHTML=items
      .slice()
      .reverse()
      .map(x=>`
        <div class="record-item">
          <div class="record-top">
            <div>
              <strong>${esc(x.correctionType||'補登')}</strong>
              <div class="eyebrow">${esc(x.targetDate||'')} ${esc(x.targetTime||'')}</div>
            </div>
            <div class="record-time">${esc(x.status||'待處理')}</div>
          </div>
          <div class="record-meta">
            ${x.checkpoint?`<span class="chip">${esc(x.checkpoint)}</span>`:''}
            <span class="chip">${esc(x.reason||'')}</span>
          </div>
        </div>
      `).join('');

  }catch(e){
    box.innerHTML=`<div class="empty">${esc(e.message)}</div>`;
  }
}

function showSuccess(title,text){
  $('successTitle').textContent=title;
  $('successText').textContent=text;
  document.documentElement.style.overflow='hidden';
  document.body.style.overflow='hidden';
  $('successModal').classList.remove('hidden');
}

function hideSuccess(){
  $('successModal').classList.add('hidden');
  document.documentElement.style.overflow='';
  document.body.style.overflow='';
}
