
let currentPerson=null;
let currentDuty=null;
let currentPassword='';
let scanner=null;
let scanBusy=false;
let cameraTrack=null;
let cameraCapabilities=null;
let currentZoom=1;
let torchOn=false;
let scannerPausedAfterSuccess=false;
let todayDutyState={
  hasDuty:false,
  clockedIn:false,
  clockedOut:false,
  patrolCount:0,
  patrolProgress:null,
  specialExempt:null,
  lastAction:'',
  lastTime:''
};


const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  const saved=localStorage.getItem('ksp_guard_person_id');
  if(saved)$('personId').value=saved;

  $('loginBtn').addEventListener('click',login);
  $('logoutBtn').addEventListener('click',logout);
  $('clockInBtn').addEventListener('click',()=>{
    if($('clockInBtn').disabled)return;
    doClock('clockIn');
  });

  $('clockOutBtn').addEventListener('click',()=>{
    if($('clockOutBtn').disabled)return;
    doClock('clockOut');
  });

  $('patrolBtn').addEventListener('click',()=>{
    if($('patrolBtn').disabled)return;
    openPatrol();
  });
  $('patrolBackBtn').addEventListener('click',()=>showView('mainView'));
  $('manualQrBtn').addEventListener('click',()=>processQr($('manualQr').value));
  $('refocusBtn').addEventListener('click',refocusCamera);
  $('zoom1Btn').addEventListener('click',()=>setCameraZoom(1));
  $('zoom15Btn').addEventListener('click',()=>setCameraZoom(1.5));
  $('zoom2Btn').addEventListener('click',()=>setCameraZoom(2));
  $('torchBtn').addEventListener('click',toggleTorch);
  $('continueScanBtn').addEventListener('click',continueScanning);

  $('duplicatePatrolNextBtn').addEventListener('click',continueAfterDuplicatePatrol);

  $('scanSuccessCloseBtn').addEventListener('click',closeScanSuccessPopup);
  $('scanSuccessContinueBtn').addEventListener('click',()=>{
    closeScanSuccessPopup();
    continueScanning();
  });

  $('patrolProgressToggle').addEventListener('click',togglePatrolProgress);

  $('recordsBtn').addEventListener('click',openRecords);
  $('recordsBackBtn').addEventListener('click',()=>showView('mainView'));
  $('refreshRecordsBtn').addEventListener('click',loadTodayRecords);

  $('incidentBtn').addEventListener('click',openIncident);
  $('incidentBackBtn').addEventListener('click',()=>showView('mainView'));
  $('incidentPhoto').addEventListener('change',previewPhoto);
  $('removePhotoBtn').addEventListener('click',clearPhoto);
  $('submitIncidentBtn').addEventListener('click',submitIncident);

  $('specialExemptBtn').addEventListener('click',openSpecialExempt);
  $('specialExemptBackBtn').addEventListener('click',()=>showView('mainView'));
  $('specialExemptDate').addEventListener('change',loadSpecialExemptStatus);
  $('setSpecialExemptBtn').addEventListener('click',setSpecialExempt);
  $('cancelSpecialExemptBtn').addEventListener('click',cancelSpecialExempt);

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
  const views=[
    'loginView',
    'mainView',
    'patrolView',
    'recordsView',
    'incidentView',
    'correctionView',
    'specialExemptView'
  ];

  views.forEach(viewId=>{
    const el=$(viewId);
    if(!el)return;

    el.classList.toggle(
      'hidden',
      viewId!==id
    );
  });

  if(id!=='patrolView'){
    stopScanner();
  }

  const specialView=$('specialExemptView');
  if(specialView && id!=='specialExemptView'){
    specialView.classList.add('hidden');
  }

  if(id!=='patrolView' && typeof closeScanSuccessPopup==='function'){
    closeScanSuccessPopup();
  }

  if(id!=='patrolView' && typeof closeDuplicatePatrolPopup==='function'){
    closeDuplicatePatrolPopup();
  }

  window.scrollTo({
    top:0,
    behavior:'auto'
  });
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

    if(r.service !== 'KSP Security Fresh API'){
      throw new Error(`API服務不符：${r.service||'未知'}`);
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
    currentPassword=password;

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

    await refreshDutyDashboard();

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
  currentPassword='';
  stopScanner();
  $('password').value='';
  ['mainView','patrolView','recordsView','incidentView','correctionView','specialExemptView']
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
    await refreshDutyDashboard();

  }catch(e){
    status('mainMessage',e.message,'err');
  }
}


