
let currentPerson=null;
let currentDuty=null;
let currentPassword='';
let currentSessionToken='';
let currentSessionExpiresAt=0;
let scanner=null;
let scanBusy=false;
let cameraTrack=null;
let cameraCapabilities=null;
let currentZoom=1;
let torchOn=false;
let scannerPausedAfterSuccess=false;
let specialExemptCustomTime=false;

// GPS 快速驗證：進入巡查頁時先背景預熱定位。
let gpsWarmWatchId=null;
let lastGpsFix=null;
const GPS_WARM_MAX_AGE_MS=15000;
const GPS_WARM_GOOD_ACCURACY_M=60;
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

const DAILY_SESSION_KEYS={
  personId:'ksp_guard_person_id',
  token:'ksp_guard_session_token',
  expiresAt:'ksp_guard_session_expires_at'
};


function saveDailySession(
  personId,
  token,
  expiresAt
){
  if(
    !personId ||
    !token ||
    !expiresAt
  ){
    return;
  }

  localStorage.setItem(
    DAILY_SESSION_KEYS.personId,
    personId
  );

  localStorage.setItem(
    DAILY_SESSION_KEYS.token,
    token
  );

  localStorage.setItem(
    DAILY_SESSION_KEYS.expiresAt,
    String(expiresAt)
  );
}


function clearDailySession(){
  localStorage.removeItem(
    DAILY_SESSION_KEYS.token
  );

  localStorage.removeItem(
    DAILY_SESSION_KEYS.expiresAt
  );

  currentSessionToken='';
  currentSessionExpiresAt=0;
}


function getSavedDailySession(){
  const personId=
    String(
      localStorage.getItem(
        DAILY_SESSION_KEYS.personId
      ) || ''
    )
    .trim()
    .toUpperCase();

  const token=
    String(
      localStorage.getItem(
        DAILY_SESSION_KEYS.token
      ) || ''
    ).trim();

  const expiresAt=
    Number(
      localStorage.getItem(
        DAILY_SESSION_KEYS.expiresAt
      ) || 0
    );

  if(
    !personId ||
    !token ||
    !expiresAt ||
    Date.now()>=expiresAt
  ){
    return null;
  }

  return {
    personId,
    token,
    expiresAt
  };
}


function applyLoginResponse(
  r,
  options={}
){
  currentPerson=r.person;
  currentDuty=r.duty||null;

  if(r.sessionToken){
    currentSessionToken=r.sessionToken;
    currentSessionExpiresAt=Number(
      r.sessionExpiresAt||0
    );

    saveDailySession(
      currentPerson.personId,
      currentSessionToken,
      currentSessionExpiresAt
    );
  }

  localStorage.setItem(
    DAILY_SESSION_KEYS.personId,
    currentPerson.personId
  );

  $('personId').value=currentPerson.personId;
  $('staffLabel').textContent=
    `${currentPerson.name}｜${currentPerson.personId}`;

  renderDuty(currentDuty);

  const exempt=r.patrolExempt;
  if(exempt?.exempt){
    $('patrolExempt').textContent=
      `目前免巡查：${exempt.reason}`;
    $('patrolExempt').classList.remove('hidden');
  }else{
    $('patrolExempt').classList.add('hidden');
  }

  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');

  status(
    'mainMessage',
    options.auto
      ? '已自動恢復今日登入，正在讀取勤務資料…'
      : (
          currentDuty
            ? `登入成功。伺服器時間：${r.serverTime}`
            : '登入成功，但目前查無勤務班表。'
        ),
    options.auto
      ? 'info'
      : (currentDuty?'ok':'warn')
  );
}


async function tryResumeDailyLogin(){
  const saved=getSavedDailySession();

  if(!saved){
    return false;
  }

  const btn=$('loginBtn');
  btn.disabled=true;
  btn.textContent='正在恢復今日登入…';

  try{
    const r=await apiCall(
      'resumeLogin',
      {
        personId:saved.personId,
        sessionToken:saved.token
      }
    );

    currentPassword='';
    currentSessionToken=saved.token;
    currentSessionExpiresAt=saved.expiresAt;

    applyLoginResponse(
      r,
      {auto:true}
    );

    await refreshDutyDashboard();

    status(
      'mainMessage',
      '今日已登入，可直接使用。',
      'ok'
    );

    return true;

  }catch(e){
    const message=String(e.message||'');

    if(
      /登入憑證|逾期|帳號目前未啟用|人員資料/.test(message)
    ){
      clearDailySession();
    }

    status(
      'loginMessage',
      /API|連線|逾時/.test(message)
        ? '暫時無法恢復登入，請確認網路後重新開啟。'
        : '今日登入已失效，請重新輸入密碼。',
      'warn'
    );

    return false;

  }finally{
    btn.disabled=false;
    btn.textContent='登入系統';
  }
}


document.addEventListener('DOMContentLoaded',()=>{
  const saved=localStorage.getItem(DAILY_SESSION_KEYS.personId);
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
document.querySelectorAll('.manual-qr-chip').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const qr=btn.dataset.qr||'';
      $('manualQr').value=qr;
      $('manualQr').focus();
    });
  });

  $('manualQr').addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      processQr($('manualQr').value);
    }
  });
  $('patrolBackBtn').addEventListener('click',()=>showView('mainView'));
  $('manualQrBtn').addEventListener('click',()=>processQr($('manualQr').value));
  $('submitBackfillPatrolBtn').addEventListener('click',submitBackfillPatrol);
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

  $('monthlyReportBtn').addEventListener('click',openMonthlyReport);
  $('monthlyReportBackBtn').addEventListener('click',()=>showView(currentPerson?'mainView':'loginView'));
  $('generateClockReportBtn').addEventListener('click',()=>generateMonthlyReport('clock'));
  $('generatePatrolReportBtn').addEventListener('click',()=>generateMonthlyReport('patrol'));
  $('generateFullReportBtn').addEventListener('click',()=>generateMonthlyReport('full'));

  $('substituteBtn').addEventListener('click',openSubstitute);
  $('substituteBackBtn').addEventListener('click',()=>showView('mainView'));
  $('substituteDate').addEventListener('change',loadSubstituteOptions);
  $('setSubstituteBtn').addEventListener('click',setSubstitute);
  $('refreshSubstituteBtn').addEventListener('click',loadSubstituteOptions);

  $('incidentBtn').addEventListener('click',openIncident);
  $('incidentBackBtn').addEventListener('click',()=>showView('mainView'));
  $('incidentPhoto').addEventListener('change',previewPhoto);
  $('removePhotoBtn').addEventListener('click',clearPhoto);
  $('submitIncidentBtn').addEventListener('click',submitIncident);

  $('specialExemptBtn').addEventListener('click',openSpecialExempt);
  $('specialExemptBackBtn').addEventListener('click',()=>showView('mainView'));
  $('specialExemptDate').addEventListener('change',loadSpecialExemptStatus);
  $('specialExemptScope').addEventListener('change',updateSpecialExemptScopeUi);
  $('specialExemptTimeToggle').addEventListener('click',toggleSpecialExemptTime);
  $('specialExemptFullShiftBtn').addEventListener('click',useFullShiftSpecialExempt);
  $('specialExemptStartTime').addEventListener('change',updateSpecialExemptTimeSummary);
  $('specialExemptEndTime').addEventListener('change',updateSpecialExemptTimeSummary);
  $('setSpecialExemptBtn').addEventListener('click',setSpecialExempt);
$('successCloseBtn').addEventListener('click',hideSuccess);

  checkApi().finally(()=>{
    tryResumeDailyLogin();
  });

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
    'monthlyReportView',
    'incidentView',
    'substituteView',
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
    stopGpsWarmup();
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
    const r=await apiCall(
      'login',
      {personId,password}
    );

    currentPassword=password;
    currentSessionToken=r.sessionToken||'';
    currentSessionExpiresAt=Number(r.sessionExpiresAt||0);

    applyLoginResponse(r);
    status('loginMessage','');

    await refreshDutyDashboard();

    status(
      'mainMessage',
      '登入成功；本裝置 24 小時內重新開啟系統將自動登入。',
      'ok'
    );

  }catch(e){
    status('loginMessage',e.message,'err');
  }finally{
    btn.disabled=false;
    btn.textContent='登入系統';
  }
}
function renderDuty(duty){
  $('todayShift').textContent=
    duty
      ? `${duty.shift||''}${duty.isSubstitute?'｜代班':''}`
      : '今日無排班';

  $('dutyDate').textContent=duty?.dutyDate||'—';
  $('dutyStart').textContent=duty?.startTime||'—';
  $('dutyEnd').textContent=duty?.endTime||'—';

  const notice=$('substituteDutyNotice');

  if(notice){
    if(duty?.isSubstitute){
      notice.textContent=
        `目前為代班勤務｜原排班：${duty.substituteForName||duty.substituteForId||'—'}`;
      notice.classList.remove('hidden');
    }else{
      notice.textContent='';
      notice.classList.add('hidden');
    }
  }
}

