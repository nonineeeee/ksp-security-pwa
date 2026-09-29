
let parsedRows=[];

const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  const now=new Date();

  $('year').value=now.getFullYear();
  $('month').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}月</option>`).join('');
  $('month').value=now.getMonth()+1;

  $('previewBtn').addEventListener('click',previewFile);
  $('importBtn').addEventListener('click',doImport);
  $('statusBtn').addEventListener('click',loadStatus);
  $('year').addEventListener('change',loadStatus);
  $('month').addEventListener('change',loadStatus);

  checkApi();
  loadStatus();
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

function apiCall(action,payload={}){
  return new Promise((resolve,reject)=>{
    if(typeof API_URL==='undefined' || !API_URL || API_URL.includes('PASTE_')){
      reject(new Error('尚未設定 config.js 的 fresh-v1 API 網址。'));
      return;
    }

    const requestId='roster_'+Date.now()+'_'+Math.random().toString(36).slice(2);
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
        reject(new Error(d.response?.message||'API 執行失敗'));
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

    if(!String(r.version||'').startsWith('fresh-v1')){
      throw new Error(`API版本不符：${r.version||'未知'}`);
    }

    b.className='badge ok';
    b.textContent='已連線';
    $('apiDetail').textContent=`${r.version}｜${r.rosterSource||''}`;

  }catch(e){
    b.className='badge err';
    b.textContent='未連線';
    $('apiDetail').textContent=e.message;
  }
}

async function loadStatus(){
  try{
    const r=await apiCall('importRosterStatus',{
      year:Number($('year').value),
      month:Number($('month').value)
    });

    $('statusBox').innerHTML=`<div class="status info">${esc(r.message)}</div>`;

  }catch(e){
    $('statusBox').innerHTML=`<div class="status err">${esc(e.message)}</div>`;
  }
}

async function previewFile(){
  parsedRows=[];
  $('importBtn').classList.add('hidden');
  $('preview').innerHTML='';

  const file=$('file').files[0];

  if(!file){
    status('message','請先選擇 Excel 或 CSV 班表。','warn');
    return;
  }

  const year=Number($('year').value);
  const month=Number($('month').value);

  status('message','正在解析班表…','info');

  try{
    const source=await readFile(file);
    parsedRows=parseRoster(source.rows,year,month);

    if(!parsedRows.length){
      throw new Error('沒有辨識到有效班次。');
    }

    const whites=parsedRows.filter(x=>x.shift==='白班').length;
    const nights=parsedRows.filter(x=>x.shift==='晚班').length;
    const people=new Set(parsedRows.map(x=>x.personId||x.name).filter(Boolean));

    $('preview').innerHTML=`
      <div class="status info">
        <strong>解析完成</strong><br>
        格式：${esc(source.format)}<br>
        勤務：${parsedRows.length} 筆<br>
        人員：${people.size} 人<br>
        白班：${whites} 筆<br>
        晚班：${nights} 筆
      </div>`;

    $('importBtn').classList.remove('hidden');
    status('message','確認年月與筆數後即可匯入。','ok');

  }catch(e){
    status('message',e.message,'err');
  }
}

async function readFile(file){
  const ext=file.name.split('.').pop().toLowerCase();

  if(ext==='csv'){
    return {
      format:'CSV',
      rows:parseCsv(await file.text())
    };
  }

  if(!window.XLSX){
    throw new Error('Excel解析元件未載入，請改用 CSV。');
  }

  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  const ws=wb.Sheets[wb.SheetNames[0]];

  return {
    format:'Excel',
    rows:XLSX.utils.sheet_to_json(ws,{
      header:1,
      defval:'',
      raw:true
    })
  };
}

function parseCsv(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());

  return lines.map(line=>{
    const out=[];
    let cur='',quoted=false;

    for(let i=0;i<line.length;i++){
      const c=line[i];

      if(c==='"'){
        if(quoted && line[i+1]==='"'){
          cur+='"';
          i++;
        }else{
          quoted=!quoted;
        }
      }else if(c===',' && !quoted){
        out.push(cur);
        cur='';
      }else{
        cur+=c;
      }
    }

    out.push(cur);
    return out;
  });
}

function findHeader(rows){
  const max=Math.min(rows.length,15);

  for(let i=0;i<max;i++){
    const h=(rows[i]||[]).map(v=>String(v??'').trim());

    if(h.includes('日期') && h.includes('班別') && (h.includes('人員編號') || h.includes('姓名'))){
      return {index:i,type:'detail'};
    }

    if(
      (h.includes('人員編號') || h.includes('姓名')) &&
      h.some(v=>/^(?:[1-9]|[12]\d|3[01])$/.test(v))
    ){
      return {index:i,type:'matrix'};
    }
  }

  return null;
}

function parseRoster(rows,year,month){
  const clean=(rows||[]).filter(r=>Array.isArray(r) && r.some(v=>String(v??'').trim()!==''));
  const found=findHeader(clean);

  if(!found){
    throw new Error('無法辨識班表格式。請確認含有「日期／班別／姓名或人員編號」，或「姓名／人員編號＋1～31日」。');
  }

  const data=clean.slice(found.index);

  return found.type==='detail'
    ? parseDetail(data)
    : parseMatrix(data,year,month);
}

function parseDetail(rows){
  const h=rows[0].map(v=>String(v??'').trim());

  const di=h.indexOf('日期');
  const pi=h.indexOf('人員編號');
  const ni=h.indexOf('姓名');
  const si=h.indexOf('班別');

  return rows.slice(1).map(r=>{
    const date=normalizeDate(r[di]);
    const personId=pi>=0?String(r[pi]??'').trim().toUpperCase():'';
    const name=ni>=0?String(r[ni]??'').trim():'';
    const shift=normalizeShift(r[si]);

    return date && (personId||name) && shift
      ? {date,personId,name,shift}
      : null;
  }).filter(Boolean);
}

function parseMatrix(rows,year,month){
  const h=rows[0].map(v=>String(v??'').trim());
  const pi=h.indexOf('人員編號');
  const ni=h.indexOf('姓名');

  const result=[];

  rows.slice(1).forEach(r=>{
    const personId=pi>=0?String(r[pi]??'').trim().toUpperCase():'';
    const name=ni>=0?String(r[ni]??'').trim():'';

    if(!personId && !name)return;

    h.forEach((head,idx)=>{
      if(!/^(?:[1-9]|[12]\d|3[01])$/.test(head))return;

      const shift=normalizeShift(r[idx]);
      if(!shift)return;

      result.push({
        date:`${year}/${String(month).padStart(2,'0')}/${String(Number(head)).padStart(2,'0')}`,
        personId,
        name,
        shift
      });
    });
  });

  return result;
}

function normalizeShift(v){
  const s=String(v??'').trim().toUpperCase();

  if(['A','白','白班','DAY'].includes(s))return '白班';
  if(['B','晚','晚班','NIGHT'].includes(s))return '晚班';

  return '';
}

function normalizeDate(v){
  if(v instanceof Date && !isNaN(v)){
    return `${v.getFullYear()}/${String(v.getMonth()+1).padStart(2,'0')}/${String(v.getDate()).padStart(2,'0')}`;
  }

  const s=String(v??'').trim().replaceAll('-','/');
  const m=s.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/);

  if(!m)return '';

  let y=Number(m[1]);
  if(y<1911)y+=1911;

  return `${y}/${String(Number(m[2])).padStart(2,'0')}/${String(Number(m[3])).padStart(2,'0')}`;
}

async function doImport(){
  if(!parsedRows.length){
    status('message','請先解析班表。','warn');
    return;
  }

  const year=Number($('year').value);
  const month=Number($('month').value);

  if(!confirm(`確定匯入 ${year}年${month}月，共 ${parsedRows.length} 筆勤務？`)){
    return;
  }

  const btn=$('importBtn');
  btn.disabled=true;
  btn.textContent='匯入中…';

  try{
    const r=await apiCall('importRoster',{
      year,
      month,
      replaceMonth:$('replaceMonth').checked,
      source:$('file').files[0]?.name||'PWA匯入',
      rows:parsedRows
    });

    status(
      'message',
      r.warning?`${r.message}\n${r.warning}`:r.message,
      r.warning?'warn':'ok'
    );

    await loadStatus();

  }catch(e){
    status('message',e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='確認匯入';
  }
}