async function refreshDutyDashboard(){
  if(!currentPerson){
    return;
  }

  try{
    const [recordsResult,progressResult,specialResult]=await Promise.all([
      apiCall('dutyRecords',{
        personId:currentPerson.personId
      }),
      apiCall('dutyProgress',{
        personId:currentPerson.personId
      }),
      apiCall('specialExemptStatus',{
        personId:currentPerson.personId,
        dutyDate:currentDuty?.dutyDate||''
      })
    ]);

    const records=
      Array.isArray(recordsResult.records)
        ? recordsResult.records
        : [];

    const clockInRecord=
      records.find(
        x=>String(x.action||'')==='上班簽到'
      ) || null;

    const clockOutRecord=
      records.find(
        x=>String(x.action||'')==='下班簽退'
      ) || null;

    const patrolRecords=
      records.filter(
        x=>String(x.action||'')==='定點巡查'
      );

    const latest=
      records.length
        ? records[records.length-1]
        : null;

    todayDutyState={
      hasDuty:!!currentDuty,
      clockedIn:!!clockInRecord,
      clockedOut:!!clockOutRecord,
      patrolCount:patrolRecords.length,
      patrolProgress:progressResult||null,
      specialExempt:specialResult||null,
      lastAction:latest?.action||'',
      lastTime:latest?.time||''
    };

    renderDutyDashboard();
    renderHourlyPatrolProgress();

  }catch(e){
    todayDutyState={
      hasDuty:!!currentDuty,
      clockedIn:false,
      clockedOut:false,
      patrolCount:0,
      patrolProgress:null,
      specialExempt:null,
      lastAction:'',
      lastTime:''
    };

    renderDutyDashboard();
    renderHourlyPatrolProgress();
  }
}

function renderDutyDashboard(){
  const panel=$('dutyStatusPanel');
  const icon=$('dutyStatusIcon');
  const text=$('dutyStatusText');
  const patrolChip=$('patrolCountChip');
  const lastChip=$('lastActionChip');

  panel.classList.remove(
    'state-neutral',
    'state-wait',
    'state-active',
    'state-done',
    'state-special'
  );

  let stateClass='state-neutral';
  let stateIcon='○';
  let stateText='今日無排班';

  if(todayDutyState.hasDuty && !todayDutyState.clockedIn){
    stateClass='state-wait';
    stateIcon='●';
    stateText='尚未上班簽到';
  }

  if(
    todayDutyState.hasDuty &&
    todayDutyState.clockedIn &&
    !todayDutyState.clockedOut
  ){
    stateClass='state-active';
    stateIcon='✓';
    stateText='已上班｜勤務中';
  }

  if(
    todayDutyState.hasDuty &&
    todayDutyState.clockedOut
  ){
    stateClass='state-done';
    stateIcon='✓';
    stateText='已簽退｜勤務完成';
  }

  const special=
    todayDutyState.specialExempt;

  // 特殊情況只影響巡查是否強制，不取代首頁的上下班勤務狀態。
  panel.classList.add(stateClass);
  icon.textContent=stateIcon;
  text.textContent=stateText;

  const progress=todayDutyState.patrolProgress;

  patrolChip.textContent=
    progress && Number(progress.requiredChecks||0)>0
      ? `定點完成 ${progress.completedChecks||0} / ${progress.requiredChecks}`
      : `巡查紀錄 ${todayDutyState.patrolCount} 筆`;

  const specialBanner=$('specialExemptBanner');
  if(specialBanner){
    specialBanner.classList.add('hidden');
    specialBanner.textContent='';
  }

  lastChip.textContent=
    todayDutyState.lastAction
      ? `最近：${todayDutyState.lastAction} ${todayDutyState.lastTime||''}`
      : '尚無勤務紀錄';

  applyDutyButtonState();
}


function setActionButtonState(id,disabled,reason=''){
  const btn=$(id);

  if(!btn)return;

  btn.disabled=disabled;
  btn.classList.toggle('action-disabled',disabled);

  if(disabled && reason){
    btn.dataset.disabledReason=reason;
    btn.title=reason;
  }else{
    delete btn.dataset.disabledReason;
    btn.removeAttribute('title');
  }
}




function togglePatrolProgress(){
  const detail=$('patrolProgressDetail');
  const toggle=$('patrolProgressToggle');
  const arrow=$('patrolProgressArrow');
  const card=$('patrolProgressCard');

  if(!detail || !toggle || !arrow || !card){
    return;
  }

  const opening=
    detail.classList.contains('hidden');

  detail.classList.toggle(
    'hidden',
    !opening
  );

  toggle.setAttribute(
    'aria-expanded',
    opening
      ? 'true'
      : 'false'
  );

  arrow.textContent=
    opening
      ? '⌃'
      : '⌄';

  card.classList.toggle(
    'patrol-progress-collapsed',
    !opening
  );

  card.classList.toggle(
    'patrol-progress-expanded',
    opening
  );
}