function logout(){
  currentPerson=null;
  currentDuty=null;
  currentPassword='';
  clearDailySession();
  stopScanner();
  $('password').value='';
  ['mainView','patrolView','recordsView','incidentView','substituteView','specialExemptView']
    .forEach(id=>$(id).classList.add('hidden'));
  $('loginView').classList.remove('hidden');
  status('loginMessage','');
}

function gpsFixFromPosition_(p){
  if(!p || !p.coords){
    return null;
  }

  const fix={
    lat:Number(p.coords.latitude),
    lng:Number(p.coords.longitude),
    accuracy:Number(p.coords.accuracy||9999),
    timestamp:Number(p.timestamp||Date.now())
  };

  if(
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng)
  ){
    return null;
  }

  return fix;
}


function rememberGpsFix_(p){
  const fix=gpsFixFromPosition_(p);

  if(fix){
    lastGpsFix=fix;
  }

  return fix;
}


function startGpsWarmup(){
  if(
    !navigator.geolocation ||
    gpsWarmWatchId!==null
  ){
    return;
  }

  try{
    gpsWarmWatchId=
      navigator.geolocation.watchPosition(
        p=>{
          rememberGpsFix_(p);
        },
        ()=>{
          // 預熱失敗不顯示錯誤；
          // 真正巡查時 getGps() 仍會再嘗試並顯示原因。
        },
        {
          enableHighAccuracy:true,
          timeout:8000,
          maximumAge:5000
        }
      );
  }catch(e){
    gpsWarmWatchId=null;
  }
}


function stopGpsWarmup(){
  if(
    gpsWarmWatchId===null ||
    !navigator.geolocation
  ){
    return;
  }

  try{
    navigator.geolocation.clearWatch(
      gpsWarmWatchId
    );
  }catch(e){}

  gpsWarmWatchId=null;
}


function getGps(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('此裝置不支援 GPS。'));
      return;
    }

    // 巡查頁若已在背景取得 15 秒內、誤差 60 公尺內的位置，
    // 直接使用，不再重新等待 GPS。
    if(lastGpsFix){
      const age=
        Date.now() -
        Number(lastGpsFix.timestamp||0);

      if(
        age>=0 &&
        age<=GPS_WARM_MAX_AGE_MS &&
        Number(lastGpsFix.accuracy)<=
          GPS_WARM_GOOD_ACCURACY_M
      ){
        resolve({
          lat:lastGpsFix.lat,
          lng:lastGpsFix.lng,
          accuracy:lastGpsFix.accuracy,
          source:'warm'
        });
        return;
      }
    }

    // 無可用預熱定位時，再要求一次高精度定位。
    // 最大等待由原本 20 秒縮短為 8 秒，並允許使用 10 秒內定位。
    navigator.geolocation.getCurrentPosition(
      p=>{
        const fix=
          rememberGpsFix_(p);

        if(!fix){
          reject(
            new Error(
              'GPS 定位資料無效，請重新操作。'
            )
          );
          return;
        }

        resolve({
          lat:fix.lat,
          lng:fix.lng,
          accuracy:fix.accuracy,
          source:'current'
        });
      },
      e=>{
        let msg='無法取得 GPS 定位。';

        if(e.code===1){
          msg='定位權限被拒絕，請允許網站使用位置資訊。';
        }

        if(e.code===2){
          msg='目前無法取得位置資訊，請移到較開放處再試。';
        }

        if(e.code===3){
          msg='GPS 定位逾時，請稍移動手機或到較開放處後重新操作。';
        }

        reject(
          new Error(
            msg
          )
        );
      },
      {
        enableHighAccuracy:true,
        timeout:8000,
        maximumAge:10000
      }
    );
  });
}

async function doClock(action){
  if(!currentPerson){
    return;
  }

  const isOut=
    action==='clockOut';

  const title=
    isOut
      ? '下班簽退'
      : '上班簽到';

  if(
    isOut &&
    !confirm(
      '確認本班勤務已完成，現在進行下班簽退？'
    )
  ){
    return;
  }

  status(
    'mainMessage',
    `正在取得 GPS，準備${title}…`,
    'info'
  );

  try{
    const gps=
      await getGps();

    const r=
      await apiCall(
        action,
        {
          personId:
            currentPerson.personId,
          lat:
            gps.lat,
          lng:
            gps.lng
        }
      );

    currentDuty=
      r.duty||
      currentDuty;

    renderDuty(
      currentDuty
    );

    showSuccess(
      title+'完成',
      `${r.message}\n`+
      `時間：${r.serverTime}\n`+
      `GPS距離：約 ${r.distance} 公尺`
    );

    status(
      'mainMessage',
      r.message,
      'ok'
    );

    await refreshDutyDashboard();

  }catch(e){
    status(
      'mainMessage',
      e.message,
      'err'
    );
  }
}


