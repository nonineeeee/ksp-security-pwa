
const $=id=>document.getElementById(id);

let sourceCanvas=null;
let displayCanvas=null;
let rotation=0;
let gridState=[];
let confidenceState=[];
let pdfFileName='';

const GRID={
  x0:332/2572,
  x1:2138/2572,
  y0:837/1819,
  y1:1217/1819,
  rows:6,
  cols:31
};

document.addEventListener('DOMContentLoaded',()=>{
  const now=new Date();

  $('year').value=now.getFullYear();
  $('month').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}月</option>`).join('');
  $('month').value=now.getMonth()+1;

  if(window.pdfjsLib){
    pdfjsLib.GlobalWorkerOptions.workerSrc=
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  $('loadPdfBtn').addEventListener('click',loadPdf);
  $('rotateLeftBtn').addEventListener('click',()=>rotateBy(-90));
  $('rotateRightBtn').addEventListener('click',()=>rotateBy(90));
  $('recognizeBtn').addEventListener('click',recognize);
  $('recognizeAgainBtn').addEventListener('click',recognize);
  $('downloadCsvBtn').addEventListener('click',downloadCsv);
  $('importPdfBtn').addEventListener('click',importRecognized);

  checkApi();
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
      reject(new Error('尚未設定 config.js 的 API 網址。'));
      return;
    }

    const requestId='pdf_'+Date.now()+'_'+Math.random().toString(36).slice(2);
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
  const badge=$('apiStatus');

  try{
    const r=await apiCall('ping',{});

    if(r.service!=='KSP Security Fresh API'){
      throw new Error(`API服務不符：${r.service||'未知'}`);
    }

    badge.className='badge ok';
    badge.textContent='已連線';
    $('apiDetail').textContent=`${r.version||''}｜${r.rosterSource||''}`;

  }catch(e){
    badge.className='badge err';
    badge.textContent='未連線';
    $('apiDetail').textContent=e.message;
  }
}

async function loadPdf(){
  const file=$('pdfFile').files?.[0];

  if(!file){
    status('loadMessage','請先選擇 PDF 班表。','warn');
    return;
  }

  if(!window.pdfjsLib){
    status('loadMessage','PDF 解析元件尚未載入，請確認網路連線。','err');
    return;
  }

  const btn=$('loadPdfBtn');
  btn.disabled=true;
  btn.textContent='載入中…';
  status('loadMessage','正在讀取 PDF 第1頁…','info');

  try{
    pdfFileName=file.name;

    const bytes=new Uint8Array(await file.arrayBuffer());
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    const page=await pdf.getPage(1);

    const viewport=page.getViewport({scale:2.0});
    const c=document.createElement('canvas');
    c.width=Math.round(viewport.width);
    c.height=Math.round(viewport.height);

    await page.render({
      canvasContext:c.getContext('2d',{willReadFrequently:true}),
      viewport
    }).promise;

    sourceCanvas=c;

    // 此類班表通常 PDF 頁面是直式、內容橫放；自動左轉90度。
    rotation=c.height>c.width?270:0;

    renderDisplay();

    $('previewSection').classList.remove('hidden');
    $('staffSection').classList.remove('hidden');
    $('gridSection').classList.add('hidden');

    status(
      'loadMessage',
      `PDF 已載入：${file.name}。請先確認預覽方向，再進行辨識。`,
      'ok'
    );

  }catch(e){
    status('loadMessage','PDF載入失敗：'+e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='載入 PDF';
  }
}

function rotateBy(delta){
  if(!sourceCanvas)return;
  rotation=(rotation+delta+360)%360;
  renderDisplay();
  $('gridSection').classList.add('hidden');
  status('recognizeMessage','方向已變更，請重新辨識。','info');
}

function renderDisplay(){
  if(!sourceCanvas)return;

  const src=sourceCanvas;
  const out=$('pdfCanvas');
  const ctx=out.getContext('2d',{willReadFrequently:true});

  if(rotation===90 || rotation===270){
    out.width=src.height;
    out.height=src.width;
  }else{
    out.width=src.width;
    out.height=src.height;
  }

  ctx.save();
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,out.width,out.height);

  if(rotation===0){
    ctx.drawImage(src,0,0);

  }else if(rotation===90){
    ctx.translate(out.width,0);
    ctx.rotate(Math.PI/2);
    ctx.drawImage(src,0,0);

  }else if(rotation===180){
    ctx.translate(out.width,out.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(src,0,0);

  }else if(rotation===270){
    ctx.translate(0,out.height);
    ctx.rotate(-Math.PI/2);
    ctx.drawImage(src,0,0);
  }

  ctx.restore();

  displayCanvas=out;
}

function recognize(){
  if(!displayCanvas){
    status('recognizeMessage','請先載入 PDF。','warn');
    return;
  }

  if(displayCanvas.width<=displayCanvas.height){
    status(
      'recognizeMessage',
      '目前頁面仍是直式。請先旋轉至橫式，並確認公司名稱及月份標題正常閱讀。',
      'warn'
    );
    return;
  }

  try{
    const days=daysInSelectedMonth();
    const densities=[];

    for(let r=0;r<GRID.rows;r++){
      for(let d=0;d<days;d++){
        densities.push(cellDensity(r,d));
      }
    }

    const km=kmeans3(densities);
    const centers=km.centers.slice().sort((a,b)=>a-b);

    // 同版型正常情況應有：空白、A、B 三群。
    if(centers.length<3 || centers[1]-centers[0]<0.008 || centers[2]-centers[1]<0.008){
      throw new Error('無法穩定分離休／A／B。請確認 PDF 方向及版型是否與目前班表相同。');
    }

    gridState=[];
    confidenceState=[];

    let idx=0;

    for(let r=0;r<GRID.rows;r++){
      const row=[];
      const confRow=[];

      for(let d=0;d<days;d++){
        const value=densities[idx++];
        const distances=centers.map(c=>Math.abs(value-c));
        const order=[0,1,2].sort((a,b)=>distances[a]-distances[b]);

        const label=['休','A','B'][order[0]];
        const confidence=
          1-
          distances[order[0]]/
          Math.max(
            distances[order[1]],
            0.000001
          );

        row.push(label);
        confRow.push(confidence);
      }

      gridState.push(row);
      confidenceState.push(confRow);
    }

    renderGrid();
    renderSummary();

    $('gridSection').classList.remove('hidden');

    status(
      'recognizeMessage',
      `辨識完成。三群墨色中心：${centers.map(x=>x.toFixed(3)).join('／')}。請務必對照 PDF 核對後再匯入。`,
      'ok'
    );

    $('gridSection').scrollIntoView({behavior:'smooth',block:'start'});

  }catch(e){
    status('recognizeMessage',e.message,'err');
  }
}

function cellDensity(row,dayZero){
  const c=displayCanvas;
  const ctx=c.getContext('2d',{willReadFrequently:true});

  const xA=(GRID.x0+(GRID.x1-GRID.x0)*dayZero/GRID.cols)*c.width;
  const xB=(GRID.x0+(GRID.x1-GRID.x0)*(dayZero+1)/GRID.cols)*c.width;
  const yA=(GRID.y0+(GRID.y1-GRID.y0)*row/GRID.rows)*c.height;
  const yB=(GRID.y0+(GRID.y1-GRID.y0)*(row+1)/GRID.rows)*c.height;

  const mx=(xB-xA)*0.18;
  const my=(yB-yA)*0.20;

  const x=Math.max(0,Math.floor(xA+mx));
  const y=Math.max(0,Math.floor(yA+my));
  const w=Math.max(2,Math.floor((xB-xA)-2*mx));
  const h=Math.max(2,Math.floor((yB-yA)-2*my));

  const data=ctx.getImageData(x,y,w,h).data;

  let dark=0;
  let total=0;

  for(let i=0;i<data.length;i+=4){
    const gray=
      0.299*data[i]+
      0.587*data[i+1]+
      0.114*data[i+2];

    if(gray<170)dark++;
    total++;
  }

  return total?dark/total:0;
}

function kmeans3(values){
  const v=values.slice().sort((a,b)=>a-b);

  const q=p=>{
    const idx=Math.min(v.length-1,Math.max(0,Math.floor((v.length-1)*p)));
    return v[idx];
  };

  let centers=[q(.10),q(.58),q(.90)];

  for(let iter=0;iter<30;iter++){
    const buckets=[[],[],[]];

    values.forEach(x=>{
      const ds=centers.map(c=>Math.abs(x-c));
      const k=ds.indexOf(Math.min(...ds));
      buckets[k].push(x);
    });

    const next=centers.map((c,k)=>
      buckets[k].length
        ? buckets[k].reduce((a,b)=>a+b,0)/buckets[k].length
        : c
    );

    const delta=Math.max(...next.map((x,i)=>Math.abs(x-centers[i])));
    centers=next;

    if(delta<0.000001)break;
  }

  return {centers};
}

function renderGrid(){
  const days=daysInSelectedMonth();
  const table=$('resultTable');

  const head=`
    <thead>
      <tr>
        <th class="sticky-person">人員</th>
        ${Array.from({length:days},(_,i)=>`<th>${i+1}</th>`).join('')}
      </tr>
    </thead>`;

  const body=gridState.map((row,r)=>{
    const pid=$(`pid${r}`).value.trim().toUpperCase();
    const name=$(`pname${r}`).value.trim();

    return `
      <tr>
        <th class="sticky-person">
          <div>${esc(pid)}</div>
          <small>${esc(name)}</small>
        </th>
        ${row.map((value,d)=>{
          const low=(confidenceState[r]?.[d]??1)<0.35;
          return `
            <td>
              <button
                type="button"
                class="shift-cell shift-${value==='休'?'off':value.toLowerCase()} ${low?'low-confidence':''}"
                data-row="${r}"
                data-day="${d}"
                title="${low?'低信心，請核對PDF':'點擊切換'}"
              >${value}</button>
            </td>`;
        }).join('')}
      </tr>`;
  }).join('');

  table.innerHTML=head+`<tbody>${body}</tbody>`;

  table.querySelectorAll('.shift-cell').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const r=Number(btn.dataset.row);
      const d=Number(btn.dataset.day);
      const cycle={休:'A',A:'B',B:'休'};
      gridState[r][d]=cycle[gridState[r][d]]||'休';
      confidenceState[r][d]=1;
      renderGrid();
      renderSummary();
    });
  });
}

function renderSummary(){
  const rows=buildImportRows();
  const days=daysInSelectedMonth();

  const dayCounts=Array(days).fill(0);

  rows.forEach(x=>{
    const day=Number(x.date.split('/')[2]);
    if(day>=1 && day<=days)dayCounts[day-1]++;
  });

  const low=[];
  const high=[];

  dayCounts.forEach((n,i)=>{
    if(n<3)low.push(`${i+1}日(${n}人)`);
    if(n>5)high.push(`${i+1}日(${n}人)`);
  });

  const whites=rows.filter(x=>x.shift==='白班').length;
  const nights=rows.filter(x=>x.shift==='晚班').length;
  const lowConfidence=confidenceState.flat().filter(x=>x<0.35).length;

  let msg=
    `勤務 ${rows.length} 筆｜白班 ${whites}｜晚班 ${nights}｜低信心格 ${lowConfidence}`;

  if(low.length){
    msg+=`\n少於3人：${low.join('、')}`;
  }

  if(high.length){
    msg+=`\n超過5人：${high.join('、')}`;
  }

  status(
    'summaryBox',
    msg,
    high.length?'err':(low.length||lowConfidence?'warn':'ok')
  );
}

function buildImportRows(){
  const year=Number($('year').value);
  const month=Number($('month').value);

  const rows=[];

  gridState.forEach((days,r)=>{
    const personId=$(`pid${r}`).value.trim().toUpperCase();
    const name=$(`pname${r}`).value.trim();

    days.forEach((cell,d)=>{
      if(cell!=='A' && cell!=='B')return;

      rows.push({
        date:
          `${year}/${String(month).padStart(2,'0')}/${String(d+1).padStart(2,'0')}`,
        personId,
        name,
        shift:
          cell==='A'
            ? '白班'
            : '晚班'
      });
    });
  });

  return rows;
}

function downloadCsv(){
  if(!gridState.length){
    status('importMessage','尚未有辨識結果。','warn');
    return;
  }

  const rows=buildImportRows();

  const lines=[
    ['日期','人員編號','姓名','班別'],
    ...rows.map(x=>[x.date,x.personId,x.name,x.shift])
  ];

  const csv='\uFEFF'+lines.map(row=>
    row.map(v=>{
      const s=String(v??'').replaceAll('"','""');
      return /[",\n]/.test(s)?`"${s}"`:s;
    }).join(',')
  ).join('\r\n');

  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=
    `KSP_${$('year').value}_${String($('month').value).padStart(2,'0')}_PDF轉換班表.csv`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function importRecognized(){
  if(!gridState.length){
    status('importMessage','請先辨識並核對班表。','warn');
    return;
  }

  const year=Number($('year').value);
  const month=Number($('month').value);
  const rows=buildImportRows();

  if(!rows.length){
    status('importMessage','沒有可匯入的 A／B 班次。','warn');
    return;
  }

  const lowConfidence=confidenceState.flat().filter(x=>x<0.35).length;

  const question=
    `確定匯入 ${year}年${month}月，共 ${rows.length} 筆勤務？`+
    (lowConfidence?`\n仍有 ${lowConfidence} 格為低信心辨識，請確認已核對。`:'');

  if(!confirm(question))return;

  const btn=$('importPdfBtn');
  btn.disabled=true;
  btn.textContent='匯入中…';

  try{
    const r=await apiCall('importRoster',{
      year,
      month,
      replaceMonth:$('replaceMonth').checked,
      source:pdfFileName||'PDF班表轉換',
      rows
    });

    status(
      'importMessage',
      r.warning?`${r.message}\n${r.warning}`:r.message,
      r.warning?'warn':'ok'
    );

  }catch(e){
    status('importMessage',e.message,'err');

  }finally{
    btn.disabled=false;
    btn.textContent='確認後直接匯入';
  }
}

function daysInSelectedMonth(){
  return new Date(
    Number($('year').value),
    Number($('month').value),
    0
  ).getDate();
}