function renderHourlyPatrolProgress(){
  const box=$('hourlyPatrolList');
  const count=$('patrolProgressCount');
  const bar=$('patrolProgressBar');
  const summary=$('patrolProgressSummaryText');

  if(!box || !count || !bar || !summary){
    return;
  }

  const progress=
    todayDutyState.patrolProgress;

  if(!progress || !progress.duty){
    count.textContent='0 / 0';
    summary.textContent='目前無巡查進度';
    bar.style.width='0%';
    box.innerHTML=
      '<div class="hourly-empty">目前沒有可顯示的勤務巡查時段。</div>';
    return;
  }

  if(progress.specialExempt?.exempt){
    const optionalDone=
      Number(progress.optionalCompletedChecks||0);

    count.textContent=
      `已巡 ${optionalDone}`;

    summary.textContent=
      `巡查不強制｜仍可打卡｜${progress.specialExempt.reason||'特殊情形'}`;

    bar.style.width='100%';
  }

  const requiredChecks=
    Number(
      progress.requiredChecks||0
    );

  const completedChecks=
    Number(
      progress.completedChecks||0
    );

  const missedChecks=
    Number(
      progress.missedChecks||0
    );

  if(!progress.specialExempt?.exempt){
    count.textContent=
      `${completedChecks} / ${requiredChecks}`;
  }

  const currentSlot=
    Array.isArray(progress.slots)
      ? progress.slots.find(
          x=>x.status==='current'
        )
      : null;

  if(!progress.specialExempt?.exempt){
    summary.textContent=
      missedChecks>0
        ? `已完成 ${completedChecks} 點次｜漏簽 ${missedChecks} 點次`
        : (
          currentSlot
            ? `目前 ${currentSlot.startTime}–${currentSlot.endTime}｜${currentSlot.completedPoints||0}/5`
            : `已完成 ${completedChecks} / ${requiredChecks} 點次`
        );

    bar.style.width=
      requiredChecks
        ? `${Math.round(
            completedChecks /
            requiredChecks *
            100
          )}%`
        : '0%';
  }

  const slots=
    Array.isArray(progress.slots)
      ? progress.slots
      : [];

  box.innerHTML=
    slots.map(slot=>{
      let icon='○';
      let headline='未到時段';

      if(slot.status==='done'){
        icon='✓';
        headline='5 / 5 完成';
      }

      if(slot.status==='current'){
        icon='●';
        headline=
          `${slot.completedPoints||0} / 5`;
      }

      if(slot.status==='missed'){
        icon='!';
        headline=
          `${slot.completedPoints||0} / 5｜缺 ${esc((slot.missingPoints||[]).join('、'))}`;
      }

      if(slot.status==='exempt'){
        icon='－';
        headline=
          `免簽｜${esc(slot.exemptReason||'')}`;
      }

      if(slot.status==='special'){
        icon='◇';
        headline=
          `不強制｜已巡 ${slot.completedPoints||0}/5`;
      }

      const points=
        Array.isArray(slot.points)
          ? slot.points
          : [];

      const pointHtml=
        slot.status==='exempt'
          ? ''
          : `
            <div class="hourly-point-grid">
              ${points.map(p=>`
                <span class="hourly-point ${p.done?'point-done':'point-pending'}">
                  <b>${esc(p.id)}</b>
                  <small class="point-progress-meta">${p.done
                    ? `<span class="point-progress-status">✓ 已完成</span>
                       <span class="point-progress-time">${esc(p.time||'')}</span>
                       <span class="point-progress-name">${esc(p.personName||'')}</span>`
                    : `<span class="point-progress-status">${slot.status==='special'?'免強制':'待巡'}</span>`}</small>
                </span>
              `).join('')}
            </div>
          `;

      const dateText=
        slot.startDate===slot.endDate
          ? ''
          : `${esc(slot.startDate)} `;

      return `
        <div class="hourly-patrol-row hourly-${slot.status||'future'}">
          <span class="hourly-state">${icon}</span>

          <div class="hourly-time">
            <strong>${dateText}${esc(slot.startTime)}–${esc(slot.endTime)}</strong>
            <small>${slot.dayType?esc(slot.dayType):''}</small>
          </div>

          <span class="hourly-result">${headline}</span>

          ${pointHtml}
        </div>
      `;
    }).join('');
}

