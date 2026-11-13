export function mountMap(element,props,auth,submit,accountError) {
  const root = element.querySelector('.tracker');
  const container = root.querySelector('.tracker-map');
  const day = root.querySelector('.target-day');
  const comparison = root.querySelector('.comparison-options');
  const comparisonYears = root.querySelector('.comparison-years');
  const comparisonMode = {value:'years'};
  const comparisonModes = [...root.querySelectorAll('.comparison-mode')];
  const comparisonDay = root.querySelector('.comparison-day');
  const run = root.querySelector('.run-selection');
  const hint = root.querySelector('.selection-hint');
  const legend = root.querySelector('.tracker-legend');
  const resultDetails = legend.querySelector('.result-details');
  // Browser download attributes only work for same-origin or blob URLs.
  resultDetails.addEventListener('click',async event=>{
    const link=event.target.closest('a[download][href]');
    if (!link) return;
    event.preventDefault();
    try {
      const response=await fetch(link.href);
      if (!response.ok) throw new Error();
      const file=await response.blob();
      const download=document.createElement('a');
      download.href=URL.createObjectURL(file);
      download.download=link.download||decodeURIComponent(new URL(link.href).pathname.split('/').at(-1));
      download.click();
      setTimeout(()=>URL.revokeObjectURL(download.href),60_000);
    } catch {
      announce('The download is unavailable. Run the comparison again to regenerate it.',true);
    }
  });
  const opacity = root.querySelector('.overlay-opacity');
  const appearance = matchMedia('(prefers-color-scheme: dark)');
  const coverage = props.coverage;
  const empty = {type:'FeatureCollection',features:[]};
  let longitude = null, latitude = null, selectedArea = null, activeArea = null;
  let areaMetres=props.area_metres;
  let selected = false, busy = false, current = null, activeRunId = null;
  let mode = 'buildings', lastImagery = null, lastBuildings = null;
  let resultPopup = null, resultBody = null;
  let overviewUrl = null, overviewRequest = null;
  function loadThemePreference() {
    try {
      const saved=localStorage.getItem('settlement-tracker-theme');
      return saved==='light'||saved==='dark'?saved:null;
    } catch {return null;}
  }
  let preferredTheme=loadThemePreference();
  let theme = preferredTheme || (appearance.matches ? 'dark' : 'light');
  root.dataset.theme=theme;
  let basemapTheme=theme, basemapReady=false;
  let appMode='archive', archiveId='change-2019-2026';
  let modelArchiveId=archiveId;
  const obtToggle=root.querySelector('.obt-toggle');
  const obtOptions=root.querySelector('.obt-options');
  const backgroundChoice=root.querySelector('.background-choice');
  const waybackRelease=root.querySelector('.wayback-release');
  const backgroundStatus=root.querySelector('.background-status');
  let waybackItems=[],waybackLoading=null,activeWaybackUrl=null;
  const floodingToggle=root.querySelector('.flooding-toggle');
  const floodingYear=root.querySelector('.flooding-year');
  const floodingStatus=root.querySelector('.flooding-status');
  const floodingLegend=root.querySelector('.flooding-legend');
  const floodingYears=Object.keys(props.flooding_maps||{}).sort();
  floodingYear.replaceChildren(...floodingYears.map(year=>new Option(year,year)));
  floodingYear.value=floodingYears.at(-1)||'';
  let activeFloodingYear=null;
  root.dataset.theme = theme;
  function todayString() {
    return calendarDate(new Date());
  }
  day.max = todayString(); day.value = day.max;
  function calendarDate(value) {
    return String(value.getFullYear()).padStart(4,'0')+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');
  }
  function comparisonDate(targetDay, years) {
    const target=new Date(targetDay+'T12:00:00');
    const previous=new Date(target);
    // setFullYear preserves years 1–99; the numeric Date constructor maps them to 1901–1999.
    previous.setFullYear(target.getFullYear()-years, target.getMonth()+1, 0);
    previous.setDate(Math.min(target.getDate(),previous.getDate()));
    return calendarDate(previous);
  }
  function updateComparison() {
    const custom=comparisonMode.value==='custom';
    comparisonModes.forEach(input=>{input.checked=input.value===comparisonMode.value;input.disabled=busy;});
    comparisonYears.disabled=busy||custom;comparisonDay.disabled=busy||!custom;
    const years=Number(comparisonYears.value);
    comparisonYears.max=Number(day.value.slice(0,4))-1;
    if(!comparisonDay.value&&day.validity.valid)comparisonDay.value=comparisonDate(day.value,comparisonYears.validity.valid?years:1);
    if (day.validity.valid) {
      const latest=new Date(day.value+'T12:00:00');latest.setDate(latest.getDate()-1);
      comparisonDay.max=calendarDate(latest);
    }
    const control=custom?comparisonDay:comparisonYears;
    const valid=control.validity.valid&&day.validity.valid;
    const previous=custom?comparisonDay.value:valid?comparisonDate(day.value,years):'';
    comparison.querySelector('.comparison-interval').textContent=control.validity.valid?(custom?captureText([previous]):years+' '+(years===1?'year':'years')+' earlier'):'…';
    comparison.querySelector('.comparison-dates').textContent=valid?captureText([day.value])+' compared with '+captureText([previous])+'.':'';
  }
  updateComparison();
  function announce(text = '', error = false) {
    hint.textContent = text; hint.hidden = !text; hint.classList.toggle('error', error);
  }
  function insideRing(point, ring) {
    let inside = false;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const [x,y]=ring[i], [xj,yj]=ring[j];
      if ((y>point[1])!==(yj>point[1]) && point[0]<(xj-x)*(point[1]-y)/(yj-y)+x) inside=!inside;
    }
    return inside;
  }
  function insideCoverage(point) {
    const geometry=coverage.coverage;
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return polygons.some(rings=>insideRing(point,rings[0])&&!rings.slice(1).some(r=>insideRing(point,r)));
  }
  function makeSelection(point) {
    const preferred=Math.floor((point[0]+180)/6)+1;
    const tile=[...coverage.tiles].sort((a,b)=>(a.zone!==preferred)-(b.zone!==preferred)).find(tile=>{
      const [x,y]=proj4('EPSG:4326','+proj=utm +zone='+tile.zone+' +datum=WGS84 +units=m +no_defs',point);
      return tile.bounds[0]<=x&&x<=tile.bounds[2]&&tile.bounds[1]<=y&&y<=tile.bounds[3];
    });
    if (!tile) return null;
    const utm='+proj=utm +zone='+tile.zone+' +datum=WGS84 +units=m +no_defs';
    const [x,y]=proj4('EPSG:4326',utm,point), metres=areaMetres;
    const left=Math.round((x-metres/2)/10)*10, bottom=Math.round((y-metres/2)/10)*10;
    const ring=[[left,bottom+metres],[left+metres,bottom+metres],[left+metres,bottom],[left,bottom],[left,bottom+metres]].map(p=>proj4(utm,'EPSG:4326',p));
    return {ring, centre:proj4(utm,'EPSG:4326',[left+metres/2,bottom+metres/2])};
  }
  function areaFromRing(ring) {
    const centre=[(ring[0][0]+ring[2][0])/2,(ring[0][1]+ring[2][1])/2];
    return {ring,centre};
  }
  function feature(area) {
    return area ? {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[area.ring]}}]} : empty;
  }
  if (!window.settlementPMTilesProtocol) {
    window.settlementPMTilesProtocol=new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles',window.settlementPMTilesProtocol.tile);
  }
  const map = new maplibregl.Map({
    container, style:props.map_styles[theme], bounds:coverage.bounds,
    fitBoundsOptions:{padding:30}, renderWorldCopies:false, minZoom:1, maxPitch:0,
    dragRotate:false, touchPitch:false, attributionControl:false,
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
  root.querySelector('.tracker-scale').append(container.querySelector('.maplibregl-ctrl-scale'));
  // Inline standard plus/minus icons avoid sprite backgrounds and host button styles.
  for (const [name,path] of [['in','M12 5v14M5 12h14'],['out','M5 12h14']]) {
    const icon=container.querySelector('.maplibregl-ctrl-zoom-'+name+' .maplibregl-ctrl-icon');
    icon.innerHTML='<svg class="map-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';
  }
  map.touchZoomRotate.disableRotation();
  const selectionLabel=document.createElement('div'); selectionLabel.className='selected-label'; selectionLabel.innerHTML='<div class="selection-options"><span>Selected</span><details class="area-picker"><summary aria-label="Map size"><span class="area-size-label">Normal · 2 × 2 km</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="area-size-menu" role="group" aria-label="Map size options"><button type="button" data-size="2000" aria-pressed="true">Normal · 2 × 2 km</button><button type="button" data-size="4000" aria-pressed="false">Large · 4 × 4 km <small>Slow</small></button><button type="button" data-size="10000" aria-pressed="false">XL · 10 × 10 km <small>Experimental</small></button></div></details></div><div class="area-warning" role="status" aria-live="polite" hidden></div>';
  const sizePicker=selectionLabel.querySelector('.area-picker'),areaWarning=selectionLabel.querySelector('.area-warning');
  for (const event of ['click','dblclick','pointerdown','mousedown','touchstart','keydown','wheel']) selectionLabel.addEventListener(event,event=>event.stopPropagation());
  // HTML buttons avoid native select popups inside the transformed map marker in Firefox.
  sizePicker.querySelectorAll('[data-size]').forEach(button=>button.addEventListener('click',()=>{
    if (busy||longitude===null) return;
    areaMetres=Number(button.dataset.size);selectedArea=makeSelection([longitude,latitude]);selected=true;
    sizePicker.querySelector('.area-size-label').textContent=button.childNodes[0].textContent.trim();
    sizePicker.querySelectorAll('[data-size]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
    sizePicker.open=false;sizePicker.querySelector('summary').focus({preventScroll:true});
    areaWarning.hidden=areaMetres===2000;areaWarning.textContent=areaMetres===10000?'Experimental: very slow; may exceed runtime or quota limits.':'Large areas will be slow.';
    updateSelection();fitArea(selectedArea,true);
  }));
  sizePicker.addEventListener('keydown',event=>{
    const summary=sizePicker.querySelector('summary'), options=[...sizePicker.querySelectorAll('button')];
    if(event.key==='Escape'){event.preventDefault();sizePicker.open=false;summary.focus({preventScroll:true});}
    if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      if(event.target===summary) sizePicker.open=!sizePicker.open;
      else event.target.closest('button')?.click();
    }
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();sizePicker.open=true;
      const index=options.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(index+1)%options.length:(index<0?options.length-1:(index+options.length-1)%options.length);
      options[next].focus({preventScroll:true});
    }
  });
  const selectionMarker=new maplibregl.Marker({element:selectionLabel,anchor:'bottom-left',offset:[0,-8]});
  const progressNode=document.createElement('div'); progressNode.className='inference-status';
  progressNode.setAttribute('role','status'); progressNode.setAttribute('aria-live','polite');
  progressNode.innerHTML='<span class="inference-spinner" aria-hidden="true"></span><span class="inference-message"></span>';
  const progressMarker=new maplibregl.Marker({element:progressNode,anchor:'center'});
  function setBusy(value) {
    busy=value; sizePicker.querySelectorAll('button').forEach(button=>button.disabled=busy); run.disabled=busy||longitude===null; day.disabled=busy;
    comparisonModes.forEach(input=>input.disabled=busy);comparisonYears.disabled=busy||comparisonMode.value==='custom';comparisonDay.disabled=busy||comparisonMode.value!=='custom';
    root.querySelectorAll('[data-app-mode]').forEach(button=>button.disabled=busy);
    root.querySelectorAll('[data-place]').forEach(link=>link.setAttribute('aria-disabled',String(busy)));
    root.querySelector('.account-action').setAttribute('aria-disabled',String(busy));
  }
  function updateSelection() {
    map.getSource('selection')?.setData(feature(selected&&selectedArea?selectedArea:null));
    if (appMode==='live'&&selected&&selectedArea&&!busy) {
      // Avoid placing two headers on top of one another when only the date changes.
      const same=current?.area_ring&&JSON.stringify(current.area_ring)===JSON.stringify(selectedArea.ring);
      selectionMarker.setLngLat(selectedArea.ring[0]).setOffset([0,-8]).addTo(map);
      if (same) selectionMarker.setOffset([8,selectionLabel.offsetHeight+8]);
    } else selectionMarker.remove();
  }
  function setProgress(message) {
    if (!activeArea) return;
    progressNode.querySelector('.inference-message').textContent=message;
    progressMarker.setLngLat(activeArea.centre).addTo(map);
  }
  function clearImage(id) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  function raiseMapLabels() {
    if(!map.getLayer('selection-line'))return;
    // Keep labels above analysis rasters and below the AOI outlines. Only move
    // symbol layers, so changing order never recreates sources or image tiles.
    for(const layer of props.map_styles[theme].layers) {
      if(layer.type==='symbol'&&map.getLayer(layer.id))map.moveLayer(layer.id,'selection-line');
    }
  }
  function imageLayer(id,url,coordinates) {
    if (!url || !map.getSource('selection')) return;
    const source=map.getSource(id);
    if (source) source.updateImage({url,coordinates});
    else {
      map.addSource(id,{type:'image',url,coordinates});
      map.addLayer({id,type:'raster',source:id,paint:{'raster-fade-duration':0,'raster-resampling':'nearest'}},'selection-line');
      raiseMapLabels();
    }
    // Keep local Sentinel imagery beneath the optional flood context.
    if(id==='sentinel-image'&&map.getLayer('flooding'))map.moveLayer(id,'flooding');
  }
  function updateChangeOverview() {
    if (appMode!=='live') { overviewRequest=null; return; }
    if (!current?.change_levels?.length||!map.getSource('selection')) return;
    const levels=current.change_levels;
    const level=levels.find(level=>map.getZoom()>=level.minzoom)||levels[levels.length-1];
    const url=new URL(level.url,props.space).href;
    const download=resultDetails.querySelector('.change-download');
    if (download) {
      download.href=url;download.download='settlement-change-'+current.date_label.replaceAll(' ','-')+'-'+level.factor+'m.png';
    }
    if (mode!=='settlement') { overviewRequest=null; return; }
    if (url===overviewUrl) { overviewRequest=null; return; }
    if (url===overviewRequest) return;
    overviewRequest=url;
    // Preload only the selected level; stale result/zoom requests cannot win.
    const image=new Image();
    image.onload=()=>{
      if (appMode!=='live'||mode!=='settlement'||overviewRequest!==url||current?.change_levels!==levels) return;
      overviewUrl=url;overviewRequest=null;
      imageLayer('settlement',url,current.coordinates);setDisplay();
    };
    image.onerror=()=>{
      if (appMode!=='live'||mode!=='settlement'||overviewRequest!==url||current?.change_levels!==levels) return;
      overviewRequest=null;announce('The change overview could not load. Adjust the zoom to retry.',true);
    };
    image.src=url;
  }
  function setDisplay() {
    const live=appMode==='live';
    if (!live) overviewRequest=null;
    for (const id of ['coverage-mask','selection-line','completed-line']) {
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',live?'visible':'none');
    }
    for(const period of Object.keys(props.preprocessed_maps||{})) {
      for(const id of ['preprocessed-map-'+period,'preprocessed-overview-'+period])if(map.getLayer(id)) {
        map.setLayoutProperty(id,'visibility',!live&&period===archiveId?'visible':'none');
        map.setPaintProperty(id,'raster-opacity',Number(opacity.value)/100);
      }
    }
    if (map.getLayer('sentinel-image')) map.setLayoutProperty('sentinel-image','visibility',live&&mode==='buildings'?'visible':'none');
    for (const key of ['buildings','settlement']) {
      if (map.getLayer(key)) {
        map.setLayoutProperty(key,'visibility',live&&key===mode?'visible':'none');
        map.setPaintProperty(key,'raster-opacity',Number(opacity.value)/100);
      }
    }
    resultBody?.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    resizeResultHeader();
    if(resultPopup) {resultPopup.getElement().hidden=!live;if(!live)resultPopup.getElement().inert=true;}
    resultDetails.hidden=!live;
    if(!live) {
      legend.hidden=false;
      legend.querySelector('.legend-items').innerHTML='<span class="legend-item"><span class="legend-swatch contraction"></span>Loss</span><span class="legend-item"><span class="legend-swatch growth"></span>Gain</span><span class="legend-item"><span class="legend-swatch context"></span>Buildings</span>';
      return;
    }
    legend.hidden=current?.state!=='ready';
    if (!legend.hidden) legend.querySelector('.legend-items').innerHTML=mode==='settlement'
      ? '<span class="legend-item"><span class="legend-swatch contraction"></span>Contraction</span><span class="legend-item"><span class="legend-swatch growth"></span>Growth</span><span class="legend-item"><span class="legend-swatch context"></span>Buildings</span>'
      : '<span class="legend-item"><span class="legend-swatch"></span>Predicted buildings</span>';
    updateChangeOverview();
  }
  function renderImages(value,force=false) {
    if (value?.coordinates) {
      if (value.imagery&&(force||lastImagery!==value.imagery)) { imageLayer('sentinel-image',value.imagery,value.coordinates); lastImagery=value.imagery; }
      if (value.buildings&&(force||lastBuildings!==value.buildings)) { imageLayer('buildings',value.buildings,value.coordinates); lastBuildings=value.buildings; }
    }
    if (force) { overviewUrl=null; overviewRequest=null; }
    // Reconcile visibility even before a live result exists (initial archive).
    setDisplay();
  }
  function resizeResultHeader() {
    if (!resultPopup||!resultBody||!current?.area_ring) return;
    const width=Math.abs(map.project(current.area_ring[1]).x-map.project(current.area_ring[0]).x);
    const fits=resultBody.getBoundingClientRect().width<=width+2;
    const popup=resultPopup.getElement();
    // Keep the tabs measurable while hidden so zooming back in can restore them.
    popup.style.visibility=fits?'visible':'hidden';
    popup.inert=!fits;popup.setAttribute('aria-hidden',String(!fits));
  }
  function captureText(captures) {
    return (captures||[]).map(day=>new Date(day+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})).join(', ');
  }
  function buildResultHeader(value) {
    if (resultBody&&resultBody.dataset.runId===value.run_id) return;
    resultPopup?.remove();
    resultBody=document.createElement('div'); resultBody.className='result-header';
    resultBody.dataset.runId=value.run_id||'';
    resultBody.innerHTML='<div class="result-modes" role="group" aria-label="Result view"><button type="button" data-mode="buildings" aria-pressed="true"></button><button type="button" data-mode="settlement" aria-pressed="false"></button></div>';
    resultBody.querySelector('[data-mode="buildings"]').textContent=value.date_label;
    const years=value.comparison_years===undefined?1:value.comparison_years;
    resultBody.querySelector('[data-mode="settlement"]').textContent=years===null?'Change':years===1?'One year change':years+' year change';
    resultBody.querySelector('[data-mode="settlement"]').title=value.date_label+' compared with '+value.previous_date_label;
    resultDetails.open=false;
    resultDetails.querySelector('.current-captures').textContent='Using imagery from '+captureText(value.captures)+'.';
    resultDetails.querySelector('.previous-captures').textContent='Comparison ('+value.previous_date_label+(years===null?'':', '+years+' '+(years===1?'year':'years')+' earlier')+'): '+captureText(value.previous_captures)+'.';
    const alignment=value.alignment;
    resultDetails.querySelector('.alignment-details').textContent=alignment?'Previous prediction aligned by '+alignment.dx+' m east and '+(-alignment.dy)+' m north (±10 m search).':'';
    const download=resultDetails.querySelector('.result-download');
    download.hidden=!value.download_url;
    if (value.download_url) download.href=new URL(value.download_url,props.space).href;
    const imageryDownload=resultDetails.querySelector('.imagery-download');
    imageryDownload.hidden=!value.imagery_download_url;
    if (value.imagery_download_url) imageryDownload.href=new URL(value.imagery_download_url,props.space).href;
    const archive=resultDetails.querySelector('.render-archive-download');
    archive.hidden=!value.render_archive_url;
    if (value.render_archive_url) archive.href=new URL(value.render_archive_url,props.space).href;
    resultBody.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;setDisplay();}));
    for (const event of ['click','dblclick','pointerdown','mousedown','touchstart','wheel']) resultBody.addEventListener(event,event=>event.stopPropagation());
    resultPopup=new maplibregl.Popup({closeButton:false,closeOnClick:false,focusAfterOpen:false,anchor:'bottom-left',offset:[-1,1],maxWidth:'none'})
      .setLngLat(value.area_ring[0]).setDOMContent(resultBody).addTo(map);
    setDisplay();
  }
  function removeResult() {
    current=null; lastImagery=null; lastBuildings=null; overviewUrl=null; overviewRequest=null;
    resultPopup?.remove(); resultPopup=null; resultBody=null; legend.hidden=true;
    for (const id of ['settlement','buildings','sentinel-image']) clearImage(id);
    map.getSource('completed')?.setData(empty);
  }
  function installArchiveLayer() {
    const spec=props.preprocessed_maps?.[archiveId];
    // Layer presence marks style readiness. isStyleLoaded() also waits for tile
    // requests, so using it here can silently drop a period switch mid-load.
    if(!spec||!map.getLayer('selection-line'))return;
    const tiles='preprocessed-map-'+archiveId, overview='preprocessed-overview-'+archiveId;
    // Install each period on its first visit. Keep its source and loaded tiles
    // when switching away; setDisplay selects the visible period.
    if(map.getSource(tiles))return;
    if(spec.preview_url) {
      // The published archive starts at z6. Its unchanged lowest-zoom pixels
      // provide a lightweight overview when the whole country fits below z6.
      map.addSource(overview,{type:'image',url:spec.preview_url,coordinates:spec.preview_coordinates});
      map.addLayer({id:overview,type:'raster',source:overview,maxzoom:spec.minzoom,layout:{visibility:'none'},paint:{'raster-resampling':'nearest','raster-fade-duration':0}},'selection-line');
    }
    map.addSource(tiles,{type:'raster',url:'pmtiles://'+spec.url,tileSize:256,minzoom:spec.minzoom,maxzoom:spec.maxzoom});
    map.addLayer({id:tiles,type:'raster',source:tiles,minzoom:spec.preview_url?spec.minzoom:0,layout:{visibility:'none'},paint:{'raster-resampling':'nearest','raster-fade-duration':0}},'selection-line');
    raiseMapLabels();
  }
  function setAppMode(value) {
    if(busy)return;
    if (value!==appMode) selectionAttempt++;
    appMode=value;
    if (appMode==='live') loadProjectionLibrary().catch(()=>{});
    for(const button of root.querySelectorAll('[data-app-mode]')) {
      const active=button.dataset.appMode===value;
      button.setAttribute('aria-selected',String(active));
      root.querySelector('#'+button.getAttribute('aria-controls')).hidden=!active;
    }
    announce();updateSelection();setDisplay();
  }
  function installLayers() {
    basemapReady=true;
    updateBasemapTheme();
    map.addSource('coverage-mask',{type:'geojson',data:{type:'Feature',properties:{},geometry:coverage.mask}});
    map.addLayer({id:'coverage-mask',type:'fill',source:'coverage-mask',paint:{'fill-color':theme==='dark'?'#070907':'#8f928a','fill-opacity':0.04}});
    updateBackground();
    map.addSource('selection',{type:'geojson',data:empty});
    map.addSource('completed',{type:'geojson',data:feature(current?.area_ring?areaFromRing(current.area_ring):null)});
    map.addLayer({id:'selection-line',type:'line',source:'selection',paint:{'line-color':theme==='dark'?'#4aa894':'#2e7e72','line-width':2,'line-dasharray':[3,2]}});
    map.addLayer({id:'completed-line',type:'line',source:'completed',paint:{'line-color':theme==='dark'?'#4aa894':'#2e7e72','line-width':2}});
    installArchiveLayer();
    renderImages(current,true); updateSelection();raiseMapLabels();
  }
  map.on('style.load',()=>{installLayers();updateFlooding();});
  function updateZoomIndicator() {
    const zoom=map.getZoom().toFixed(1),indicator=legend.querySelector('.zoom-level');
    indicator.textContent='z '+zoom;
    indicator.setAttribute('aria-label','Map zoom level '+zoom);
  }
  updateZoomIndicator();
  map.on('zoom',()=>{updateZoomIndicator();resizeResultHeader();updateChangeOverview();});
  map.on('resize',resizeResultHeader);
  map.on('error',event=>{
    if(event.sourceId==='flooding') {
      if(floodingToggle.checked) {
        floodingStatus.textContent='Flooding could not load for this year. Try another year.';
        floodingStatus.hidden=false;
      }
      return;
    }
    if(event.sourceId==='wayback-background')return;
    if(event.sourceId?.startsWith('preprocessed-map-')) {
      if(appMode==='archive'&&event.sourceId==='preprocessed-map-'+archiveId)announce('The pre-processed map could not load. Please try again.',true);
      return;
    }
    if (event.error?.message?.includes('Failed to fetch')) announce('Some map tiles could not load. You can still use the place shortcuts.');
  });
  function floodingColor(pixel,color) {
    const days=pixel[0];
    color[0]=34;color[1]=84;color[2]=209;
    color[3]=Number.isFinite(days)&&days>0?Math.round(255*0.75*Math.min(days/90,1)):0;
  }
  async function floodingProtocol(params,abortController) {
    const response=await MaplibreCOGProtocol.cogProtocol(params,abortController);
    if(params.type!=='image')return response;
    // WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmaps. MapLibre's
    // raster shader expects premultiplied RGB, so set it when creating the bitmap.
    try {
      return {...response,data:await createImageBitmap(response.data,{premultiplyAlpha:'premultiply'})};
    } finally {response.data.close();}
  }
  function loadScript(src) {
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src;
      script.onload=resolve;
      script.onerror=()=>{script.remove();reject(new Error('Could not load '+src));};
      document.head.append(script);
    });
  }
  let floodingLibrary;
  function loadFloodingLibrary() {
    floodingLibrary ??= loadScript('https://unpkg.com/@geomatico/maplibre-cog-protocol@0.10.0/dist/index.js')
      .catch(error=>{floodingLibrary=null;throw error;});
    return floodingLibrary;
  }
  async function updateFlooding() {
    const enabled=floodingToggle.checked,year=floodingYear.value;
    root.querySelector('.flooding-options').hidden=!enabled;
    floodingLegend.hidden=!enabled;
    floodingLegend.querySelector('.flooding-legend-year').textContent=year;
    floodingStatus.hidden=true;
    if(!basemapReady||!map.getLayer('selection-line'))return;
    if(!enabled) {
      if(map.getLayer('flooding'))map.setLayoutProperty('flooding','visibility','none');
      return;
    }
    const url=props.flooding_maps?.[year];
    if(!url)return;
    try {
      await loadFloodingLibrary();
    } catch {
      if (floodingToggle.checked && floodingYear.value===year) {
        floodingStatus.textContent='Flooding could not load. Toggle it to retry.';
        floodingStatus.hidden=false;
      }
      return;
    }
    if (!floodingToggle.checked || floodingYear.value!==year) return;
    if(!window.settlementCOGProtocol) {
      maplibregl.addProtocol('cog',floodingProtocol);
      window.settlementCOGProtocol=true;
    }
    MaplibreCOGProtocol.setColorFunction(url,floodingColor);
    if(!map.getSource('flooding')) {
      map.addSource('flooding',{type:'raster',url:'cog://'+url,tileSize:256});
      const anchor=map.getStyle().layers.find(layer=>layer.id.startsWith('preprocessed-')||layer.id==='buildings'||layer.id==='settlement')?.id||'selection-line';
      map.addLayer({id:'flooding',type:'raster',source:'flooding',paint:{'raster-opacity':0.999,'raster-resampling':'nearest','raster-fade-duration':0}},anchor);
      if(map.getLayer('sentinel-image'))map.moveLayer('sentinel-image','flooding');
      raiseMapLabels();
    } else if(activeFloodingYear!==year)map.getSource('flooding').setUrl('cog://'+url);
    activeFloodingYear=year;
    map.setLayoutProperty('flooding','visibility','visible');
  }
  floodingToggle.addEventListener('change',updateFlooding);
  floodingYear.addEventListener('change',updateFlooding);
  function fitArea(area,shortcut,immediate=false) {
    const bounds=area.ring.reduce((bounds,p)=>bounds.extend(p),new maplibregl.LngLatBounds());
    const width=container.clientWidth, height=container.clientHeight;
    const headerBottom=root.querySelector('.tracker-header').getBoundingClientRect().bottom-root.getBoundingClientRect().top;
    const padding=width>700?{top:Math.max(180,height*.25),bottom:Math.max(90,height*.2),left:Math.min(390,width*.34),right:Math.max(65,width*.14)}
      :{top:Math.min(headerBottom+125,height*.48),bottom:105,left:55,right:55};
    // A map click should reveal the neighbourhood, rather than fill the screen
    // with the 2 km square. Explicit town shortcuts can move a little closer.
    const maxZoom=shortcut?13.5:12.5;
    const camera=map.cameraForBounds(bounds,{padding,maxZoom});
    if (camera&&(shortcut||map.getZoom()<camera.zoom)) {
      const duration=immediate||matchMedia('(prefers-reduced-motion: reduce)').matches?0:(shortcut?2200:1800);
      map.fitBounds(bounds,{padding,maxZoom,duration});
    }
  }
  let projectionLibrary, selectionAttempt=0;
  function loadProjectionLibrary() {
    projectionLibrary ??= loadScript('https://unpkg.com/proj4@2.12.1/dist/proj4.js')
      .catch(error=>{projectionLibrary=null;throw error;});
    return projectionLibrary;
  }
  async function selectLocation(point,shortcut=false) {
    if (busy||appMode!=='live') return false;
    const attempt=++selectionAttempt;
    if (!insideCoverage(point)) { announce('Choose a location inside the visible coverage area.');return false; }
    if (typeof proj4==='undefined') announce('Preparing area selection…');
    try {
      await loadProjectionLibrary();
    } catch {
      if (attempt===selectionAttempt && appMode==='live') announce('Area selection could not load. Try selecting the location again.',true);
      return false;
    }
    if (attempt!==selectionAttempt||busy||appMode!=='live') return false;
    const area=makeSelection(point); if (!area) {announce('Choose a location inside the visible coverage area.');return false;}
    [longitude,latitude]=point; selectedArea=area; selected=true;
    announce(); run.disabled=false; updateSelection(); fitArea(area,shortcut);
    return true;
  }
  const account=root.querySelector('.account-options');
  const accountAction=root.querySelector('.account-action');
  const accountMessage=root.querySelector('.account-message');
  function accountReturnUrl() {
    const target=new URL(window.location.href);
    target.searchParams.set('account_return','1');
    target.searchParams.set('map_mode','live');
    target.searchParams.set('target_day',day.value);
    target.searchParams.set('comparison_mode',comparisonMode.value);
    target.searchParams.set('comparison_years',comparisonYears.value);
    target.searchParams.set('comparison_day',comparisonDay.value);
    target.searchParams.set('area_metres',String(areaMetres));
    if (longitude!==null&&latitude!==null) {
      target.searchParams.set('longitude',String(longitude));
      target.searchParams.set('latitude',String(latitude));
    }
    return target;
  }
  function refreshAccount(message) {
    const username=auth.username;
    root.querySelector('.account-status').textContent=username?'Logged in as '+username:'Log in to HF to use your GPU allowance';
    accountAction.textContent=username?'Log out':'Log in with Hugging Face';
    accountMessage.textContent=message||(username?'Hugging Face account connected.':'Sign in to use your Hugging Face GPU allowance.');
    accountAction.hidden=false;
  }
  account.addEventListener('toggle',()=>{if(account.open) refreshAccount();});
  accountAction.addEventListener('click',async event=>{
    event.preventDefault();
    if (busy) return;
    if (auth.username) {
      auth.clear();
      refreshAccount();
      return;
    }
    try {
      await auth.signIn(accountReturnUrl());
    } catch (error) {
      refreshAccount(error.message);
    }
  });
  // Only restore explicit auth return URLs; never automatically submit a run.
  const accountReturn=new URL(window.location.href);
  if (accountReturn.searchParams.get('account_return')==='1') {
    appMode='live';
    const params=accountReturn.searchParams;
    day.value=params.get('target_day')||day.value;
    comparisonMode.value=params.get('comparison_mode')==='custom'?'custom':'years';
    comparisonYears.value=params.get('comparison_years')||'1';
    comparisonDay.value=params.get('comparison_day')||'';
    const size=Number(params.get('area_metres'));
    if ([2000,4000,10000].includes(size)) {
      areaMetres=size;
    }
    updateComparison();
    const lon=Number(params.get('longitude')), lat=Number(params.get('latitude'));
    if (params.has('longitude')&&params.has('latitude')&&Number.isFinite(lon)&&Number.isFinite(lat)) {
      map.once('style.load',async ()=>{
        const restored=await selectLocation([lon,lat],true);
        // Keep the existing size label and warning in sync after restoring selection.
        if (restored&&[2000,4000,10000].includes(size)) sizePicker.querySelector('[data-size="'+size+'"]').click();
      });
    }
    for (const key of ['account_return','target_day','comparison_mode','comparison_years','comparison_day','area_metres','longitude','latitude']) params.delete(key);
    window.history.replaceState(null,'',accountReturn.href);
  }
  if (accountError) account.open=true;
  refreshAccount(accountError);
  map.on('click',event=>selectLocation([event.lngLat.lng,event.lngLat.lat]));
  root.querySelectorAll('[data-place]').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();
    const place=props.places.find(place=>place.name===link.dataset.place);
    if (place) selectLocation([place.longitude,place.latitude],true);
  }));
  day.addEventListener('change',()=>{
    if (!day.value) day.value=todayString(); day.setCustomValidity(''); announce();
    updateComparison();
    selected=Boolean(selectedArea); updateSelection();
  });
  function comparisonChanged() {
    updateComparison();announce();selected=Boolean(selectedArea);updateSelection();
  }
  comparisonYears.addEventListener('input',comparisonChanged);
  comparisonDay.addEventListener('input',comparisonChanged);
  comparisonModes.forEach(input=>input.addEventListener('change',()=>{
    if(!input.checked)return;
    comparisonMode.value=input.value;
    comparisonChanged();
  }));
  run.addEventListener('click',async ()=>{
    if (busy||!selectedArea) return;
    day.max=todayString();
    if (!day.reportValidity()) return;
    updateComparison();
    const custom=comparisonMode.value==='custom', control=custom?comparisonDay:comparisonYears;
    if (!control.checkValidity()) {
      comparison.open=true;control.reportValidity();return;
    }
    activeRunId=crypto.randomUUID(); activeArea=selectedArea; selected=true;
    removeResult(); announce(); setBusy(true); updateSelection(); setProgress('Preparing imagery…');
    const comparisonRequest=custom?{comparison_target_day:comparisonDay.value}:{comparison_years:Number(comparisonYears.value)};
    const request={longitude,latitude,target_day:day.value,...comparisonRequest,area_metres:areaMetres,run_id:activeRunId};
    try {
      await submit(request,renderResponse,setProgress);
    } catch (error) {
      renderResponse({state:'error',run_id:request.run_id,message:error.message || 'The run failed. Please try again.'});
    }
  });
  function renderResponse(value) {
    if (!value||value.state==='idle') return;
    if (value.run_id&&activeRunId&&value.run_id!==activeRunId) return;
    if (value.state==='preparing') { setBusy(true);setProgress('Preparing imagery…');return; }
    if (value.state==='error') {
      setBusy(false); progressMarker.remove();announce(value.message,true);updateSelection();return;
    }
    if (!value.coordinates) return;
    if (current?.change_levels!==value.change_levels) {
      clearImage('settlement');overviewUrl=null;overviewRequest=null;
    }
    current=value;
    if (value.area_ring) activeArea=areaFromRing(value.area_ring);
    renderImages(value);
    if (value.state==='mapping') {
      setBusy(true);setProgress('Running building detection model…');
    } else if (value.state==='ready') {
      setBusy(false); selected=false;progressMarker.remove();announce();
      map.getSource('completed')?.setData(feature(areaFromRing(value.area_ring)));
      buildResultHeader(value);updateSelection();
    }
  }
  const settings=root.querySelector('.tracker-settings');
  const settingsToggle=root.querySelector('.tracker-settings-toggle');
  function setSettingsOpen(open) {
    settings.hidden=!open;settingsToggle.setAttribute('aria-expanded',String(open));
  }
  settingsToggle.addEventListener('click',()=>setSettingsOpen(settings.hidden));
  // Capture outside interactions even when map controls stop propagation.
  for (const event of ['pointerdown','click']) document.addEventListener(event,event=>{
    const path=event.composedPath();
    if (!settings.hidden&&!path.includes(settings)&&!path.includes(settingsToggle)) setSettingsOpen(false);
  },true);
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape'&&!settings.hidden) {
      setSettingsOpen(false);settingsToggle.focus({preventScroll:true});
    }
  });
  opacity.addEventListener('input',()=>{root.querySelector('.opacity-value').textContent=opacity.value+'%';setDisplay();});
  function parseWaybackCatalog(catalog) {
    return Object.values(catalog).flatMap(item=>{
      const date=item.itemTitle?.match(/Wayback (\d{4}-\d{2}-\d{2})/)?.[1];
      if(!date||!item.itemURL?.startsWith('https://wayback.maptiles.arcgis.com/'))return [];
      const url=item.itemURL.replace('{level}','{z}').replace('{row}','{y}').replace('{col}','{x}');
      if(!['{z}','{x}','{y}'].every(token=>url.includes(token)))return [];
      return [{date,url}];
    }).sort((a,b)=>b.date.localeCompare(a.date));
  }
  async function loadWaybackReleases() {
    if(waybackItems.length)return;
    if(!waybackLoading)waybackLoading=(async()=>{
      const response=await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json',{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Wayback catalog unavailable');
      const items=parseWaybackCatalog(await response.json());
      if(!items.length)throw Error('No Wayback releases');
      waybackItems=items;
      waybackRelease.replaceChildren(...items.map(item=>new Option(item.date,item.date)));
      waybackRelease.disabled=false;
    })().finally(()=>{waybackLoading=null;});
    return waybackLoading;
  }
  function updateWaybackTiles(item) {
    if(!item||!basemapReady||!map.getLayer('coverage-mask'))return;
    if(!map.getSource('wayback-background')) {
      map.addSource('wayback-background',{type:'raster',tiles:[item.url],tileSize:256,maxzoom:23,attribution:'© Esri and its data providers'});
      // MapLibre 5.6 writes depth for raster-opacity === 1. Keep the basemap
      // visually opaque without letting its changing tile depths hide overlays.
      map.addLayer({id:'wayback-background',type:'raster',source:'wayback-background',paint:{'raster-opacity':0.999,'raster-fade-duration':0}},'coverage-mask');
    } else if(activeWaybackUrl!==item.url)map.getSource('wayback-background').setTiles([item.url]);
    activeWaybackUrl=item.url;
  }
  function updateBackground() {
    if(!basemapReady||!map.getLayer('coverage-mask'))return;
    const item=backgroundChoice.value==='wayback'?waybackItems.find(item=>item.date===waybackRelease.value):null;
    for(const layer of props.map_styles[theme].layers) {
      if(layer.type!=='background'&&map.getLayer(layer.id))map.setLayoutProperty(layer.id,'visibility',item?'none':layer.layout?.visibility??'visible');
    }
    updateWaybackTiles(item);
    if(map.getLayer('wayback-background')) {
      map.setLayoutProperty('wayback-background','visibility',item?'visible':'none');
      // Theme changes reorder basemap layers; keep imagery above their background.
      map.moveLayer('wayback-background','coverage-mask');
    }
  }
  backgroundChoice.addEventListener('change',async()=>{
    const wayback=backgroundChoice.value==='wayback';
    root.querySelector('.wayback-options').hidden=!wayback;
    backgroundStatus.hidden=true;
    if(wayback) {
      backgroundStatus.textContent='Loading releases…';backgroundStatus.hidden=false;
      try {await loadWaybackReleases();backgroundStatus.hidden=true;}
      catch {
        if(backgroundChoice.value!=='wayback')return;
        backgroundChoice.value='openfreemap';root.querySelector('.wayback-options').hidden=true;
        backgroundStatus.textContent='Could not load Wayback releases. Select Esri Wayback to retry.';backgroundStatus.hidden=false;
      }
    }
    updateBackground();
  });
  waybackRelease.addEventListener('change',()=>{
    backgroundStatus.hidden=true;
    // A release change must not restyle, reorder or reload the building layers.
    if(backgroundChoice.value==='wayback')updateWaybackTiles(waybackItems.find(item=>item.date===waybackRelease.value));
  });
  function updateBasemapTheme() {
    if(!basemapReady||basemapTheme===theme)return;
    const previous=props.map_styles[basemapTheme],next=props.map_styles[theme];
    const previousLayers=new Map(previous.layers.map(layer=>[layer.id,layer]));
    const nextIds=new Set(next.layers.map(layer=>layer.id));
    // Only the basemap layers belong to these style documents. All sources and
    // analysis overlays stay in place, retaining their tiles, images and state.
    for(const layer of previous.layers)if(!nextIds.has(layer.id)&&map.getLayer(layer.id))map.removeLayer(layer.id);
    const anchor=map.getLayer('coverage-mask')?'coverage-mask':undefined;
    for(const layer of next.layers) {
      if(!map.getLayer(layer.id)) {map.addLayer(layer,anchor);continue;}
      const old=previousLayers.get(layer.id)||{};
      for(const group of ['paint','layout']) {
        const keys=new Set([...Object.keys(old[group]||{}),...Object.keys(layer[group]||{})]);
        for(const key of keys) {
          const value=layer[group]?.[key];
          if(JSON.stringify(old[group]?.[key])===JSON.stringify(value))continue;
          if(group==='paint')map.setPaintProperty(layer.id,key,value??null);
          else map.setLayoutProperty(layer.id,key,value??null);
        }
      }
      if(JSON.stringify(old.filter)!==JSON.stringify(layer.filter))map.setFilter(layer.id,layer.filter??null);
      if(old.minzoom!==layer.minzoom||old.maxzoom!==layer.maxzoom)map.setLayerZoomRange(layer.id,layer.minzoom??0,layer.maxzoom??24);
    }
    // Restore target basemap ordering without moving any analysis overlays.
    for(const layer of next.layers)map.moveLayer(layer.id,anchor);
    raiseMapLabels();
    for(const id of ['selection-line','completed-line'])if(map.getLayer(id)) {
      map.setPaintProperty(id,'line-color',theme==='dark'?'#4aa894':'#2e7e72');
    }
    if(map.getLayer('coverage-mask'))map.setPaintProperty('coverage-mask','fill-color',theme==='dark'?'#070907':'#8f928a');
    basemapTheme=theme;
    updateBackground();
  }
  function applyTheme() {
    const next=preferredTheme||(appearance.matches?'dark':'light');
    root.dataset.theme=next;
    root.querySelectorAll('[data-theme-option]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeOption===next)));
    if(next===theme)return;
    theme=next;
    updateBasemapTheme();
  }
  function selectTheme(value) {
    preferredTheme=value;
    try {localStorage.setItem('settlement-tracker-theme',value);} catch { /* Switching still works without storage. */ }
    applyTheme();
  }
  root.querySelectorAll('[data-theme-option]').forEach(button=>button.addEventListener('click',()=>selectTheme(button.dataset.themeOption)));
  appearance.addEventListener('change',applyTheme);
  applyTheme();
  const appTabs=[...root.querySelectorAll('[data-app-mode]')];
  appTabs.forEach(button=>{
    button.addEventListener('click',()=>setAppMode(button.dataset.appMode));
    button.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||busy)return;
      event.preventDefault();
      const next=event.key==='Home'?appTabs[0]:event.key==='End'?appTabs[1]:appTabs.find(tab=>tab!==button);
      next.focus();setAppMode(next.dataset.appMode);
    });
  });
  root.querySelectorAll('[data-archive]').forEach(button=>button.addEventListener('click',()=>{
    if(!props.preprocessed_maps?.[button.dataset.archive])return;
    archiveId=button.dataset.archive;
    if(!archiveId.startsWith('obt-'))modelArchiveId=archiveId;
    announce();
    root.querySelectorAll('[data-archive]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
    installArchiveLayer();
    setDisplay();
  }));
  obtToggle.addEventListener('change',()=>{
    obtOptions.hidden=!obtToggle.checked;
    if(!obtToggle.checked&&archiveId.startsWith('obt-'))archiveId=modelArchiveId;
    root.querySelectorAll('[data-archive]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.archive===archiveId)));
    announce();installArchiveLayer();setDisplay();
  });
  const about=root.querySelector('.about-overlay'),aboutLink=root.querySelector('.about-link'),aboutClose=root.querySelector('.about-close');
  const aboutSiblings=[...root.children].filter(child=>child!==about);
  let aboutInert=[];
  function setAboutOpen(open) {
    about.hidden=!open;
    if(open){aboutInert=aboutSiblings.map(child=>child.inert);aboutSiblings.forEach(child=>child.inert=true);aboutClose.focus();}
    else {aboutSiblings.forEach((child,index)=>child.inert=aboutInert[index]||false);aboutLink.focus();}
  }
  aboutLink.addEventListener('click',()=>setAboutOpen(true));
  aboutClose.addEventListener('click',()=>setAboutOpen(false));
  about.addEventListener('click',event=>{if(event.target===about)setAboutOpen(false);});
  about.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();setAboutOpen(false);}
    if(event.key==='Tab'){
      const controls=[...about.querySelectorAll('button,a[href]')],first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  new ResizeObserver(()=>{
    map.resize();
    if (selected&&selectedArea) fitArea(selectedArea,true,true);
    else if (current?.area_ring) fitArea(areaFromRing(current.area_ring),true,true);
  }).observe(container);
  setAppMode(appMode);
}
