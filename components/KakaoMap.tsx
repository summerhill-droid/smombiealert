import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import { DANGER_ZONES } from "@/data/dangerZones";
import { useColors } from "@/hooks/useColors";
import { useProtection } from "@/context/ProtectionContext";
import { stripParens } from "@/lib/crosswalkName";
import { consumeMapTarget, subscribeMapTarget } from "@/lib/mapTarget";
import { useV2XSignals } from "@/hooks/useV2XSignals";
// 빌드 스크립트(`scripts/src/buildCrosswalks.ts`)가 생성하는 컴팩트 튜플:
// [id, gu, address, intersection, lat, lng] — 39k행. require()로 Metro 번들에 포함됨.
import CROSSWALKS_RAW from "@/assets/crosswalks.json";
// 보행등(신호등) 좌표 — [lat, lng] 튜플 배열. 경찰청 데이터 24k행.
// 횡단보도에 실제 신호등이 있는지 시각적으로 확인하기 위한 작은 마커.
import PED_LIGHTS_RAW from "@/assets/pedestrian_lights.json";

const KAKAO_KEY = "f24b3e12e3246e647e222f62c534115a";
// 한 번에 렌더하는 핀의 상한. 매우 줌아웃된 상태에서 수천개를 그리지 않도록 보호.
const MAX_PINS = 300;

type Crosswalk = {
  id: string;
  gu: string;
  address: string;
  intersection: string; // 괄호 제거된 표시용 이름
  lat: number;
  lng: number;
  hasLight: boolean; // 25m 내 보행등 존재 여부 (빌드 시 사전 계산)
};
// 빌드 산출물 튜플: [id, gu, address, intersection, lat, lng, hasLight(0|1)]
type Tuple = [string, string, string, string, number, number, number];
// 빌드 단계에서 "-"/빈값은 빈 문자열로 정규화됨. 여기서는 추가로 괄호 제거만 수행.
const CROSSWALKS: Crosswalk[] = (CROSSWALKS_RAW as Tuple[]).map(
  ([id, gu, address, intersection, lat, lng, hasLight]) => ({
    id,
    gu,
    address,
    intersection: stripParens(intersection),
    lat,
    lng,
    hasLight: hasLight === 1,
  }),
);

/** 지도 viewport(bbox) 안의 횡단보도만 추려서 반환.
    cap 을 초과하면 viewport 중심에 가까운 것부터 남긴다(주변 우선). */
function findInBounds(
  list: Crosswalk[],
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  cap: number,
): Crosswalk[] {
  const loLat = Math.min(swLat, neLat);
  const hiLat = Math.max(swLat, neLat);
  const loLng = Math.min(swLng, neLng);
  const hiLng = Math.max(swLng, neLng);
  const cLat = (loLat + hiLat) / 2;
  const cLng = (loLng + hiLng) / 2;
  const out: Crosswalk[] = [];
  for (const c of list) {
    if (c.lat < loLat || c.lat > hiLat) continue;
    if (c.lng < loLng || c.lng > hiLng) continue;
    out.push(c);
  }
  // cap 이하면 그대로, 초과하면 중심거리순 정렬 후 컷.
  if (out.length > cap) {
    out.sort((a, b) => {
      const da = (a.lat - cLat) ** 2 + (a.lng - cLng) ** 2;
      const db = (b.lat - cLat) ** 2 + (b.lng - cLng) ** 2;
      return da - db;
    });
    return out.slice(0, cap);
  }
  return out;
}

// 보행등 좌표 배열: [[lat,lng],...]
const PED_LIGHTS: [number, number][] = PED_LIGHTS_RAW as [number, number][];
// 한 번에 그리는 보행등 상한.
const MAX_LIGHTS = 400;