function applyDutyButtonState(){
  const s=todayDutyState;

  if(s.specialExempt?.exempt){
    const reason=
      s.specialExempt.record?.reason||'特殊情形';

    if(!s.hasDuty){
      setActionButtonState('clockInBtn',true,'今日無排班');
      setActionButtonState('patrolBtn',true,'今日無排班');
      setActionButtonState('clockOutBtn',true,'今日無排班');
      return;
    }

    if(!s.clockedIn){
      setActionButtonState('clockInBtn',false);
      setActionButtonState('patrolBtn',true,'請先完成上班簽到');
      setActionButtonState('clockOutBtn',true,'請先完成上班簽到');
      return;
    }

    if(s.clockedIn && !s.clockedOut){
      setActionButtonState('clockInBtn',true,'已完成上班簽到');

      // 巡查不強制，但仍可正常掃 QR + GPS 打卡。
      setActionButtonState('patrolBtn',false);
      const patrolBtn=$('patrolBtn');
      const small=patrolBtn?.querySelector('small');
      if(small){
        small.textContent=`不強制｜仍可巡查｜${reason}`;
      }

      setActionButtonState('clockOutBtn',false);
      return;
    }

    setActionButtonState('clockInBtn',true,'本班已完成');
    setActionButtonState('patrolBtn',true,'本班已完成');
    setActionButtonState('clockOutBtn',true,'已完成下班簽退');
    return;
  }

  // 無班：保留異常與補登，其餘勤務操作停用
  if(!s.hasDuty){
    setActionButtonState('clockInBtn',true,'今日無排班');
    setActionButtonState('patrolBtn',true,'今日無排班');
    setActionButtonState('clockOutBtn',true,'今日無排班');
    return;
  }

  // 尚未上班
  if(!s.clockedIn){
    setActionButtonState('clockInBtn',false);
    setActionButtonState('patrolBtn',true,'請先完成上班簽到');
    setActionButtonState('clockOutBtn',true,'請先完成上班簽到');
    return;
  }

  // 勤務中
  if(s.clockedIn && !s.clockedOut){
    setActionButtonState('clockInBtn',true,'已完成上班簽到');
    setActionButtonState('patrolBtn',false);
    setActionButtonState('clockOutBtn',false);
    return;
  }

  // 已簽退
  setActionButtonState('clockInBtn',true,'本班已完成');
  setActionButtonState('patrolBtn',true,'本班已完成簽退');
  setActionButtonState('clockOutBtn',true,'已完成下班簽退');
}



function dutyDateToInput(dateText){
  return String(dateText||'')
    .replaceAll('/','-');
}


function openSpecialExempt(){
  if(!currentPerson){
    return;
  }

  showView('specialExemptView');

  const dateInput=$('specialExemptDate');

  if(currentDuty?.dutyDate){
    dateInput.value=
      dutyDateToInput(
        currentDuty.dutyDate
      );
  }else if(!dateInput.value){
    const d=new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const day=String(d.getDate()).padStart(2,'0');
    dateInput.value=`${y}-${m}-${day}`;
  }

  status('specialExemptMessage','');
  loadSpecialExemptStatus();
}


async function loadSpecialExemptStatus(){
  if(!currentPerson){
    return;
  }

  const dutyDate=$('specialExemptDate').value;

  if(!dutyDate){
    $('specialExemptCurrent').textContent=
      '目前狀態：請先選擇勤務日期';
    return;
  }

  try{
    const r=await apiCall('specialExemptStatus',{
      personId:currentPerson.personId,
      dutyDate:dutyDate
    });

    if(r.exempt){
      const note=
        r.record?.note
          ? `｜${r.record.note}`
          : '';

      $('specialExemptCurrent').innerHTML=
        `<strong>目前整班已設定巡查不強制</strong><br>`+
        `${esc(r.shift||r.record?.shift||'')}｜${esc(r.record?.reason||'特殊情形')}${esc(note)}<br>`+
        `<small>設定人：${esc(r.record?.name||'—')}｜設定時間：${esc(r.record?.createdAt||'—')}</small>`;

      $('specialExemptCurrent').classList.add('active');
      $('cancelSpecialExemptBtn').classList.remove('hidden');
      $('setSpecialExemptBtn').textContent='更新本班巡查不強制設定';

      if(r.record?.reason){
        $('specialExemptReason').value=r.record.reason;
      }

      $('specialExemptNote').value=
        r.record?.note||'';

    }else{
      $('specialExemptCurrent').textContent=
        '目前狀態：本班未設定特殊巡查不強制';

      $('specialExemptCurrent').classList.remove('active');
      $('cancelSpecialExemptBtn').classList.add('hidden');
      $('setSpecialExemptBtn').textContent='設定本班巡查不強制';
    }

  }catch(e){
    $('specialExemptCurrent').textContent=
      '目前狀態：讀取失敗';

    status(
      'specialExemptMessage',
      e.message,
      'err'
    );
  }
}