async function refreshDutyDashboard(){
  if(!currentPerson){
    return;
  }

  try{
    const result=
      await apiCall(
        'dashboard',
        {
          personId:
            currentPerson.personId
        }
      );

    currentDuty=
      result.duty||null;

    renderDuty(
      currentDuty
    );

    const records=
      Array.isArray(
        result.records
      )
        ? result.records
        : [];

    const clockInRecord=
      result.clockStatus
        ?.clockInRecord ||
      records.find(
        x=>
          String(
            x.action||''
          )==='上班簽到'
      ) ||
      null;

    const clockOutRecord=
      result.clockStatus
        ?.clockOutRecord ||
      records.find(
        x=>
          String(
            x.action||''
          )==='下班簽退'
      ) ||
      null;

    const patrolRecords=
      records.filter(
        x=>{
          const action=
            String(
              x.action||''
            );

          return (
            action==='定點巡查' ||
            action==='定點巡查指定時間登錄'
          );
        }
      );

    const latest=
      records.length
        ? records[
            records.length-1
          ]
        : null;

    todayDutyState={
      hasDuty:
        !!currentDuty,
      clockedIn:
        typeof result.clockStatus?.clockedIn==='boolean'
          ? result.clockStatus.clockedIn
          : !!clockInRecord,
      clockedOut:
        typeof result.clockStatus?.clockedOut==='boolean'
          ? result.clockStatus.clockedOut
          : !!clockOutRecord,
      patrolCount:
        patrolRecords.length,
      patrolProgress:
        result.progress||null,
      specialExempt:
        result.specialExempt||null,
      lastAction:
        latest?.action||'',
      lastTime:
        latest?.time||''
    };

    renderDutyDashboard();
    renderHourlyPatrolProgress();

    if(
      Array.isArray(
        result.warnings
      ) &&
      result.warnings.length
    ){
      console.warn(
        'Dashboard 部分資料讀取警告：',
        result.warnings
      );
    }

  }catch(e){
    todayDutyState={
      hasDuty:
        !!currentDuty,
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

    status(
      'mainMessage',
      e.message,
      'err'
    );
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
  let stateText='目前無有效排班';

  const prefix=
    currentDuty?.isSubstitute
      ? '代班｜'
      : '';

  if(
    todayDutyState.hasDuty &&
    !todayDutyState.clockedIn
  ){
    stateClass='state-wait';
    stateIcon='●';
    stateText=
      prefix+
      '尚未上班簽到';
  }

  if(
    todayDutyState.hasDuty &&
    todayDutyState.clockedIn &&
    !todayDutyState.clockedOut
  ){
    stateClass='state-active';
    stateIcon='✓';
    stateText=
      prefix+
      '已上班｜勤務中';
  }

  if(
    todayDutyState.hasDuty &&
    todayDutyState.clockedOut
  ){
    stateClass='state-done';
    stateIcon='✓';
    stateText=
      prefix+
      '已簽退｜勤務完成';
  }

  // 特殊情況只影響巡查是否強制，
  // 不取代個人的上下班簽到／簽退狀態。
  panel.classList.add(
    stateClass
  );

  icon.textContent=
    stateIcon;

  text.textContent=
    stateText;

  const progress=todayDutyState.patrolProgress;

  patrolChip.textContent=
    progress && Number(progress.requiredChecks||0)>0
      ? `定點完成 ${progress.completedChecks||0} / ${progress.requiredChecks}`
      : `巡查紀錄 ${todayDutyState.patrolCount} 筆`;

  const specialBanner=$('specialExemptBanner');

  if(specialBanner){
    const special=
      todayDutyState.specialExempt;

    const lines=[];

    if(
      Array.isArray(
        special?.shiftEntries
      ) &&
      special.shiftEntries.length
    ){
      special.shiftEntries.forEach(
        x=>{
          lines.push(
            `整班不用打卡：${x.timeLabel||'整班'}｜${x.reason||'特殊情形'}`
          );
        }
      );
    }else if(
      special?.exempt &&
      special.record
    ){
      lines.push(
        `整班不用打卡：${special.record.timeLabel||'整班'}｜${special.record.reason||'特殊情形'}`
      );
    }

    const personal=
      special?.personalSupport;

    if(
      Array.isArray(
        personal?.entries
      ) &&
      personal.entries.length
    ){
      personal.entries.forEach(
        x=>{
          lines.push(
            `個人支援：${x.timeLabel||'整班'}｜${x.reason||'勤務支援'}｜本時段不需參與巡查`
          );
        }
      );
    }

    if(lines.length){
      specialBanner.className=
        'special-exempt-banner';

      specialBanner.removeAttribute(
        'aria-hidden'
      );

      specialBanner.innerHTML=
        lines.map(
          x=>`<div>${esc(x)}</div>`
        ).join('');
    }else{
      specialBanner.className=
        'hidden';

      specialBanner.setAttribute(
        'aria-hidden',
        'true'
      );

      specialBanner.textContent='';
    }
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

  const special=
    progress.specialExempt;

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

  if(
    special?.exempt &&
    requiredChecks===0
  ){
    count.textContent=
      '不用打卡';

    bar.style.width='100%';
  }else{
    count.textContent=
      `${completedChecks} / ${requiredChecks}`;

    bar.style.width=
      requiredChecks
        ? `${Math.round(
            completedChecks /
            requiredChecks *
            100
          )}%`
        : '0%';
  }

  const currentSlot=
    Array.isArray(progress.slots)
      ? progress.slots.find(
          x=>x.status==='current'
        )
      : null;

  const currentSpecialSlot=
    Array.isArray(progress.slots)
      ? progress.slots.find(
          x=>
            x.status==='special' &&
            (
              x.startDate===
                new Date().toLocaleDateString('zh-TW',{
                  timeZone:'Asia/Taipei',
                  year:'numeric',
                  month:'2-digit',
                  day:'2-digit'
                }).replaceAll('-','/') ||
              special?.activeNow
            )
        )
      : null;

  if(
    special?.activeNow
  ){
    summary.textContent=
      `目前不用打卡｜${special.reason||'特殊情形'}｜${special.timeLabel||''}`;
  }else if(
    special?.exempt
  ){
    summary.textContent=
      `不用打卡時段 ${special.timeLabel||''}｜事由：${special.reason||'特殊情形'}`;
  }else{
    summary.textContent=
      missedChecks>0
        ? `已完成 ${completedChecks} 點次｜漏簽 ${missedChecks} 點次`
        : (
          currentSlot
            ? `目前 ${currentSlot.startTime}–${currentSlot.endTime}｜${currentSlot.completedPoints||0}/5`
            : `已完成 ${completedChecks} / ${requiredChecks} 點次`
        );
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
          `不用打卡｜${esc(slot.specialReason||'特殊情形')}`;
      }

      const points=
        Array.isArray(slot.points)
          ? slot.points
          : [];

      const pointHtml=
        (
          slot.status==='exempt' ||
          slot.status==='special'
        )
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
  const s=
    todayDutyState;

  const patrolBtn=
    $('patrolBtn');

  const patrolSmall=
    patrolBtn?.querySelector(
      'small'
    );

  // 無有效班表：上下班及巡查皆停用。
  if(!s.hasDuty){
    const reason=
      '目前沒有有效排班；如為臨時代班，請先完成代班設定。';

    setActionButtonState(
      'clockInBtn',
      true,
      reason
    );

    setActionButtonState(
      'patrolBtn',
      true,
      reason
    );

    setActionButtonState(
      'clockOutBtn',
      true,
      reason
    );

    return;
  }

  // 尚未上班簽到：先完成個人簽到。
  if(!s.clockedIn){
    setActionButtonState(
      'clockInBtn',
      false
    );

    setActionButtonState(
      'patrolBtn',
      true,
      '請先完成上班簽到'
    );

    setActionButtonState(
      'clockOutBtn',
      true,
      '請先完成上班簽到'
    );

    if(patrolSmall){
      patrolSmall.textContent=
        '請先上班簽到';
    }

    return;
  }

  // 已完成上班、尚未簽退。
  if(
    s.clockedIn &&
    !s.clockedOut
  ){
    setActionButtonState(
      'clockInBtn',
      true,
      '已完成上班簽到'
    );

    setActionButtonState(
      'patrolBtn',
      false
    );

    setActionButtonState(
      'clockOutBtn',
      false
    );

    if(patrolSmall){
      if(
        s.specialExempt?.activeNow
      ){
        const reason=
          s.specialExempt.record?.reason||
          '特殊情形';

        patrolSmall.textContent=
          `不用打卡｜${reason}｜仍可巡查`;
      }else if(
        s.specialExempt
          ?.personalSupport
          ?.activeNow
      ){
        const reason=
          s.specialExempt
            .personalSupport
            .current
            ?.reason||
          '勤務支援';

        patrolSmall.textContent=
          `個人支援｜${reason}｜不需參與巡查`;
      }else{
        patrolSmall.textContent=
          'QR＋GPS';
      }
    }

    return;
  }

  // 已簽退：本班個人勤務完成。
  setActionButtonState(
    'clockInBtn',
    true,
    '本班已完成'
  );

  setActionButtonState(
    'patrolBtn',
    true,
    '本班已完成簽退'
  );

  setActionButtonState(
    'clockOutBtn',
    true,
    '已完成下班簽退'
  );

  if(patrolSmall){
    patrolSmall.textContent=
      '本班已完成';
  }
}


function dutyDateToInput(dateText){
  return String(dateText||'')
    .replaceAll('/','-');
}




function updateSpecialExemptScopeUi(){
  const scope=
    $('specialExemptScope').value;

  const peopleWrap=
    $('specialExemptPeopleWrap');

  const warning=
    $('specialExemptShiftWarning');

  const btn=
    $('setSpecialExemptBtn');

  if(scope==='SHIFT'){
    peopleWrap.classList.add('hidden');
    warning.classList.remove('hidden');

    if(btn){
      btn.textContent=
        '設定整班巡查不強制';
    }
  }else{
    peopleWrap.classList.remove('hidden');
    warning.classList.add('hidden');

    if(btn){
      btn.textContent=
        '設定指定人員支援';
    }
  }
}


function renderSpecialExemptPeople(
  roster
){
  const box=
    $('specialExemptPeopleList');

  if(
    !box ||
    !Array.isArray(roster) ||
    !roster.length
  ){
    box.innerHTML=
      '<div class="empty">此勤務日查無可選人員。</div>';
    return;
  }

  box.innerHTML=
    roster.map(
      x=>{
        const isMe=
          currentPerson &&
          x.personId===
            currentPerson.personId;

        return `
          <label class="special-person-option">
            <input
              type="checkbox"
              class="special-person-check"
              value="${esc(x.personId)}"
              ${isMe?'checked':''}
            >
            <span>
              <strong>${esc(x.name||x.personId)}</strong>
              <small>${esc(x.personId)}${x.isSubstitute?'｜代班':''}</small>
            </span>
          </label>
        `;
      }
    ).join('');
}


function selectedSpecialPersonIds(){
  return Array.from(
    document.querySelectorAll(
      '.special-person-check:checked'
    )
  ).map(
    x =>
      x.value
  ).filter(Boolean);
}


function renderSpecialSettings(
  entries
){
  const box=
    $('specialExemptCurrent');

  if(
    !Array.isArray(entries) ||
    !entries.length
  ){
    box.classList.remove('active');
    box.innerHTML=
      '目前設定：本班沒有啟用中的特殊勤務設定。';
    return;
  }

  box.classList.add('active');

  box.innerHTML=
    entries.map(
      x=>{
        const isPersonal=
          x.scope==='PERSONAL';

        const scopeText=
          isPersonal
            ? '指定人員支援'
            : '整班巡查不強制';

        const targets=
          isPersonal
            ? (
                Array.isArray(
                  x.targetPersonNames
                ) &&
                x.targetPersonNames.length
                  ? x.targetPersonNames.join('、')
                  : (
                      x.targetPersonIds||[]
                    ).join('、')
              )
            : '整班';

        const note=
          x.note
            ? `<div class="special-setting-note">${esc(x.note)}</div>`
            : '';

        return `
          <div class="special-setting-card ${isPersonal?'personal':'shift'}">
            <div class="special-setting-top">
              <span class="special-setting-badge">${scopeText}</span>
              <button
                type="button"
                class="text-btn special-setting-cancel"
                data-id="${esc(x.exemptionId||'')}"
              >取消設定</button>
            </div>
            <strong>${esc(x.timeLabel||'整班')}｜${esc(x.reason||'特殊情形')}</strong>
            <div class="special-setting-target">
              ${isPersonal?'支援人員：':'適用：'}${esc(targets)}
            </div>
            ${note}
            <small>設定：${esc(x.name||'—')}｜${esc(x.createdAt||'—')}</small>
          </div>
        `;
      }
    ).join('');

  box
    .querySelectorAll(
      '.special-setting-cancel'
    )
    .forEach(
      btn=>{
        btn.addEventListener(
          'click',
          ()=>{
            cancelSpecialExempt(
              btn.dataset.id
            );
          }
        );
      }
    );
}


function setSpecialExemptCustomMode(
  enabled
){
  specialExemptCustomTime=
    !!enabled;

  const controls=
    $('specialExemptTimeControls');

  const toggle=
    $('specialExemptTimeToggle');

  if(
    !controls ||
    !toggle
  ){
    return;
  }

  controls.classList.toggle(
    'hidden',
    !specialExemptCustomTime
  );

  toggle.textContent=
    specialExemptCustomTime
      ? '收合時段'
      : '調整時段';

  updateSpecialExemptTimeSummary();
}


function toggleSpecialExemptTime(){
  if(
    !specialExemptCustomTime
  ){
    const start=
      $('specialExemptStartTime');

    const end=
      $('specialExemptEndTime');

    if(
      !start.value &&
      currentDuty?.startTime
    ){
      start.value=
        currentDuty.startTime;
    }

    if(
      !end.value &&
      currentDuty?.endTime
    ){
      end.value=
        currentDuty.endTime;
    }
  }

  setSpecialExemptCustomMode(
    !specialExemptCustomTime
  );
}


function useFullShiftSpecialExempt(){
  specialExemptCustomTime=false;

  $('specialExemptStartTime').value='';
  $('specialExemptEndTime').value='';

  setSpecialExemptCustomMode(
    false
  );
}


function updateSpecialExemptTimeSummary(){
  const summary=
    $('specialExemptTimeSummary');

  if(!summary){
    return;
  }

  if(!specialExemptCustomTime){
    const start=
      currentDuty?.startTime||'';

    const end=
      currentDuty?.endTime||'';

    summary.textContent=
      start && end
        ? `整班 ${start}–${end}`
        : '整班';

    return;
  }

  const start=
    $('specialExemptStartTime').value;

  const end=
    $('specialExemptEndTime').value;

  summary.textContent=
    start && end
      ? `${start}–${end}`
      : '請設定開始／結束時間';
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

  if(!$('specialExemptScope').value){
    $('specialExemptScope').value='PERSONAL';
  }

  updateSpecialExemptScopeUi();
  loadSpecialExemptStatus();
}


async function loadSpecialExemptStatus(){
  if(!currentPerson){
    return;
  }

  const dutyDate=
    $('specialExemptDate').value;

  if(!dutyDate){
    $('specialExemptCurrent').textContent=
      '目前設定：請先選擇勤務日期';

    renderSpecialExemptPeople([]);
    return;
  }

  try{
    const r=
      await apiCall(
        'specialExemptStatus',
        {
          personId:
            currentPerson.personId,
          dutyDate:
            dutyDate
        }
      );

    renderSpecialExemptPeople(
      r.roster||[]
    );

    renderSpecialSettings(
      r.allEntries||[]
    );

    updateSpecialExemptScopeUi();

  }catch(e){
    $('specialExemptCurrent').textContent=
      '目前設定：讀取失敗';

    renderSpecialExemptPeople([]);

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

  const dutyDate=
    $('specialExemptDate').value;

  const scope=
    $('specialExemptScope').value||
    'PERSONAL';

  const reason=
    $('specialExemptReason').value;

  const note=
    $('specialExemptNote').value.trim();

  const startTime=
    specialExemptCustomTime
      ? $('specialExemptStartTime').value
      : '';

  const endTime=
    specialExemptCustomTime
      ? $('specialExemptEndTime').value
      : '';

  const targetPersonIds=
    scope==='PERSONAL'
      ? selectedSpecialPersonIds()
      : [];

  if(!dutyDate){
    status(
      'specialExemptMessage',
      '請選擇勤務日期。',
      'warn'
    );
    return;
  }

  if(
    scope==='PERSONAL' &&
    !targetPersonIds.length
  ){
    status(
      'specialExemptMessage',
      '請至少勾選一位支援人員。',
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

  if(
    reason==='其他' &&
    !note
  ){
    status(
      'specialExemptMessage',
      '選擇「其他」時請填寫說明。',
      'warn'
    );
    return;
  }

  if(
    specialExemptCustomTime &&
    (
      !startTime ||
      !endTime
    )
  ){
    status(
      'specialExemptMessage',
      '請完整設定開始與結束時間。',
      'warn'
    );
    return;
  }

  const timeText=
    specialExemptCustomTime
      ? `${startTime}–${endTime}`
      : '整班';

  let scopeText='';

  if(scope==='PERSONAL'){
    const names=
      targetPersonIds.map(
        id=>{
          const el=
            document.querySelector(
              `.special-person-check[value="${id}"]`
            );

          return el
            ?.closest(
              '.special-person-option'
            )
            ?.querySelector('strong')
            ?.textContent||
            id;
        }
      );

    scopeText=
      `指定人員支援：${names.join('、')}`;
  }else{
    scopeText=
      '整班巡查不強制';
  }

  const warning=
    scope==='SHIFT'
      ? '\n\n注意：整班設定會讓共同巡查進度顯示「不用打卡」。'
      : '\n\n此設定不會改變整班共同巡查進度。';

  if(
    !confirm(
      `確定新增設定？\n\n`+
      `勤務日期：${dutyDate}\n`+
      `時段：${timeText}\n`+
      `${scopeText}\n`+
      `事由：${reason}`+
      warning
    )
  ){
    return;
  }

  const btn=
    $('setSpecialExemptBtn');

  btn.disabled=true;
  btn.textContent='設定中…';

  try{
    const r=
      await apiCall(
        'specialExemptSet',
        {
          personId:
            currentPerson.personId,
          password:
            currentPassword,
          sessionToken:
            currentSessionToken,
          dutyDate:
            dutyDate,
          scope:
            scope,
          targetPersonIds:
            targetPersonIds,
          reason:
            reason,
          note:
            note,
          startTime:
            startTime,
          endTime:
            endTime
        }
      );

    status(
      'specialExemptMessage',
      r.message,
      'ok'
    );

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
    updateSpecialExemptScopeUi();
  }
}

async function cancelSpecialExempt(
  exemptionId
){
  if(!currentPerson){
    return;
  }

  const dutyDate=
    $('specialExemptDate').value;

  if(!exemptionId){
    status(
      'specialExemptMessage',
      '找不到要取消的設定。',
      'warn'
    );
    return;
  }

  if(
    !confirm(
      '確定取消這一筆特殊勤務設定？'
    )
  ){
    return;
  }

  try{
    const r=
      await apiCall(
        'specialExemptCancel',
        {
          personId:
            currentPerson.personId,
          password:
            currentPassword,
          sessionToken:
            currentSessionToken,
          dutyDate:
            dutyDate,
          exemptionId:
            exemptionId
        }
      );

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
  }
}

function openPatrol(){
  closeScanSuccessPopup();
  showView('patrolView');
  setBackfillTimeLimit();
  $('manualQr').value='';
  $('pointCard').classList.add('hidden');
  $('patrolSuccessBadge').classList.add('hidden');
  $('continueScanBtn').classList.add('hidden');
  $('cameraControls').classList.add('hidden');
  status('patrolMessage','');
  scannerPausedAfterSuccess=false;

  // 相機啟動同時先取得 GPS，掃到 QR 時通常可直接使用。
  startGpsWarmup();
  startScanner();
}


function normalizeQr(raw){
  let text=String(raw||'').trim();

  if(/^https?:\/\//i.test(text)){
    try{
      const u=new URL(text);
      text=(
        u.searchParams.get('qr') ||
        u.searchParams.get('code') ||
        text
      );
    }catch(e){}
  }

  text=String(text||'')
    .trim()
    .toUpperCase()
    .replace(/\s+/g,'');

  // 相容舊版巡查牌／人工輸入格式：KSP-P01 → P01
  text=text.replace(/^KSP[-_]?/,'');

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


function toLocalDateTimeValue(date){
  const pad=n=>String(n).padStart(2,'0');
  return (
    date.getFullYear()+'-'+
    pad(date.getMonth()+1)+'-'+
    pad(date.getDate())+'T'+
    pad(date.getHours())+':'+
    pad(date.getMinutes())
  );
}


function setBackfillTimeLimit(){
  const input=$('backfillDateTime');
  if(!input)return;

  const now=new Date();
  input.max=toLocalDateTimeValue(now);

  // 預設留白，避免誤把系統預設時間當成實際巡查時間。
  if(input.value){
    const picked=new Date(input.value);
    if(isNaN(picked.getTime()) || picked.getTime()>=now.getTime()){
      input.value='';
    }
  }
}


async function submitBackfillPatrol(){
  if(!currentPerson){
    return;
  }

  const qr=normalizeQr(
    $('backfillQr').value
  );

  const backfillDateTime=
    $('backfillDateTime').value;

  if(!qr){
    status(
      'backfillPatrolMessage',
      '請先選擇巡查點。',
      'warn'
    );
    return;
  }

  if(!backfillDateTime){
    status(
      'backfillPatrolMessage',
      '請選擇巡查時間。',
      'warn'
    );
    return;
  }

  const selected=
    new Date(
      backfillDateTime
    );

  if(
    isNaN(
      selected.getTime()
    ) ||
    selected.getTime() >=
      Date.now()
  ){
    status(
      'backfillPatrolMessage',
      '巡查時間必須早於目前時間。',
      'warn'
    );
    return;
  }

  const btn=
    $('submitBackfillPatrolBtn');

  if(
    !confirm(
      `確定登錄 ${qr}？\n\n`+
      `巡查時間：${backfillDateTime.replace('T',' ')}\n`+
      '送出時會重新偵測手機目前 GPS；必須實際位於該巡查點範圍內。'
    )
  ){
    return;
  }

  btn.disabled=true;
  btn.textContent='正在偵測 GPS…';

  try{
    status(
      'backfillPatrolMessage',
      `${qr}｜正在取得目前 GPS 位置…`,
      'info'
    );

    const gps=
      await getGps();

    status(
      'backfillPatrolMessage',
      `${qr}｜GPS 已取得，正在送出巡查紀錄…`,
      'info'
    );

    const r=
      await apiCall(
        'patrolBackfill',
        {
          personId:
            currentPerson.personId,
          qr:
            qr,
          backfillDateTime:
            backfillDateTime,
          lat:
            gps.lat,
          lng:
            gps.lng
        }
      );

    status(
      'backfillPatrolMessage',
      `${r.message} 現場GPS距離：約 ${r.distance} 公尺；送出時間：${r.submittedAt}`,
      'ok'
    );

    showSuccess(
      '巡查登錄完成',
      `${r.checkpoint?.name||qr}\n`+
      `巡查時間：${r.backfillTime}\n`+
      `送出時間：${r.submittedAt}\n`+
      `GPS距離：約 ${r.distance} 公尺`
    );

    $('backfillQr').value='';
    $('backfillDateTime').value='';

    await refreshDutyDashboard();

  }catch(e){
    status(
      'backfillPatrolMessage',
      e.message,
      'err'
    );

  }finally{
    btn.disabled=false;
    btn.textContent='📍 偵測該點 GPS 並登錄';
    setBackfillTimeLimit();
  }
}



function defaultSubstituteDutyDate_(){
  if(currentDuty?.dutyDate){
    return dutyDateToInput(
      currentDuty.dutyDate
    );
  }

  const d=new Date();

  // 晚班跨日：凌晨 0～6 點預設以前一日作為勤務日期。
  if(d.getHours()<6){
    d.setDate(
      d.getDate()-1
    );
  }

  const y=d.getFullYear();
  const m=String(
    d.getMonth()+1
  ).padStart(2,'0');
  const day=String(
    d.getDate()
  ).padStart(2,'0');

  return `${y}-${m}-${day}`;
}


function openSubstitute(){
  if(!currentPerson){
    return;
  }

  showView(
    'substituteView'
  );

  if(
    !$('substituteDate').value
  ){
    $('substituteDate').value=
      defaultSubstituteDutyDate_();
  }

  status(
    'substituteMessage',
    ''
  );

  loadSubstituteOptions();
}


async function loadSubstituteOptions(){
  if(!currentPerson){
    return;
  }

  const dutyDate=
    $('substituteDate').value;

  const original=
    $('substituteOriginal');

  const substitute=
    $('substitutePerson');

  const list=
    $('substituteCurrentList');

  if(!dutyDate){
    original.innerHTML=
      '<option value="">請先選擇勤務日期</option>';

    substitute.innerHTML=
      '<option value="">請先選擇勤務日期</option>';

    list.innerHTML=
      '<div class="empty">請先選擇勤務日期。</div>';

    return;
  }

  original.innerHTML=
    '<option value="">讀取班表中…</option>';

  substitute.innerHTML=
    '<option value="">讀取人員中…</option>';

  list.innerHTML=
    '<div class="empty">讀取中…</div>';

  try{
    const r=
      await apiCall(
        'substituteOptions',
        {
          personId:
            currentPerson.personId,
          password:
            currentPassword,
          sessionToken:
            currentSessionToken,
          dutyDate:
            dutyDate
        }
      );

    const roster=
      Array.isArray(r.roster)
        ? r.roster
        : [];

    const staff=
      Array.isArray(r.staff)
        ? r.staff
        : [];

    original.innerHTML=
      '<option value="">請選擇原排班人員</option>'+
      roster.map(
        x=>{
          const replacement=
            x.replacement
              ? ` → 目前由 ${x.replacement.substituteName} 代班`
              : '';

          return (
            `<option value="${esc(x.personId)}|${esc(x.shift)}">`+
            `${esc(x.shift)}｜${esc(x.name)} (${esc(x.personId)})`+
            `${esc(replacement)}`+
            '</option>'
          );
        }
      ).join('');

    substitute.innerHTML=
      '<option value="">請選擇代班人員</option>'+
      staff.map(
        x=>
          `<option value="${esc(x.personId)}">`+
          `${esc(x.name)} (${esc(x.personId)})`+
          `${x.defaultShift?`｜${esc(x.defaultShift)}`:''}`+
          '</option>'
      ).join('');

    renderSubstituteList(
      r.activeSubstitutions||[]
    );

  }catch(e){
    original.innerHTML=
      '<option value="">讀取失敗</option>';

    substitute.innerHTML=
      '<option value="">讀取失敗</option>';

    list.innerHTML=
      `<div class="empty">${esc(e.message)}</div>`;

    status(
      'substituteMessage',
      e.message,
      'err'
    );
  }
}


function renderSubstituteList(
  items
){
  const box=
    $('substituteCurrentList');

  if(
    !Array.isArray(items) ||
    !items.length
  ){
    box.innerHTML=
      '<div class="empty">此勤務日目前沒有代班設定。</div>';

    return;
  }

  box.innerHTML=
    items.map(
      x=>`
        <div class="record-item substitute-record">
          <div class="record-top">
            <div>
              <strong>${esc(x.shift||'')}</strong>
              <div class="eyebrow">${esc(x.dutyDate||'')}</div>
            </div>
            <button
              class="text-btn substitute-cancel-btn"
              type="button"
              data-id="${esc(x.substitutionId||'')}"
            >取消代班</button>
          </div>

          <div class="substitute-arrow-row">
            <span>${esc(x.originalName||x.originalPersonId||'—')}</span>
            <b>→</b>
            <strong>${esc(x.substituteName||x.substitutePersonId||'—')}</strong>
          </div>

          <div class="record-meta">
            <span class="chip">${esc(x.reason||'代班')}</span>
            ${x.note?`<span class="chip">${esc(x.note)}</span>`:''}
          </div>

          <small>
            設定：${esc(x.createdByName||'—')}｜${esc(x.createdAt||'—')}
          </small>
        </div>
      `
    ).join('');

  box
    .querySelectorAll(
      '.substitute-cancel-btn'
    )
    .forEach(
      btn=>{
        btn.addEventListener(
          'click',
          ()=>{
            cancelSubstitute(
              btn.dataset.id
            );
          }
        );
      }
    );
}


async function setSubstitute(){
  if(!currentPerson){
    return;
  }

  const dutyDate=
    $('substituteDate').value;

  const originalValue=
    $('substituteOriginal').value;

  const substitutePersonId=
    $('substitutePerson').value;

  const reason=
    $('substituteReason').value;

  const note=
    $('substituteNote').value.trim();

  if(
    !dutyDate ||
    !originalValue ||
    !substitutePersonId
  ){
    status(
      'substituteMessage',
      '請完整選擇勤務日期、原排班人員及代班人員。',
      'warn'
    );
    return;
  }

  const [
    originalPersonId,
    shift
  ]=
    originalValue.split('|');

  if(
    originalPersonId ===
    substitutePersonId
  ){
    status(
      'substituteMessage',
      '原排班人員與代班人員不可為同一人。',
      'warn'
    );
    return;
  }

  const originalText=
    $('substituteOriginal')
      .selectedOptions[0]
      ?.textContent||originalPersonId;

  const substituteText=
    $('substitutePerson')
      .selectedOptions[0]
      ?.textContent||substitutePersonId;

  const ok=
    confirm(
      `確定套用代班？\n\n`+
      `${originalText}\n→ ${substituteText}\n\n`+
      '套用後立即生效，不需審核。'
    );

  if(!ok){
    return;
  }

  const btn=
    $('setSubstituteBtn');

  btn.disabled=true;
  btn.textContent='設定中…';

  try{
    const r=
      await apiCall(
        'substituteSet',
        {
          personId:
            currentPerson.personId,
          password:
            currentPassword,
          sessionToken:
            currentSessionToken,
          dutyDate:
            dutyDate,
          shift:
            shift,
          originalPersonId:
            originalPersonId,
          substitutePersonId:
            substitutePersonId,
          reason:
            reason,
          note:
            note
        }
      );

    status(
      'substituteMessage',
      r.message,
      'ok'
    );

    showSuccess(
      '代班設定完成',
      r.message
    );

    $('substituteNote').value='';

    await loadSubstituteOptions();
    await refreshDutyDashboard();

  }catch(e){
    status(
      'substituteMessage',
      e.message,
      'err'
    );

  }finally{
    btn.disabled=false;
    btn.textContent='套用代班設定';
  }
}


async function cancelSubstitute(
  substitutionId
){
  if(
    !currentPerson ||
    !substitutionId
  ){
    return;
  }

  if(
    !confirm(
      '確定取消此代班設定並恢復原班表？'
    )
  ){
    return;
  }

  try{
    const r=
      await apiCall(
        'substituteCancel',
        {
          personId:
            currentPerson.personId,
          password:
            currentPassword,
          sessionToken:
            currentSessionToken,
          substitutionId:
            substitutionId
        }
      );

    status(
      'substituteMessage',
      r.message,
      'ok'
    );

    await loadSubstituteOptions();
    await refreshDutyDashboard();

  }catch(e){
    status(
      'substituteMessage',
      e.message,
      'err'
    );
  }
}



function openMonthlyReport(){
  showView('monthlyReportView');

  const input=$('reportMonth');

  if(!input.value){
    const now=new Date();
    const y=String(now.getFullYear());
    const m=String(now.getMonth()+1).padStart(2,'0');

    input.value=`${y}-${m}`;
  }

  status('monthlyReportMessage','');
}


function reportMonthParts(){
  const value=String($('reportMonth').value||'').trim();
  const m=value.match(/^(\d{4})-(\d{2})$/);

  if(!m){
    throw new Error('請選擇報表月份。');
  }

  return {
    year:Number(m[1]),
    month:Number(m[2])
  };
}


function reportDateKey(year,month,day){
  return `${year}/${String(month).padStart(2,'0')}/${String(day).padStart(2,'0')}`;
}


function reportDaysInMonth(year,month){
  return new Date(year,month,0).getDate();
}


function reportParseDateTime(dateText,timeText){
  const dm=String(dateText||'').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  const tm=String(timeText||'').match(/^(\d{2}):(\d{2})/);
  if(!dm || !tm)return null;

  return new Date(
    Number(dm[1]),
    Number(dm[2])-1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,0
  );
}


function reportWeekdayText(dateText){
  const d=reportParseDateTime(dateText,'00:00');
  if(!d)return '';
  return ['日','一','二','三','四','五','六'][d.getDay()];
}


function reportIsHoliday(dateText,holidaySet){
  const d=reportParseDateTime(dateText,'00:00');
  if(!d)return false;
  return d.getDay()===0 || d.getDay()===6 || holidaySet.has(dateText);
}


function reportFixedExempt(dateText,shift,hour,holidaySet){
  const holiday=reportIsHoliday(dateText,holidaySet);

  if(shift==='白班'){
    if(holiday){
      return hour===12 ? '午休' : '';
    }

    if(hour===8)return '交管';
    if(hour===11 || hour===12)return '導護';
    if(hour===17)return '交管';
    return '';
  }

  if(!holiday && hour===18)return '交管';
  return '';
}


function reportAliasMap(records){
  const names={};
  records.forEach(r=>{
    const id=String(r.personId||'').trim();
    const name=String(r.name||'').trim();
    if(id && name)names[id]=name;
  });

  const ids=Object.keys(names).sort();
  const tailCount={};

  ids.forEach(id=>{
    const name=names[id];
    const tail=name.slice(-1) || id;
    tailCount[tail]=(tailCount[tail]||0)+1;
  });

  const aliases={};
  ids.forEach(id=>{
    const name=names[id];
    const tail=name.slice(-1) || id;
    aliases[id]=tailCount[tail]===1 ? tail : (name.slice(-2)||id);
  });

  return {names,ids,aliases};
}


function reportSpecialReason(data,dateText,shift,hour){
  const items=(data.specialExempt||[]).filter(x=>
    x.date===dateText && (!x.shift || x.shift===shift)
  );

  if(!items.length)return '';

  const dutyStart=shift==='白班' ? 6 : 18;
  const slotStart=new Date(2000,0,1,hour,0,0,0);
  if(shift==='晚班' && hour<6)slotStart.setDate(2);
  const slotEnd=new Date(slotStart.getTime()+60*60*1000);

  for(const x of items){
    if(!x.startTime && !x.endTime){
      return x.reason || '特殊勤務';
    }

    if(!x.startTime || !x.endTime)continue;

    const sp=x.startTime.split(':').map(Number);
    const ep=x.endTime.split(':').map(Number);
    let s=new Date(2000,0,1,sp[0],sp[1]||0,0,0);
    let e=new Date(2000,0,1,ep[0],ep[1]||0,0,0);

    if(shift==='晚班'){
      if(sp[0]<6)s.setDate(2);
      if(ep[0]<6)e.setDate(2);
      if(e<=s)e.setDate(e.getDate()+1);
    }

    if(slotStart<e && slotEnd>s){
      return x.reason || '特殊勤務';
    }
  }

  return '';
}


function reportPatrolGroups(data){
  const out={};

  (data.records||[]).forEach(r=>{
    if(r.action!=='定點巡查' && r.action!=='定點巡查指定時間登錄')return;

    const dt=reportParseDateTime(r.date,r.time);
    if(!dt)return;

    let shift='';
    let dutyDate='';
    const h=dt.getHours();

    if(h>=6 && h<18){
      shift='白班';
      dutyDate=r.date;
    }else if(h>=18){
      shift='晚班';
      dutyDate=r.date;
    }else{
      shift='晚班';
      const prev=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()-1);
      dutyDate=`${prev.getFullYear()}/${String(prev.getMonth()+1).padStart(2,'0')}/${String(prev.getDate()).padStart(2,'0')}`;
    }

    const key=`${shift}|${dutyDate}|${h}|${r.checkpointId}`;
    if(!out[key])out[key]=[];
    out[key].push(r);
  });

  Object.values(out).forEach(list=>{
    list.sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  });

  return out;
}


function reportStyles(){
  return {
    title:{
      font:{bold:true,color:{rgb:'FFFFFF'},sz:14},
      fill:{fgColor:{rgb:'173A52'}},
      alignment:{horizontal:'center',vertical:'center'}
    },
    note:{
      font:{color:{rgb:'657A87'},sz:9},
      fill:{fgColor:{rgb:'F5F8FA'}},
      alignment:{vertical:'center',wrapText:true}
    },
    header:{
      font:{bold:true,color:{rgb:'173A52'},sz:9},
      fill:{fgColor:{rgb:'DCE8EF'}},
      alignment:{horizontal:'center',vertical:'center',wrapText:true},
      border:{top:{style:'thin',color:{rgb:'B8C7D1'}},bottom:{style:'thin',color:{rgb:'B8C7D1'}},left:{style:'thin',color:{rgb:'B8C7D1'}},right:{style:'thin',color:{rgb:'B8C7D1'}}}
    },
    body:{
      font:{color:{rgb:'263E4D'},sz:8},
      alignment:{horizontal:'center',vertical:'center',wrapText:true},
      border:{top:{style:'thin',color:{rgb:'B8C7D1'}},bottom:{style:'thin',color:{rgb:'B8C7D1'}},left:{style:'thin',color:{rgb:'B8C7D1'}},right:{style:'thin',color:{rgb:'B8C7D1'}}}
    },
    done:{font:{color:{rgb:'245C38'},sz:7},fill:{fgColor:{rgb:'E2F2E7'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'B8C7D1'}},bottom:{style:'thin',color:{rgb:'B8C7D1'}},left:{style:'thin',color:{rgb:'B8C7D1'}},right:{style:'thin',color:{rgb:'B8C7D1'}}}},
    missed:{font:{color:{rgb:'9A3131'},sz:7},fill:{fgColor:{rgb:'FCE7E7'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'B8C7D1'}},bottom:{style:'thin',color:{rgb:'B8C7D1'}},left:{style:'thin',color:{rgb:'B8C7D1'}},right:{style:'thin',color:{rgb:'B8C7D1'}}}},
    exempt:{font:{color:{rgb:'5C6971'},sz:7},fill:{fgColor:{rgb:'ECEFF1'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'B8C7D1'}},bottom:{style:'thin',color:{rgb:'B8C7D1'}},left:{style:'thin',color:{rgb:'B8C7D1'}},right:{style:'thin',color:{rgb:'B8C7D1'}}}},
    special:{font:{bold:true,color:{rgb:'8A5B00'},sz:7},fill:{fgColor:{rgb:'FFF3C4'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'E2B94F'}},bottom:{style:'thin',color:{rgb:'E2B94F'}},left:{style:'thin',color:{rgb:'E2B94F'}},right:{style:'thin',color:{rgb:'E2B94F'}}}},
    current:{font:{bold:true,color:{rgb:'315B72'},sz:7},fill:{fgColor:{rgb:'E7F0F6'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'AFC4D2'}},bottom:{style:'thin',color:{rgb:'AFC4D2'}},left:{style:'thin',color:{rgb:'AFC4D2'}},right:{style:'thin',color:{rgb:'AFC4D2'}}}},
    future:{font:{color:{rgb:'9AA7AF'},sz:7},fill:{fgColor:{rgb:'F8FAFB'}},alignment:{vertical:'top',wrapText:true},border:{top:{style:'thin',color:{rgb:'D6DFE5'}},bottom:{style:'thin',color:{rgb:'D6DFE5'}},left:{style:'thin',color:{rgb:'D6DFE5'}},right:{style:'thin',color:{rgb:'D6DFE5'}}}}
  };
}


function reportApplyRangeStyle(ws,rangeText,style){
  const range=XLSX.utils.decode_range(rangeText);
  for(let r=range.s.r;r<=range.e.r;r++){
    for(let c=range.s.c;c<=range.e.c;c++){
      const ref=XLSX.utils.encode_cell({r,c});
      if(ws[ref])ws[ref].s=style;
    }
  }
}


function buildClockReportSheet(data){
  const {year,month}=data;
  const aliases=reportAliasMap(data.records||[]);
  const clockRecords=(data.records||[]).filter(r=>r.action==='上班簽到' || r.action==='下班簽退');
  const people={};

  clockRecords.forEach(r=>{
    if(r.personId)people[r.personId]=r.name||r.personId;
  });

  const ids=Object.keys(people).sort();
  const days=reportDaysInMonth(year,month);
  const holidays=new Set((data.holidays||[]).map(x=>x.date));
  const map={};

  clockRecords.forEach(r=>{
    const key=`${r.date}|${r.personId}`;
    if(!map[key])map[key]={in:[],out:[]};
    if(r.action==='上班簽到')map[key].in.push(r.time);
    if(r.action==='下班簽退')map[key].out.push(r.time);
  });

  const aoa=[];
  aoa.push([`高雄軟體園區保全勤務－上下班簽到月報（民國${year-1911}年${month}月）`]);
  aoa.push([`資料產生：${data.generatedAt||''}｜同一人同日所有上班／下班時間均保留。`]);
  aoa.push(['日期','星期',...ids.map(id=>`${id}\n${people[id]}`)]);

  for(let day=1;day<=days;day++){
    const dateText=reportDateKey(year,month,day);
    const row=[`${month}/${day}`,reportWeekdayText(dateText)];

    ids.forEach(id=>{
      const item=map[`${dateText}|${id}`]||{in:[],out:[]};
      const lines=[];
      if(item.in.length)lines.push(`上 ${item.in.sort().join('/')}`);
      if(item.out.length)lines.push(`下 ${item.out.sort().join('/')}`);
      row.push(lines.join('\n'));
    });

    aoa.push(row);
  }

  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const lastCol=1+ids.length;
  const end=XLSX.utils.encode_col(lastCol);
  ws['!merges']=[
    {s:{r:0,c:0},e:{r:0,c:lastCol}},
    {s:{r:1,c:0},e:{r:1,c:lastCol}}
  ];
  ws['!cols']=[{wch:9},{wch:6},...ids.map(()=>({wch:18}))];
  ws['!rows']=[{hpt:24},{hpt:18},{hpt:28},...Array(days).fill({hpt:25})];

  const S=reportStyles();
  reportApplyRangeStyle(ws,`A1:${end}1`,S.title);
  reportApplyRangeStyle(ws,`A2:${end}2`,S.note);
  reportApplyRangeStyle(ws,`A3:${end}3`,S.header);
  reportApplyRangeStyle(ws,`A4:${end}${3+days}`,S.body);

  for(let day=1;day<=days;day++){
    const dateText=reportDateKey(year,month,day);
    if(reportIsHoliday(dateText,holidays)){
      for(let c=0;c<=lastCol;c++){
        const ref=XLSX.utils.encode_cell({r:2+day,c});
        if(ws[ref]){
          ws[ref].s={...S.body,fill:{fgColor:{rgb:'EEF3F6'}}};
        }
      }
    }
  }

  return ws;
}


function buildPatrolReportSheet(data,shift){
  const {year,month}=data;
  const hours=shift==='白班'
    ? [6,7,8,9,10,11,12,13,14,15,16,17]
    : [18,19,20,21,22,23,0,1,2,3,4,5];
  const hourLabels=hours.map(h=>`${String(h).padStart(2,'0')}–${String((h+1)%24).padStart(2,'0')}`);
  const days=reportDaysInMonth(year,month);
  const holidaySet=new Set((data.holidays||[]).map(x=>x.date));
  const groups=reportPatrolGroups(data);
  const aliasInfo=reportAliasMap(data.records||[]);
  const pointIds=['P01','P02','P03','P04','P05'];
  const generatedParts=String(data.generatedAt||'').split(' ');
  const reportNow=reportParseDateTime(generatedParts[0]||'',generatedParts[1]||'') || new Date();

  const aoa=[];
  aoa.push([`高雄軟體園區保全勤務－${shift}巡查點月報（${shift==='白班'?'06:00–18:00':'18:00–次日06:00'}）`]);
  aoa.push([`每格：完成狀態＋P01～P05實際巡查時間／執行人員。＃＝人工輸入巡查。資料產生：${data.generatedAt||''}`]);
  aoa.push(['勤務日',...hourLabels]);

  const cellStatus=[];

  for(let day=1;day<=days;day++){
    const dutyDate=reportDateKey(year,month,day);
    let dateLabel=`${month}/${day}（${reportWeekdayText(dutyDate)}）`;
    if(holidaySet.has(dutyDate))dateLabel+='\n特殊假日';
    else if(reportIsHoliday(dutyDate,holidaySet))dateLabel+='\n假日';

    const row=[dateLabel];
    const statusRow=['date'];

    hours.forEach(hour=>{
      const fixed=reportFixedExempt(dutyDate,shift,hour,holidaySet);
      const special=!fixed ? reportSpecialReason(data,dutyDate,shift,hour) : '';
      const pointLines=[];
      let completed=0;

      pointIds.forEach(point=>{
        const key=`${shift}|${dutyDate}|${hour}|${point}`;
        const recs=groups[key]||[];
        if(!recs.length)return;
        completed++;

        const items=recs.map(r=>{
          let mark='';
          // 月報表不標示「指定時間登錄」；與一般巡查統一呈現。
          if(String(r.result||'').includes('人工輸入'))mark='#';
          const alias=aliasInfo.aliases[r.personId]||r.personId||'';
          return `${r.time}${alias}${mark}`;
        });

        pointLines.push(`${point.slice(-2)} ${items.join('/')}`);
      });

      const lines=[];
      let st='';

      const dutyBase=reportParseDateTime(dutyDate,'00:00');
      let slotStart=null;
      if(dutyBase){
        slotStart=new Date(dutyBase.getTime());
        if(shift==='晚班' && hour<6){
          slotStart.setDate(slotStart.getDate()+1);
        }
        slotStart.setHours(hour,0,0,0);
      }
      const slotEnd=slotStart ? new Date(slotStart.getTime()+60*60*1000) : null;

      if(slotStart && slotStart>reportNow){
        st='future';
        lines.push('—');
      }else if(fixed){
        st='exempt';
        lines.push(completed ? `免巡｜實巡${completed}/5` : '免巡');
        lines.push(fixed);
      }else if(special){
        st='special';
        lines.push(`不用打卡｜${special}`);
        if(completed)lines.push(`實巡 ${completed}/5`);
      }else if(slotStart && slotEnd && reportNow>=slotStart && reportNow<slotEnd){
        st='current';
        lines.push(`進行中 ${completed}/5`);
      }else if(completed===5){
        st='done';
        lines.push('✓ 5/5');
      }else{
        st='missed';
        lines.push(`△ ${completed}/5`);
        const missing=pointIds.filter(p=>!(groups[`${shift}|${dutyDate}|${hour}|${p}`]||[]).length).map(p=>p.slice(-2));
        lines.push(`缺 ${missing.join('、')}`);
      }

      lines.push(...pointLines);
      row.push(lines.join('\n'));
      statusRow.push(st);
    });

    aoa.push(row);
    cellStatus.push(statusRow);
  }

  // 人員代碼圖例
  const legend=aliasInfo.ids.map(id=>`${aliasInfo.aliases[id]}=${aliasInfo.names[id]}(${id})`).join('｜');
  aoa.push([]);
  aoa.push([`人員代碼：${legend}`]);
  aoa.push(['狀態：綠＝5/5完成｜紅＝未達5點｜灰＝固定免巡｜金黃＝特殊勤務不用打卡']);

  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const lastCol=hours.length;
  const end=XLSX.utils.encode_col(lastCol);
  ws['!merges']=[
    {s:{r:0,c:0},e:{r:0,c:lastCol}},
    {s:{r:1,c:0},e:{r:1,c:lastCol}},
    {s:{r:4+days,c:0},e:{r:4+days,c:lastCol}},
    {s:{r:5+days,c:0},e:{r:5+days,c:lastCol}}
  ];
  ws['!cols']=[{wch:12},...hours.map(()=>({wch:14}))];

  // 每日列高依當天最長的巡查格自動計算。
  // 避免 P05 位於第 5 行時被固定列高裁切，使用者不需再手動拉高儲存格。
  const patrolRowHeights=[];

  for(let day=1;day<=days;day++){
    const row=aoa[2+day]||[];
    let maxLines=1;

    row.slice(1).forEach(value=>{
      const text=String(value||'');
      const lines=text ? text.split('\n').length : 1;
      if(lines>maxLines)maxLines=lines;
    });

    // 6.5pt 字體下，每行約 9pt，再加上下留白。
    // 最低 30pt，完整 5 點巡查通常約 58～67pt。
    const height=Math.max(
      30,
      Math.min(
        84,
        8 + maxLines*9
      )
    );

    patrolRowHeights.push({
      hpt:height
    });
  }

  ws['!rows']=[
    {hpt:24},
    {hpt:20},
    {hpt:24},
    ...patrolRowHeights,
    {hpt:8},
    {hpt:22},
    {hpt:22}
  ];

  const S=reportStyles();
  reportApplyRangeStyle(ws,`A1:${end}1`,S.title);
  reportApplyRangeStyle(ws,`A2:${end}2`,S.note);
  reportApplyRangeStyle(ws,`A3:${end}3`,S.header);

  for(let day=1;day<=days;day++){
    const rowIndex=2+day;
    const dateRef=XLSX.utils.encode_cell({r:rowIndex,c:0});
    if(ws[dateRef])ws[dateRef].s=S.header;

    for(let c=1;c<=lastCol;c++){
      const ref=XLSX.utils.encode_cell({r:rowIndex,c});
      if(!ws[ref])continue;
      const st=cellStatus[day-1][c];
      ws[ref].s=S[st]||S.body;
    }
  }

  const legend1=4+days;
  const legend2=5+days;
  reportApplyRangeStyle(ws,`A${legend1+1}:${end}${legend1+1}`,S.note);
  reportApplyRangeStyle(ws,`A${legend2+1}:${end}${legend2+1}`,S.special);

  return ws;
}


function reportFilename(data,type){
  const roc=data.year-1911;
  const ym=`${roc}年${data.month}月`;
  if(type==='clock')return `高雄軟體園區保全勤務_${ym}_上下班簽到月報.xlsx`;
  if(type==='patrol')return `高雄軟體園區保全勤務_${ym}_巡查點簽到月報.xlsx`;
  return `高雄軟體園區保全勤務_${ym}_完整月報.xlsx`;
}


async function generateMonthlyReport(type){
  if(typeof XLSX==='undefined'){
    status('monthlyReportMessage','Excel 產生元件載入失敗，請確認網路後重新開啟系統。','err');
    return;
  }

  let parts;
  try{
    parts=reportMonthParts();
  }catch(e){
    status('monthlyReportMessage',e.message,'warn');
    return;
  }

  const buttons=[
    $('generateClockReportBtn'),
    $('generatePatrolReportBtn'),
    $('generateFullReportBtn')
  ];
  buttons.forEach(b=>b.disabled=true);

  status('monthlyReportMessage','正在讀取月報表資料並產生 Excel…','info');

  try{
    const data=await apiCall('monthlyReportData',{
      year:parts.year,
      month:parts.month
    });

    const wb=XLSX.utils.book_new();

    if(type==='clock' || type==='full'){
      XLSX.utils.book_append_sheet(
        wb,
        buildClockReportSheet(data),
        '上下班簽到月報'
      );
    }

    if(type==='patrol' || type==='full'){
      XLSX.utils.book_append_sheet(
        wb,
        buildPatrolReportSheet(data,'白班'),
        '白班巡查點月報'
      );

      XLSX.utils.book_append_sheet(
        wb,
        buildPatrolReportSheet(data,'晚班'),
        '晚班巡查點月報'
      );
    }

    XLSX.writeFile(
      wb,
      reportFilename(data,type),
      {compression:true}
    );

    status(
      'monthlyReportMessage',
      `已生成 ${data.year}年${data.month}月月報表，共讀取 ${data.records?.length||0} 筆系統紀錄。`,
      'ok'
    );

  }catch(e){
    status('monthlyReportMessage',e.message,'err');
  }finally{
    buttons.forEach(b=>b.disabled=false);
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