/** viewport 안의 보행등 좌표만 반환. cap 초과 시 중심 가까운 순. */
function lightsInBounds(
  swLat: number,
  swLng: number,
  neLat: number,
  neLng: number,
  cap: number,
): [number, number][] {
  const loLat = Math.min(swLat, neLat);
  const hiLat = Math.max(swLat, neLat);
  const loLng = Math.min(swLng, neLng);
  const hiLng = Math.max(swLng, neLng);
  const cLat = (loLat + hiLat) / 2;
  const cLng = (loLng + hiLng) / 2;
  const out: [number, number][] = [];
  for (const p of PED_LIGHTS) {
    if (p[0] < loLat || p[0] > hiLat) continue;
    if (p[1] < loLng || p[1] > hiLng) continue;
    out.push(p);
  }
  if (out.length > cap) {
    out.sort((a, b) => {
      const da = (a[0] - cLat) ** 2 + (a[1] - cLng) ** 2;
      const db = (b[0] - cLat) ** 2 + (b[1] - cLng) ** 2;
      return da - db;
    });
    return out.slice(0, cap);
  }
  return out;
}

function buildHtml(bg: string) {
  const zones = JSON.stringify(DANGER_ZONES);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body,#map{margin:0;padding:0;width:100%;height:100%;background:${bg};}
  .pulse{
    width:22px;height:22px;border-radius:50%;
    background:#3B82F6;border:3px solid #fff;
    box-shadow:0 0 0 0 rgba(59,130,246,0.6);
    animation:pulse 1.6s infinite;
  }
  @keyframes pulse{
    0%{box-shadow:0 0 0 0 rgba(59,130,246,0.6);}
    70%{box-shadow:0 0 0 18px rgba(59,130,246,0);}
    100%{box-shadow:0 0 0 0 rgba(59,130,246,0);}
  }
  .cw-pin{
    width:18px;height:18px;border-radius:50%;
    background:transparent;border:2px solid #2196F3;
    box-shadow:0 1px 3px rgba(0,0,0,0.4);
    transition:transform .15s ease, box-shadow .15s ease;
    cursor:pointer;
    touch-action:manipulation;
    -webkit-user-select:none;user-select:none;
  }
  .cw-pin.green{ background:#4CAF50; border-color:#fff; }
  .cw-pin.red  { background:#E84545; border-color:#fff; }
  .cw-pin.grey { background:#9E9E9E; border-color:#fff; }
  .cw-pin.pressing{
    transform:scale(1.6);
    box-shadow:0 4px 10px rgba(0,0,0,0.45);
  }
  .cw-sec{
    margin-bottom:10px;
    color:#fff;
    padding:2px 8px;
    border-radius:999px;
    font:700 12px -apple-system,Inter,"Apple SD Gothic Neo",sans-serif;
    white-space:nowrap;
    box-shadow:0 2px 6px rgba(0,0,0,0.45);
    pointer-events:none;
    letter-spacing:0.2px;
  }
  .cw-sec.green{ background:#4CAF50; }
  .cw-sec.red  { background:#E84545; }
  .ped-light{
    width:7px;height:7px;border-radius:50%;
    background:#FFC107;border:1.5px solid #fff;
    box-shadow:0 0 0 1px rgba(0,0,0,0.35);
    pointer-events:none;
  }
  .cw-popup{
    background:rgba(11,16,32,0.95);
    color:#F4F6FB;
    padding:8px 12px;
    border-radius:12px;
    border:1px solid rgba(255,255,255,0.12);
    font:600 12.5px -apple-system,Inter,"Apple SD Gothic Neo",sans-serif;
    white-space:nowrap;
    box-shadow:0 8px 24px rgba(0,0,0,0.5);
    pointer-events:none;
    margin-bottom:14px;
  }
  .cw-highlight{
    pointer-events:none;
    filter:drop-shadow(0 4px 8px rgba(0,0,0,0.55));
    animation:hl-bounce 1.4s ease-in-out infinite;
    transform-origin:50% 100%;
  }
  @keyframes hl-bounce{
    0%,100%{transform:translateY(0);}
    50%{transform:translateY(-4px);}
  }
  .cw-label{
    margin-bottom:10px;
    background:rgba(255,255,255,0.95);
    color:#0B1020;
    padding:2px 7px;
    border-radius:8px;
    border:1px solid rgba(0,0,0,0.08);
    font:600 10.5px -apple-system,Inter,"Apple SD Gothic Neo",sans-serif;
    white-space:nowrap;
    box-shadow:0 2px 5px rgba(0,0,0,0.25);
    pointer-events:none;
    letter-spacing:0.1px;
  }
  .v2x-pin{
    width:16px;height:16px;border-radius:50%;
    border:2px solid #fff;
    box-shadow:0 0 0 1px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.45);
    pointer-events:none;
  }
  .v2x-pin.green{ background:#4CAF50; }
  .v2x-pin.red  { background:#E84545; }
  .v2x-pin.grey { background:#666666; }
  .v2x-label{
    margin-left:14px;
    background:rgba(11,16,32,0.85);
    color:#F4F6FB;
    padding:2px 7px;
    border-radius:999px;
    border:1px solid rgba(255,255,255,0.12);
    font:700 11px -apple-system,Inter,"Apple SD Gothic Neo",sans-serif;
    white-space:nowrap;
    box-shadow:0 2px 6px rgba(0,0,0,0.4);
    pointer-events:none;
    letter-spacing:0.2px;
  }
</style>
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}"></script>
</head><body>
<div id="map"></div>
<script>
  var ZONES = ${zones};
  var map, userOverlay;
  var sevColor = { 1:'#FFB020', 2:'#FF7A1A', 3:'#FF3B5C' };

  var crosswalkOverlays = [];
  var popupOverlay = null;
  var popupHideTimer = null;
  var highlightOverlay = null;
  var v2xOverlays = [];
  var lightOverlays = [];
  var v2xSignals = [];
  var SIGNAL_MATCH_RADIUS = 45;
  var userLat = 37.5665, userLng = 126.978;

  function post(msg){
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
    try { window.parent && window.parent.postMessage({ __kakaomap: msg }, '*'); } catch(e){}
  }

  function emitBounds(){
    if (!map) return;
    var b = map.getBounds();
    var sw = b.getSouthWest(), ne = b.getNorthEast();
    post({
      type:'bounds',
      swLat: sw.getLat(), swLng: sw.getLng(),
      neLat: ne.getLat(), neLng: ne.getLng()
    });
  }

  function init(){
    map = new kakao.maps.Map(document.getElementById('map'), {
      center: new kakao.maps.LatLng(userLat, userLng),
      level: 3,
      draggable: true
    });

    ZONES.forEach(function(z){
      new kakao.maps.Circle({
        map: map,
        center: new kakao.maps.LatLng(z.lat, z.lng),
        radius: z.radius,
        strokeWeight: 2,
        strokeColor: sevColor[z.severity],
        strokeOpacity: 0.95,
        strokeStyle: 'solid',
        fillColor: sevColor[z.severity],
        fillOpacity: 0.18
      });

      var el = document.createElement('div');
      el.style.cssText = 'transform:translate(-50%,-100%);background:'+sevColor[z.severity]+';color:#0B1020;font:600 11px -apple-system,Inter,sans-serif;padding:4px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      el.textContent = z.name;
      new kakao.maps.CustomOverlay({
        map: map,
        position: new kakao.maps.LatLng(z.lat, z.lng),
        content: el,
        yAnchor: 1.6,
        xAnchor: 0.5
      });
    });

    var dot = document.createElement('div');
    dot.className = 'pulse';
    userOverlay = new kakao.maps.CustomOverlay({
      map: map,
      position: new kakao.maps.LatLng(userLat, userLng),
      content: dot,
      yAnchor: 0.5, xAnchor: 0.5,
      zIndex: 9999
    });

    kakao.maps.event.addListener(map, 'click', hidePopup);
    kakao.maps.event.addListener(map, 'idle', emitBounds);

    post({type:'ready'});
    setTimeout(emitBounds, 0);
  }

  function haversine(lat1, lng1, lat2, lng2){
    var R = 6371000;
    var toRad = function(d){ return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function formatDist(m){
    if (m == null) return '';
    return m < 1000 ? Math.round(m) + 'm' : (m/1000).toFixed(1) + 'km';
  }

  function bearing(lat1, lng1, lat2, lng2){
    var toRad = function(d){ return d*Math.PI/180; };
    var toDeg = function(r){ return r*180/Math.PI; };
    var dLng = toRad(lng2 - lng1);
    var y = Math.sin(dLng) * Math.cos(toRad(lat2));
    var x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(dLng);
    var b = toDeg(Math.atan2(y, x));
    return (b + 360) % 360;
  }
  function angleDiff(a, b){
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function matchSignal(cwLat, cwLng){
    var nearest = null, nearestDist = Infinity;
    for (var i = 0; i < v2xSignals.length; i++){
      var s = v2xSignals[i];
      if (s.lat == null || s.lng == null) continue;
      var d = haversine(cwLat, cwLng, s.lat, s.lng);
      if (d < nearestDist){ nearestDist = d; nearest = s; }
    }
    if (!nearest || nearestDist > SIGNAL_MATCH_RADIUS){
      return { nearIntersection: false, phase: null };
    }
    var cwBearing = bearing(nearest.lat, nearest.lng, cwLat, cwLng);
    var dirs = nearest.dirs || [];
    var best = null, bestAngle = Infinity;
    for (var j = 0; j < dirs.length; j++){
      var dir = dirs[j];
      if (dir.phase !== 'green' && dir.phase !== 'red') continue;
      var ad = angleDiff(cwBearing, dir.bearing);
      if (ad < bestAngle){ bestAngle = ad; best = dir; }
    }
    if (best){
      return {
        nearIntersection: true,
        phase: best.phase,
        remainingSec: best.remainingSec,
        statNm: best.statNm,
        name: nearest.name
      };
    }
    if (nearest.color === 'green' || nearest.color === 'red'){
      return {
        nearIntersection: true,
        phase: nearest.color,
        remainingSec: nearest.remainingSec,
        name: nearest.name
      };
    }
    return { nearIntersection: true, phase: null, name: nearest.name };
  }

  function showPopup(item, lat, lng){
    hidePopup();
    var dist = haversine(userLat, userLng, lat, lng);
    var name = item.intersection || item.address || ('ID ' + item.id);
    var el = document.createElement('div');
    el.className = 'cw-popup';
    el.textContent = name + ' · ' + formatDist(dist);
    popupOverlay = new kakao.maps.CustomOverlay({
      map: map,
      position: new kakao.maps.LatLng(lat, lng),
      content: el,
      yAnchor: 1.0, xAnchor: 0.5,
      zIndex: 80
    });
    clearTimeout(popupHideTimer);
    popupHideTimer = setTimeout(hidePopup, 3500);
  }
  function hidePopup(){
    if (popupOverlay) { popupOverlay.setMap(null); popupOverlay = null; }
    clearTimeout(popupHideTimer);
  }

  function clearCrosswalks(){
    crosswalkOverlays.forEach(function(o){ o.setMap(null); });
    crosswalkOverlays = [];
  }
  function renderCrosswalks(items){
    clearCrosswalks();
    items.forEach(function(item){
      var pos = new kakao.maps.LatLng(item.lat, item.lng);
      var sig = item.hasLight ? matchSignal(item.lat, item.lng) : null;
      var sigColor = (sig && sig.phase) ? sig.phase : null;

      var pinClass = 'cw-pin';
      if (sigColor) pinClass += ' ' + sigColor;
      else if (item.hasLight && sig && sig.nearIntersection) pinClass += ' grey';

      var el = document.createElement('div');
      el.className = pinClass;
      var onTap = function(e){
        e.stopPropagation && e.stopPropagation();
        showPopup(item, item.lat, item.lng);
      };
      el.addEventListener('click', onTap);
      el.addEventListener('touchend', function(e){
        e.preventDefault && e.preventDefault();
        onTap(e);
      });

      var ov = new kakao.maps.CustomOverlay({
        map: map,
        position: pos,
        content: el,
        yAnchor: 0.5, xAnchor: 0.5,
        zIndex: 20
      });
      crosswalkOverlays.push(ov);

      var name = (item.intersection || '').trim();
      if (name === '-') name = '';

      if (sigColor) {
        var hasSec = (typeof sig.remainingSec === 'number' && isFinite(sig.remainingSec));
        var typeTxt = sig.statNm || (sigColor === 'green' ? '보행' : '정지');
var secTxt = hasSec ? (typeTxt + ' ' + sig.remainingSec + 's') : typeTxt;
        var labelTxt = name ? (name + ' ' + secTxt) : secTxt;
        var secEl = document.createElement('div');
        secEl.className = 'cw-sec ' + sigColor;
        secEl.textContent = labelTxt;
        var secOv = new kakao.maps.CustomOverlay({
          map: map,
          position: pos,
          content: secEl,
          yAnchor: 1.0, xAnchor: 0.5,
          zIndex: 22
        });
        crosswalkOverlays.push(secOv);
      } else if (name) {
        var lbl = document.createElement('div');
        lbl.className = 'cw-label';
        lbl.textContent = name;
        var lblOv = new kakao.maps.CustomOverlay({
          map: map,
          position: pos,
          content: lbl,
          yAnchor: 1.0, xAnchor: 0.5,
          zIndex: 21
        });
        crosswalkOverlays.push(lblOv);
      }
    });
  }

  function clearV2X(){
    v2xOverlays.forEach(function(o){ o.setMap(null); });
    v2xOverlays = [];
  }
  function renderV2X(items){
    clearV2X();
    v2xSignals = items || [];
  }
  var lastCrosswalkItems = [];

  window.updateLocation = function(lat, lng, follow){
    userLat = lat; userLng = lng;
    if (!userOverlay) return;
    var p = new kakao.maps.LatLng(lat, lng);
    userOverlay.setPosition(p);
    if (follow) map.panTo(p);
  };
  window.setUser = window.updateLocation;

  window.updateCrosswalks = function(items){
    if (!map) return;
    lastCrosswalkItems = items || [];
    renderCrosswalks(lastCrosswalkItems);
  };

  window.updateV2XSignals = function(items){
    if (!map) return;
    renderV2X(items || []);
    renderCrosswalks(lastCrosswalkItems);
  };

  function clearLights(){
    lightOverlays.forEach(function(o){ o.setMap(null); });
    lightOverlays = [];
  }
  window.updateLights = function(points){
    if (!map) return;
    clearLights();
    (points || []).forEach(function(p){
      var el = document.createElement('div');
      el.className = 'ped-light';
      var ov = new kakao.maps.CustomOverlay({
        map: map,
        position: new kakao.maps.LatLng(p[0], p[1]),
        content: el,
        yAnchor: 0.5, xAnchor: 0.5,
        zIndex: 10
      });
      lightOverlays.push(ov);
    });
  };

  window.recenter = function(lat, lng){
    if (!map) return;
    map.setLevel(3);
    map.panTo(new kakao.maps.LatLng(lat, lng));
  };
  window.centerMap = function(lat, lng){
    if (!map) return;
    map.setLevel(2);
    map.panTo(new kakao.maps.LatLng(lat, lng));
  };
  window.setHighlight = function(lat, lng){
    if (!map) return;
    window.clearHighlight();
    var el = document.createElement('div');
    el.className = 'cw-highlight';
    el.innerHTML =
      '<svg width="30" height="40" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M12 0 C5 0 0 5 0 12 C0 21 12 32 12 32 C12 32 24 21 24 12 C24 5 19 0 12 0 Z" ' +
              'fill="#EF4444" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="12" cy="11" r="4" fill="#fff"/>' +
      '</svg>';
    highlightOverlay = new kakao.maps.CustomOverlay({
      map: map,
      position: new kakao.maps.LatLng(lat, lng),
      content: el,
      yAnchor: 1.0, xAnchor: 0.5,
      zIndex: 60
    });
  };
  window.clearHighlight = function(){
    if (highlightOverlay) {
      highlightOverlay.setMap(null);
      highlightOverlay = null;
    }
  };
  window.requestBounds = function(){ emitBounds(); };

  kakao.maps.load(init);
</script>
</body></html>`;
}

export function KakaoMap() {
  const colors = useColors();
  const webRef = useRef<WebView>(null);
  const html = useMemo(() => buildHtml(colors.background), [colors.background]);
  const { position } = useProtection();
  const readyRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 실전용: 내 위치 주변 교차로의 신호를 자동으로 받아온다.
  const v2xSignals = useV2XSignals(position);

  const runInWebview = useCallback((js: string) => {
    if (Platform.OS === "web") {
      const w = iframeRef.current?.contentWindow as
        | (Window & { eval?: (s: string) => unknown })
        | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (w as any)?.eval?.(js);
      } catch {
        // iframe 미준비 등은 무시
      }
    } else {
      webRef.current?.injectJavaScript(js + " true;");
    }
  }, []);

  const pushPinsForBounds = useCallback(
    (swLat: number, swLng: number, neLat: number, neLng: number) => {
      const pins = findInBounds(CROSSWALKS, swLat, swLng, neLat, neLng, MAX_PINS).map(
        (c) => ({
          id: c.id,
          intersection: c.intersection,
          address: c.address,
          lat: c.lat,
          lng: c.lng,
          hasLight: c.hasLight,
        }),
      );
      const lights = lightsInBounds(swLat, swLng, neLat, neLng, MAX_LIGHTS);
      runInWebview(
        `window.updateCrosswalks && window.updateCrosswalks(${JSON.stringify(pins)});` +
          `window.updateLights && window.updateLights(${JSON.stringify(lights)});`,
      );
    },
    [runInWebview],
  );

  useEffect(() => {
    if (!readyRef.current) return;
    runInWebview(
      `window.updateLocation && window.updateLocation(${position.lat}, ${position.lng}, false);`,
    );
  }, [position.lat, position.lng, runInWebview]);

  useEffect(() => {
    if (!readyRef.current) return;
    runInWebview(
      `window.updateV2XSignals && window.updateV2XSignals(${JSON.stringify(v2xSignals)});`,
    );
  }, [v2xSignals, runInWebview]);

  const pendingTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const flush = (lat: number, lng: number) => {
      if (!readyRef.current) {
        pendingTargetRef.current = { lat, lng };
        return;
      }
      runInWebview(
        `window.centerMap && window.centerMap(${lat}, ${lng});` +
          `window.setHighlight && window.setHighlight(${lat}, ${lng});`,
      );
    };
    const unsub = subscribeMapTarget((t) => flush(t.lat, t.lng));
    const initial = consumeMapTarget();
    if (initial) flush(initial.lat, initial.lng);
    return unsub;
  }, [runInWebview]);

  const handleRecenterToMe = () => {
    runInWebview(
      `window.recenter && window.recenter(${position.lat}, ${position.lng});` +
        `window.clearHighlight && window.clearHighlight();`,
    );
  };

  const handleReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    runInWebview(
      `window.updateLocation && window.updateLocation(${position.lat}, ${position.lng}, true);` +
        `window.requestBounds && window.requestBounds();` +
        `window.updateV2XSignals && window.updateV2XSignals(${JSON.stringify(v2xSignals)});`,
    );
    const pending = pendingTargetRef.current;
    if (pending) {
      pendingTargetRef.current = null;
      runInWebview(
        `window.centerMap && window.centerMap(${pending.lat}, ${pending.lng});` +
          `window.setHighlight && window.setHighlight(${pending.lat}, ${pending.lng});`,
      );
    }
  };

  const handleMessageData = useCallback(
    (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const msg = data as { type?: string };
      if (msg.type === "ready") {
        handleReady();
      } else if (msg.type === "bounds") {
        const b = msg as {
          swLat: number;
          swLng: number;
          neLat: number;
          neLng: number;
        };
        pushPinsForBounds(b.swLat, b.swLng, b.neLat, b.neLng);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushPinsForBounds],
  );

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      handleMessageData(JSON.parse(e.nativeEvent.data));
    } catch {}
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onMsg = (e: MessageEvent) => {
      const payload = (e?.data as { __kakaomap?: unknown })?.__kakaomap;
      if (payload == null) return;
      if (payload === "ready") handleReady();
      else handleMessageData(payload);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMessageData]);

  const insets = useSafeAreaInsets();
  const buttonBottom = (insets.bottom || 0) + 86;

  const myLocationButton = (
    <Pressable
      onPress={handleRecenterToMe}
      accessibilityLabel="내 위치로 이동"
      style={({ pressed }) => [
        styles.locBtn,
        {
          bottom: buttonBottom,
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Feather name="navigation" size={20} color={colors.accent} />
    </Pressable>
  );

  if (Platform.OS === "web") {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
        <iframe
          ref={iframeRef}
          title="kakao-map"
          srcDoc={html}
          style={{ border: 0, width: "100%", height: "100%" }}
        />
        {myLocationButton}
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <WebView
        ref={webRef}
        style={StyleSheet.absoluteFill}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://localhost" }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
      />
      {myLocationButton}
    </View>
  );
}

const styles = StyleSheet.create({
  locBtn: {
    position: "absolute",
    right: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});