async function setSpecialExempt(){
  if(!currentPerson){
    return;
  }

  const dutyDate=$('specialExemptDate').value;
  const reason=$('specialExemptReason').value;
  const note=$('specialExemptNote').value.trim();

  if(!dutyDate){
    status(
      'specialExemptMessage',
      '請選擇勤務日期。',
      'warn'
    );
    return;
  }

  if(!reason){
    status(
      'specialExemptMessage',
      '請選擇特殊情形。',
      'warn'
    );
    return;
  }

  if(reason==='其他' && !note){
    status(
      'specialExemptMessage',
      '選擇「其他」時請填寫說明。',
      'warn'
    );
    return;
  }

  const ok=confirm(
    `確定將 ${dutyDate} 本班設為「${reason}」巡查不強制？\n\n`+
    '同班只要一人設定，整班同步生效；上班簽到與下班簽退仍須每人正常執行。'
  );

  if(!ok){
    return;
  }

  const btn=$('setSpecialExemptBtn');
  btn.disabled=true;
  btn.textContent='設定中…';

  try{
    const r=await apiCall('specialExemptSet',{
      personId:currentPerson.personId,
      password:currentPassword,
      dutyDate:dutyDate,
      reason:reason,
      note:note
    });

    status(
      'specialExemptMessage',
      r.message,
      'ok'
    );

    await loadSpecialExemptStatus();
    await refreshDutyDashboard();

  }catch(e){
    status(
      'specialExemptMessage',
      e.message,
      'err'
    );

  }finally{
    btn.disabled=false;
    btn.textContent='設定本班巡查不強制';
  }
}


async function cancelSpecialExempt(){
  if(!currentPerson){
    return;
  }

  const dutyDate=$('specialExemptDate').value;

  if(!confirm(`確定取消 ${dutyDate} 本班的特殊巡查不強制？\n\n取消後同班所有保全同步恢復一般巡查規則。`)){
    return;
  }

  const btn=$('cancelSpecialExemptBtn');
  btn.disabled=true;
  btn.textContent='取消中…';

  try{
    const r=await apiCall('specialExemptCancel',{
      personId:currentPerson.personId,
      password:currentPassword,
      dutyDate:dutyDate
    });

    status(
      'specialExemptMessage',
      r.message,
      'ok'
    );

    $('specialExemptReason').value='';
    $('specialExemptNote').value='';

    await loadSpecialExemptStatus();
    await refreshDutyDashboard();

  }catch(e){
    status(
      'specialExemptMessage',
      e.message,
      'err'
    );

  }finally{
    btn.disabled=false;
    btn.textContent='取消本班巡查不強制';
  }
}


function openPatrol(){
  closeScanSuccessPopup();
  showView('patrolView');
  $('manualQr').value='';
  $('pointCard').classList.add('hidden');
  $('patrolSuccessBadge').classList.add('hidden');
  $('continueScanBtn').classList.add('hidden');
  $('cameraControls').classList.add('hidden');
  status('patrolMessage','');
  scannerPausedAfterSuccess=false;
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
  scannerPausedAfterSuccess=false;
  currentZoom=1;
  torchOn=false;

  $('patrolSuccessBadge').classList.add('hidden');
  $('continueScanBtn').classList.add('hidden');
  $('cameraControls').classList.add('hidden');
  $('cameraStatus').textContent='正在啟動後置鏡頭…';

  if(typeof Html5Qrcode==='undefined'){
    $('cameraStatus').textContent='QR掃描元件載入失敗，可使用手動輸入。';
    return;
  }

  try{
    scanner=new Html5Qrcode('reader',{
      formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures:{
        useBarCodeDetectorIfSupported:true
      },
      verbose:false
    });

    let cameraConfig={facingMode:{ideal:'environment'}};

    // 優先選擇明確標示為後置鏡頭的裝置。
    try{
      const cameras=await Html5Qrcode.getCameras();

      if(Array.isArray(cameras) && cameras.length){
        const rear=
          cameras.find(c=>
            /back|rear|environment|後置|背面/i.test(String(c.label||''))
          ) ||
          cameras[cameras.length-1];

        if(rear?.id){
          cameraConfig=rear.id;
        }
      }
    }catch(e){}

    await scanner.start(
      cameraConfig,
      {
        // 三碼巡查 QR 使用較大的有效掃描區，提升手機近距離辨識速度。
        fps:24,
        qrbox:(w,h)=>{
          const minSide=Math.min(w,h);
          const s=Math.max(
            240,
            Math.min(
              420,
              Math.floor(minSide*.84)
            )
          );
          return {width:s,height:s};
        },
        disableFlip:true
      },
      text=>{
        if(scanBusy || scannerPausedAfterSuccess)return;

        scanBusy=true;

        // 一偵測到 QR 就先暫停解碼，保留即時鏡頭畫面，
        // 避免 GPS / API 執行時仍持續耗 CPU 掃描。
        try{
          if(scanner && typeof scanner.pause==='function'){
            scanner.pause(false);
          }
        }catch(e){}

        if(navigator.vibrate){
          navigator.vibrate(50);
        }

        processQr(text);
      },
      ()=>{}
    );

    await prepareCameraTrack();

    $('cameraStatus').textContent='快速掃描模式｜後置鏡頭｜連續自動對焦';
    $('cameraControls').classList.remove('hidden');

  }catch(e){
    console.warn('camera start error',e);
    $('cameraStatus').textContent='無法啟動相機，可改用手動輸入 QR 識別碼。';
  }
}


async function prepareCameraTrack(){
  cameraTrack=null;
  cameraCapabilities=null;

  // html5-qrcode 啟動後，直接取得實際 video track。
  const video=$('reader')?.querySelector('video');

  if(!video)return;

  video.setAttribute('playsinline','true');
  video.setAttribute('autoplay','true');
  video.style.objectFit='cover';

  const stream=video.srcObject;

  if(!stream || !stream.getVideoTracks)return;

  cameraTrack=stream.getVideoTracks()[0] || null;

  if(!cameraTrack)return;

  try{
    cameraCapabilities=
      typeof cameraTrack.getCapabilities==='function'
        ? cameraTrack.getCapabilities()
        : null;
  }catch(e){
    cameraCapabilities=null;
  }

  const advanced=[];

  if(cameraCapabilities?.focusMode?.includes?.('continuous')){
    advanced.push({focusMode:'continuous'});
  }

  // QR 辨識優先使用 720p：畫質足夠、比 1080p 解碼負擔低，
  // 對 iPhone Safari 的即時辨識通常更快。
  try{
    await cameraTrack.applyConstraints({
      width:{ideal:1280},
      height:{ideal:720},
      frameRate:{ideal:24,min:15},
      ...(advanced.length?{advanced}: {})
    });
  }catch(e){
    // 有些 iPhone/Safari 不接受 width/height 與 focusMode 同時設定。
    try{
      if(advanced.length){
        await cameraTrack.applyConstraints({advanced});
      }
    }catch(ignore){}
  }

  updateCameraControlAvailability();
}


function updateCameraControlAvailability(){
  const zoomSupported=
    cameraCapabilities &&
    typeof cameraCapabilities.zoom==='object';

  ['zoom1Btn','zoom15Btn','zoom2Btn'].forEach(id=>{
    const el=$(id);
    if(el){
      el.disabled=!zoomSupported;
      el.classList.toggle('camera-disabled',!zoomSupported);
    }
  });

  const torchSupported=!!cameraCapabilities?.torch;
  $('torchBtn').classList.toggle('hidden',!torchSupported);
}


async function refocusCamera(){
  if(!cameraTrack){
    $('cameraStatus').textContent='目前無法取得鏡頭控制。';
    return;
  }

  $('cameraStatus').textContent='正在重新對焦…';

  try{
    const caps=
      cameraCapabilities ||
      (
        typeof cameraTrack.getCapabilities==='function'
          ? cameraTrack.getCapabilities()
          : {}
      );

    if(caps?.focusMode?.includes?.('single-shot')){
      await cameraTrack.applyConstraints({
        advanced:[{focusMode:'single-shot'}]
      });

      await new Promise(r=>setTimeout(r,350));
    }

    if(caps?.focusMode?.includes?.('continuous')){
      await cameraTrack.applyConstraints({
        advanced:[{focusMode:'continuous'}]
      });
    }else{
      // 不支援 focusMode 的瀏覽器，用微幅重新套用 constraints 觸發相機重新測光/對焦。
      const settings=
        typeof cameraTrack.getSettings==='function'
          ? cameraTrack.getSettings()
          : {};

      await cameraTrack.applyConstraints({
        width:{ideal:settings.width||1920},
        height:{ideal:settings.height||1080}
      });
    }

    $('cameraStatus').textContent='已重新對焦，請保持 QR Code 穩定約 1 秒。';

  }catch(e){
    $('cameraStatus').textContent='此手機不支援手動重新對焦，請將 QR Code 前後移動約 5～10 公分。';
  }
}


async function setCameraZoom(value){
  if(!cameraTrack || !cameraCapabilities?.zoom){
    $('cameraStatus').textContent='此手機瀏覽器不支援程式控制變焦。';
    return;
  }

  const min=Number(cameraCapabilities.zoom.min ?? 1);
  const max=Number(cameraCapabilities.zoom.max ?? 1);
  const zoom=Math.max(min,Math.min(max,Number(value)));

  try{
    await cameraTrack.applyConstraints({
      advanced:[{zoom}]
    });

    currentZoom=zoom;

    document.querySelectorAll('.zoom-btn').forEach(btn=>{
      btn.classList.remove('active');
    });

    const target=
      Math.abs(zoom-1)<.15
        ? 'zoom1Btn'
        : (
          Math.abs(zoom-1.5)<.25
            ? 'zoom15Btn'
            : 'zoom2Btn'
        );

    $(target)?.classList.add('active');

    $('cameraStatus').textContent=`鏡頭 ${zoom.toFixed(1)}×｜請保持 QR Code 清晰穩定`;

  }catch(e){
    $('cameraStatus').textContent='變焦調整失敗，請使用手機實體距離調整。';
  }
}


async function toggleTorch(){
  if(!cameraTrack || !cameraCapabilities?.torch)return;

  torchOn=!torchOn;

  try{
    await cameraTrack.applyConstraints({
      advanced:[{torch:torchOn}]
    });

    $('torchBtn').textContent=
      torchOn
        ? '🔦 關閉補光'
        : '🔦 補光';

  }catch(e){
    torchOn=false;
    $('cameraStatus').textContent='此裝置目前無法控制補光燈。';
  }
}




function showDuplicatePatrolPopup({
  pointId='',
  message=''
}={}){
  const popup=$('duplicatePatrolPopup');
  if(!popup)return;

  $('duplicatePatrolPoint').textContent=
    pointId || '巡查點';

  $('duplicatePatrolDetail').textContent=
    message ||
    '本次不會重複寫入簽到紀錄。';

  popup.classList.remove('hidden');
  document.body.classList.add('popup-open');

  scannerPausedAfterSuccess=true;

  try{
    if(scanner && typeof scanner.pause==='function'){
      scanner.pause(false);
    }
  }catch(e){}

  if(navigator.vibrate){
    navigator.vibrate([80,60,80]);
  }
}


function closeDuplicatePatrolPopup(){
  const popup=$('duplicatePatrolPopup');
  if(popup){
    popup.classList.add('hidden');
  }

  document.body.classList.remove('popup-open');
}


function continueAfterDuplicatePatrol(){
  closeDuplicatePatrolPopup();

  $('manualQr').value='';
  $('patrolSuccessBadge').classList.add('hidden');

  scannerPausedAfterSuccess=false;
  scanBusy=false;

  status(
    'patrolMessage',
    '請掃描下一個巡查點。',
    'info'
  );

  try{
    if(scanner && typeof scanner.resume==='function'){
      scanner.resume();
    }
  }catch(e){}
}


function showScanSuccessPopup({
  pointName='巡查點',
  pointId='',
  time='',
  distance=''
}={}){
  $('scanSuccessPoint').textContent=
    pointId
      ? `${pointId}｜${pointName}`
      : pointName;

  $('scanSuccessTime').textContent=
    time || '—';

  $('scanSuccessDistance').textContent=
    distance!=='' && distance!==null && distance!==undefined
      ? `約 ${distance} 公尺`
      : '—';

  $('scanSuccessPopup').classList.remove('hidden');
  document.body.classList.add('popup-open');
}

function closeScanSuccessPopup(){
  $('scanSuccessPopup').classList.add('hidden');
  document.body.classList.remove('popup-open');
}

function pauseScannerKeepVideo(){
  scannerPausedAfterSuccess=true;
  scanBusy=true;

  // false = 停止 QR 解碼，但 video 保持播放，不黑屏。
  try{
    if(scanner && typeof scanner.pause==='function'){
      scanner.pause(false);
    }
  }catch(e){}

  $('cameraStatus').textContent='巡查完成｜鏡頭保持開啟';
  $('continueScanBtn').classList.remove('hidden');
}


async function continueScanning(){
  $('patrolSuccessBadge').classList.add('hidden');
  $('continueScanBtn').classList.add('hidden');
  $('pointCard').classList.add('hidden');
  $('manualQr').value='';
  status('patrolMessage','請掃描下一個巡查點 QR Code。','info');

  scannerPausedAfterSuccess=false;
  scanBusy=false;

  try{
    if(scanner && typeof scanner.resume==='function'){
      scanner.resume();
      $('cameraStatus').textContent='後置鏡頭已啟動｜請掃描下一巡查點';
    }else if(!scanner){
      await startScanner();
    }
  }catch(e){
    await startScanner();
  }
}


async function stopScanner(){
  scannerPausedAfterSuccess=false;
  scanBusy=false;

  if(cameraTrack){
    try{
      if(torchOn && cameraCapabilities?.torch){
        await cameraTrack.applyConstraints({
          advanced:[{torch:false}]
        });
      }
    }catch(e){}
  }

  if(scanner){
    try{
      if(scanner.isScanning)await scanner.stop();
      scanner.clear();
    }catch(e){}
    scanner=null;
  }

  cameraTrack=null;
  cameraCapabilities=null;
  torchOn=false;

  if($('reader')){
    $('reader').innerHTML='';
  }

  if($('cameraControls')){
    $('cameraControls').classList.add('hidden');
  }

  if($('continueScanBtn')){
    $('continueScanBtn').classList.add('hidden');
  }
}


async function processQr(raw){
  if(!currentPerson){
    scanBusy=false;
    try{
      if(scanner && typeof scanner.resume==='function'){
        scanner.resume();
      }
    }catch(e){}
    return;
  }

  const qr=normalizeQr(raw);

  if(!qr){
    status('patrolMessage','請掃描或輸入 QR 識別碼。','warn');
    scanBusy=false;
    try{
      if(scanner && typeof scanner.resume==='function'){
        scanner.resume();
      }
    }catch(e){}
    return;
  }

  try{
    // QR 已經由手機端成功解碼，不再多做一次 checkpoint API 查詢。
    // 直接取得 GPS，最後只呼叫一次 patrol API，由後端完成 QR + GPS 驗證。
    status(
      'patrolMessage',
      `QR 已辨識：${qr}｜正在取得 GPS…`,
      'info'
    );

    $('pointCard').classList.remove('hidden');
    $('pointName').textContent='正在驗證巡查點…';
    $('pointCode').textContent=qr;
    $('maxDistance').textContent='驗證中';
    $('checkpointGpsState').textContent='驗證中';

    const gps=await getGps();

    $('gpsAccuracy').textContent=
      `約 ±${Math.round(gps.accuracy)} 公尺`;

    status(
      'patrolMessage',
      `QR ${qr} 已辨識｜GPS 已取得｜正在寫入巡查紀錄…`,
      'info'
    );

    const r=await apiCall('patrol',{
      personId:currentPerson.personId,
      qr,
      lat:gps.lat,
      lng:gps.lng
    });

    const cp=r.checkpoint||{};

    $('pointName').textContent=
      cp.name||cp.checkpointId||qr;

    $('pointCode').textContent=
      `${cp.checkpointId||qr}｜${cp.qr||qr}`;

    $('maxDistance').textContent=
      `${cp.radius||100} 公尺`;

    $('checkpointGpsState').textContent='已驗證';

    // 成功後只暫停 QR 辨識，保留鏡頭即時畫面。
    scannerPausedAfterSuccess=true;

    const successText=
      `${cp.name||'巡查點'}｜GPS 約 ${r.distance} 公尺`;

    $('patrolSuccessText').textContent=successText;
    $('patrolSuccessBadge').classList.remove('hidden');

    showScanSuccessPopup({
      pointName:cp.name||'巡查點',
      pointId:cp.checkpointId||qr,
      time:r.serverTime||'',
      distance:r.distance
    });

    if(navigator.vibrate){
      navigator.vibrate([120,60,120]);
    }

    status(
      'patrolMessage',
      `${r.message} 時間：${r.serverTime}`,
      'ok'
    );

    await refreshDutyDashboard();

  }catch(e){
    const msg=String(e?.message||'巡查失敗');

    const isDuplicatePatrol=
      msg.includes('不可重複簽到') ||
      msg.includes('重複巡查') ||
      msg.includes('重複簽到') ||
      msg.includes('無須重複打卡') ||
      msg.includes('已由');

    if(isDuplicatePatrol){
      status(
        'patrolMessage',
        '本巡查點於本時段已完成，本次未重複寫入紀錄。',
        'warn'
      );

      showDuplicatePatrolPopup({
        pointId:qr,
        message:msg + ' 本次不會重複寫入簽到紀錄。'
      });

      // 保持暫停，等使用者按「改掃下一個巡查點」後再恢復。
      return;
    }

    status('patrolMessage',msg,'err');

    scannerPausedAfterSuccess=false;

    setTimeout(()=>{
      scanBusy=false;

      try{
        if(scanner && typeof scanner.resume==='function'){
          scanner.resume();
        }
      }catch(ignore){}
    },500);
  }
}

async function openRecords(){
  showView('recordsView');
  await loadTodayRecords();
  await refreshDutyDashboard();
}

async function loadTodayRecords(){
  if(!currentPerson)return;

  status('recordsMessage','正在讀取本班紀錄…','info');
  $('recordsList').innerHTML='';

  try{
    const r=await apiCall('dutyRecords',{
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
    box.innerHTML='<div class="empty">本班尚無勤務紀錄。</div>';
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
