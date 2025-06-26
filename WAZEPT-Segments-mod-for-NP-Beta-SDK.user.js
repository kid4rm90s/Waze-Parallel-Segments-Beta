// ==UserScript==
// @name            WazePT Segment Mod for NP Beta SDK
// @author          kid4rm90s
// @description     This script allows creating various map features around selected road segments. Additionally, it allows creating map comments shaped as cameras and arrows.
// @match           *://*.waze.com/*editor*
// @exclude         *://*.waze.com/user/editor*
// @grant           none
// @require         https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @require         https://cdn.jsdelivr.net/gh/wazeSpace/wme-sdk-plus@06108853094d40f67e923ba0fe0de31b1cec4412/wme-sdk-plus.js
// @require         https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
// @downloadURL     none
// @updateURL       none
// @version         2025.06.26.1
// ==/UserScript==

/* global W, OpenLayers, require, $, _, WazeWrap */

(async function () {
  console.log('[WazePTSegment] Userscript loaded and IIFE started');
  console.debug('[WazePTSegment] DEBUG: Script start');
  await SDK_INITIALIZED;
  console.log('[WazePTSegment] SDK_INITIALIZED resolved');
  console.debug('[WazePTSegment] DEBUG: SDK_INITIALIZED resolved');
  const SCRIPT_NAME = GM_info.script.name;
  const SCRIPT_VERSION = GM_info.script.version;
  const wmeSdk = getWmeSdk({ scriptId: "wme-map-comment-geometry", scriptName: "WME Map Comment Geometry" });
  if (!wmeSdk.State.isInitialized()) {
    console.debug('[WazePTSegment] DEBUG: Waiting for wme-initialized');
    await wmeSdk.Events.once({ eventName: "wme-initialized" });
  }
  console.debug('[WazePTSegment] DEBUG: wmeSdk initialized');
  initWmeSdkPlus(wmeSdk);
  WazePTSegment_bootstrap();
  console.debug('[WazePTSegment] DEBUG: Bootstrap complete');

  // --- Utility Functions ---
  function ensureMetricUnits(value) {
    const userSettings = wmeSdk.Settings.getUserSettings();
    if (userSettings && !userSettings.isImperial) return value;
    return Math.round(value * 0.3048);
  }

  function getSegmentWidth(segmentId) {
    const segment = wmeSdk.DataModel.Segments.getById({ segmentId });
    if (!segment) return null;
    const segmentAddress = wmeSdk.DataModel.Segments.getAddress({ segmentId });
    const defaultLaneWidth = (segmentAddress.country.defaultLaneWidthPerRoadType?.[segment.roadType] ?? 330) / 100;
    const avgLanes = ((segment.fromLanesInfo?.numberOfLanes || 1) + (segment.toLanesInfo?.numberOfLanes || 1)) / 2;
    const avgLaneWidth = ((ensureMetricUnits(segment.fromLanesInfo?.laneWidth) || defaultLaneWidth) + (ensureMetricUnits(segment.toLanesInfo?.laneWidth) || defaultLaneWidth)) / 2;
    return avgLaneWidth * avgLanes;
  }

  function getWidthOfSegments(segmentIds) {
    const widths = segmentIds.map(getSegmentWidth).filter(Boolean);
    return Math.round(widths.reduce((sum, w) => sum + w, 0) / widths.length);
  }

  function getSelectedSegmentsMergedLineString() {
    const selection = wmeSdk.Editing.getSelection();
    if (!selection || selection.objectType !== "segment") return null;
    return mergeSegmentsGeometry(selection.ids.map(String));
  }

  function convertToLandmark(geometry, width) {
    return turf.buffer(geometry, width / 2, { units: "meters" }).geometry;
  }

  function drawParallelOverlays(origLine, distance) {
    if (!window.WazePTSegment_OverlayLayer) {
      window.WazePTSegment_OverlayLayer = new OpenLayers.Layer.Vector('WazePTSegment_ParallelOverlay', { displayInLayerSwitcher: false });
      W.map.addLayer(window.WazePTSegment_OverlayLayer);
      W.map.setLayerIndex(window.WazePTSegment_OverlayLayer, W.map.layers.length - 1);
    }
    const overlayLayer = window.WazePTSegment_OverlayLayer;
    overlayLayer.setVisibility(true);
    overlayLayer.removeAllFeatures();
    const leftLine = turf.lineOffset(origLine, -distance/2, { units: 'meters' });
    const rightLine = turf.lineOffset(origLine, distance/2, { units: 'meters' });
    function turfLineToOL(line, color) {
      let coords = (line && line.geometry && (line.geometry.type === 'MultiLineString' || line.geometry.type === 'LineString')) ? line.geometry.coordinates : line.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      try {
        const olLine = new OpenLayers.Geometry.LineString(
          coords.map(([lon, lat]) => {
            const [x, y] = OpenLayers.Layer.SphericalMercator.forwardMercator(lon, lat);
            return new OpenLayers.Geometry.Point(x, y);
          })
        );
        return new OpenLayers.Feature.Vector(olLine, null, { strokeColor: color, strokeWidth: 5, strokeOpacity: 0.7 });
      } catch (e) { return null; }
    }
    const leftOverlay = turfLineToOL(leftLine, '#00ff00');
    const rightOverlay = turfLineToOL(rightLine, '#ff0000');
    overlayLayer.addFeatures([leftOverlay, rightOverlay].filter(Boolean));
  }

  // --- Main UI Bootstrap ---
  function WazePTSegment_bootstrap() {
    var wazeapi = W || window.W;
    if (!wazeapi || !wazeapi.map || !WazeWrap.Interface) {
      setTimeout(WazePTSegment_bootstrap, 1000);
      return;
    }
    WazePTSegment_init();
  }

  function WazePTSegment_init() {
    try {
      new WazeWrap.Alerts.ScriptUpdateMonitor(
        SCRIPT_NAME,
        SCRIPT_VERSION,
        "https://raw.githubusercontent.com/YULWaze/WME-MapCommentGeometry/main/WME%20MapCommentGeometry.user.js",
        GM_xmlhttpRequest
      ).start();
    } catch (ex) { console.log(ex.message); }

    function addWMESelectSegmentbutton() {
      $('#split-segment').remove();
      if (!wmeSdk.Editing.getSelection()) return;
      if (document.getElementById("MapCommentGeo")) $("#MapCommentGeo").remove();
      if (document.getElementById("split-segment")) $("#split-segment").remove();
      let segmentSelection = wmeSdk.Editing.getSelection();
      if (!segmentSelection || segmentSelection.objectType !== 'segment') return;
      let exit = false;
      const pedonal_id = [5,10,16];
      segmentSelection.ids.forEach(segmentId => {
        const seg = wmeSdk.DataModel.Segments.getById({ segmentId });
        if (!seg) return;
        if ((seg.fwdLaneCount && seg.fwdLaneCount !== 0) || (seg.revLaneCount && seg.revLaneCount !== 0)) exit = true;
        if (seg.fwdDirection === false || seg.revDirection === false) exit = true;
        if (pedonal_id.includes(seg.roadType)) exit = true;
      });
      if (!exit) {
        const selSegmentsDistance = $('<wz-select id="segmentsDistance" data-type="numeric" value="5" style="width: 45%;float:left;" />');
        [5,7,9,10,11,13,14,15,17,19,21,23,25,37].forEach(val => {
          selSegmentsDistance.append($(`<wz-option value="${val}">${val} m</wz-option>`));
        });
        const btn1 = $('<wz-button color="secondary" size="sm" style="float:right;margin-top: 5px;">Split Segment</wz-button>');
        btn1.click(() => {
          const dist = parseFloat(selSegmentsDistance.val());
          splitAndShiftSelectedSegment(dist);
        });
        const cnt = $('<div id="split-segment" class="form-group" style="display: flex;" />');
        const divGroup1 = $('<div/>' );
        divGroup1.append($('<wz-label>Distance between the two parallel segments:</wz-label>'));
        divGroup1.append(selSegmentsDistance);
        divGroup1.append(btn1);
        cnt.append(divGroup1);
        const $panel = $('#segment-edit-general');
        const $attrForm = $panel.find('.attributes-form');
        if ($attrForm.length) cnt.insertAfter($attrForm);
        else if ($panel.length) $panel.append(cnt);
        else { setTimeout(addWMESelectSegmentbutton, 250); return; }
        $("#segmentsDistance").val(localStorage.getItem("metersSplitSegment") || "5");
        $('#segmentsDistance').change(function(){
          localStorage.setItem("metersSplitSegment", $("#segmentsDistance").val());
        });
      }
    }

    wmeSdk.Events.on({
      eventName: "wme-selection-changed",
      eventHandler: () => {
        const sel = wmeSdk.Editing.getSelection();
        if (sel && sel.objectType === 'segment') addWMESelectSegmentbutton();
      }
    });
    if (wmeSdk.Editing.getSelection()?.objectType === "segment") addWMESelectSegmentbutton();
  }

  // --- Segment Split/Shift Logic ---
  // Helper: Offset a linestring by a given distance (meters) using vector math
  function offsetLineString(coords, offsetMeters) {
    if (coords.length < 2) return coords;
    const offsetCoords = [];
    for (let i = 0; i < coords.length; i++) {
      // For each point, get the direction of the segment before and after
      let dx = 0, dy = 0, count = 0;
      if (i > 0) {
        dx += coords[i][0] - coords[i-1][0];
        dy += coords[i][1] - coords[i-1][1];
        count++;
      }
      if (i < coords.length - 1) {
        dx += coords[i+1][0] - coords[i][0];
        dy += coords[i+1][1] - coords[i][1];
        count++;
      }
      if (count > 0) {
        dx /= count;
        dy /= count;
      }
      // Perpendicular vector (in degrees, so convert to meters using turf)
      const pt = turf.point(coords[i]);
      const bearing = Math.atan2(dy, dx) * 180 / Math.PI;
      // Perpendicular left: bearing - 90, right: bearing + 90
      const offsetPt = turf.destination(pt, offsetMeters, bearing - 90, { units: 'meters' });
      offsetCoords.push(offsetPt.geometry.coordinates);
    }
    return offsetCoords;
  }

  // Helper: Offset a linestring by a given distance (meters) using Web Mercator math (like OpenLayers)
  function offsetLineStringMercator(coords, offsetMeters) {
    if (coords.length < 2) return coords;
    // Convert to Web Mercator
    const merc = coords.map(([lon, lat]) => OpenLayers.Layer.SphericalMercator.forwardMercator(lon, lat));
    console.debug('offsetLineStringMercator: input coords', coords);
    console.debug('offsetLineStringMercator: mercator coords', merc);
    const offsetMerc = [];
    for (let i = 0; i < merc.length; i++) {
      let dx = 0, dy = 0, count = 0;
      if (i > 0) {
        dx += merc[i][0] - merc[i-1][0];
        dy += merc[i][1] - merc[i-1][1];
        count++;
      }
      if (i < merc.length - 1) {
        dx += merc[i+1][0] - merc[i][0];
        dy += merc[i+1][1] - merc[i][1];
        count++;
      }
      if (count > 0) {
        dx /= count;
        dy /= count;
      }
      // Perpendicular vector (meters)
      const len = Math.sqrt(dx*dx + dy*dy);
      let ox = 0, oy = 0;
      if (len > 0) {
        ox = -dy / len * offsetMeters;
        oy = dx / len * offsetMeters;
      }
      offsetMerc.push([merc[i][0] + ox, merc[i][1] + oy]);
      console.debug(`offsetLineStringMercator: pt[${i}] dx=${dx}, dy=${dy}, len=${len}, ox=${ox}, oy=${oy}, orig=(${merc[i][0]},${merc[i][1]}), shifted=(${merc[i][0]+ox},${merc[i][1]+oy})`);
    }
    // Convert back to lon/lat
    const result = offsetMerc.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y));
    console.debug('offsetLineStringMercator: result coords', result);
    return result;
  }

  // Helper: Offset a linestring by a given distance (meters) using OpenLayers-style vector math in Web Mercator, mimicking legacy script
  function offsetLineStringOpenLayersStyle(coords, offsetMeters) {
    if (coords.length < 2) return { left: coords, right: coords };
    // Convert to Web Mercator
    const merc = coords.map(([lon, lat]) => OpenLayers.Layer.SphericalMercator.forwardMercator(lon, lat));
    let leftPoints = [], rightPoints = [];
    let prevLeftEq = null, prevRightEq = null;
    let leftPb, rightPb;
    for (let i = 0; i < merc.length - 1; i++) {
      const pa = merc[i], pb = merc[i + 1];
      // Vector from pa to pb
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      // Scale factor (legacy script: (len + offset/2) / len)
      const scale = (len + Math.abs(offsetMeters)) / len;
      // Resize pb from pa
      function resize(base, other, scale) {
        return [base[0] + (other[0] - base[0]) * scale, base[1] + (other[1] - base[1]) * scale];
      }
      // Rotate a point around a base by angle (deg)
      function rotate(pt, base, angleDeg) {
        const angle = angleDeg * Math.PI / 180;
        const x = pt[0] - base[0];
        const y = pt[1] - base[1];
        const xRot = x * Math.cos(angle) - y * Math.sin(angle);
        const yRot = x * Math.sin(angle) + y * Math.cos(angle);
        return [base[0] + xRot, base[1] + yRot];
      }
      // Left side: rotate +90 at pa, -90 at pb
      let leftPa = resize(pa, pb, scale);
      leftPa = rotate(leftPa, pa, 90);
      leftPb = resize(pb, pa, scale);
      leftPb = rotate(leftPb, pb, -90);
      // Right side: rotate -90 at pa, +90 at pb
      let rightPa = resize(pa, pb, scale);
      rightPa = rotate(rightPa, pa, -90);
      rightPb = resize(pb, pa, scale);
      rightPb = rotate(rightPb, pb, 90);
      // Line equations for intersection
      function getEq(a, b) {
        if (b[0] === a[0]) return { x: a[0] };
        const slope = (b[1] - a[1]) / (b[0] - a[0]);
        const offset = a[1] - slope * a[0];
        return { slope, offset };
      }
      const leftEq = getEq(leftPa, leftPb);
      const rightEq = getEq(rightPa, rightPb);
      // Intersections for smooth join
      function intersect(eq1, eq2) {
        if (eq1.slope !== undefined && eq2.slope !== undefined) {
          if (eq1.slope === eq2.slope) return null;
          const x = (eq2.offset - eq1.offset) / (eq1.slope - eq2.slope);
          const y = eq1.slope * x + eq1.offset;
          return [x, y];
        } else if (eq1.x !== undefined) {
          return [eq1.x, eq2.slope * eq1.x + eq2.offset];
        } else if (eq2.x !== undefined) {
          return [eq2.x, eq1.slope * eq2.x + eq1.offset];
        }
        return null;
      }
      if (i === 0) {
        leftPoints = [leftPa];
        rightPoints = [rightPa];
      } else {
        const li = intersect(leftEq, prevLeftEq);
        const ri = intersect(rightEq, prevRightEq);
        if (li && ri) {
          leftPoints.push(li);
          rightPoints.push(ri);
        } else {
          leftPoints.push(leftPa);
          rightPoints.push(rightPa);
        }
      }
      prevLeftEq = leftEq;
      prevRightEq = rightEq;
      if (i === merc.length - 2) {
        leftPoints.push(leftPb);
        rightPoints.push(rightPb);
      }
    }
    // Convert back to lon/lat and remove consecutive duplicate points
    function dedupe(arr) {
      return arr.filter((pt, i, a) => i === 0 || pt[0] !== a[i-1][0] || pt[1] !== a[i-1][1]);
    }
    const leftLonLat = dedupe(leftPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y)));
    const rightLonLat = dedupe(rightPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y)));
    if (leftLonLat.length < 2 || rightLonLat.length < 2) {
      console.error('openLayersLegacyOffset: Not enough unique points', { leftLonLat, rightLonLat });
    }
    return { left: leftLonLat, right: rightLonLat };
  }

  async function splitAndShiftSelectedSegment(distance, forceSegmentId) {
    console.debug('splitAndShiftSelectedSegment: START', {distance, forceSegmentId});
    const selection = wmeSdk.Editing.getSelection();
    let segmentId = forceSegmentId !== undefined ? forceSegmentId : (selection && selection.objectType === 'segment' && selection.ids.length === 1 ? Number(selection.ids[0]) : null);
    if (!segmentId) { alert('Please select a single segment.'); console.debug('splitAndShiftSelectedSegment: No segmentId'); return; }
    const segori = wmeSdk.DataModel.Segments.getById({ segmentId });
    if (!segori) { alert('Segment not found.'); console.debug('splitAndShiftSelectedSegment: Segment not found', segmentId); return; }
    const origLine = segori.geometry;
    if (!origLine || origLine.type !== 'LineString') { alert('Invalid segment geometry.'); console.debug('splitAndShiftSelectedSegment: Invalid geometry', origLine); return; }
    drawParallelOverlays(origLine, distance);
    console.debug('splitAndShiftSelectedSegment: origLine', origLine);
    const totalLen = turf.length(origLine, { units: 'meters' });
    const midLen = totalLen / 2;
    const splitPoint = turf.along(origLine, midLen, { units: 'meters' });
    const splitCoord = splitPoint.geometry.coordinates;
    let insertIdx = -1, accumLen = 0;
    for (let i = 0; i < origLine.coordinates.length - 1; i++) {
      const segLen = turf.distance(turf.point(origLine.coordinates[i]), turf.point(origLine.coordinates[i+1]), { units: 'meters' });
      if (accumLen + segLen >= midLen) { insertIdx = i; break; }
      accumLen += segLen;
    }
    if (insertIdx === -1) { alert('Could not find valid split location.'); console.debug('splitAndShiftSelectedSegment: Could not find valid split location'); return; }
    function coordsEqual(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9; }
    let needInsert = !(coordsEqual(origLine.coordinates[insertIdx], splitCoord) || coordsEqual(origLine.coordinates[insertIdx+1], splitCoord));
    let newCoords = needInsert ? origLine.coordinates.slice(0, insertIdx + 1).concat([splitCoord]).concat(origLine.coordinates.slice(insertIdx + 1)) : origLine.coordinates.slice();
    const newLine = { ...origLine, coordinates: newCoords };
    console.debug('splitAndShiftSelectedSegment: newLine', newLine);
    await wmeSdk.Editing.doActions(async () => {
      await wmeSdk.DataModel.Segments.updateSegment({ segmentId: segmentId, geometry: newLine });
      const splitPointCoord = { type: "Point", coordinates: splitCoord };
      const splitResult = await wmeSdk.DataModel.Segments.splitSegment({ segmentId: segmentId, geometryIndex: insertIdx + 1, splitPoint: splitPointCoord });
      let segA = null, segB = null;
      let newIds = splitResult && splitResult.newSegmentIds && splitResult.newSegmentIds.length === 2 ? splitResult.newSegmentIds : null;
      if (newIds) {
        segA = wmeSdk.DataModel.Segments.getById({ segmentId: Number(newIds[0]) });
        segB = wmeSdk.DataModel.Segments.getById({ segmentId: Number(newIds[1]) });
      }
      // If IDs not found, try to find the two new segments by geometry
      if (!segA || !segB) {
        // Wait a bit for WME to update the model
        await new Promise(r => setTimeout(r, 300));
        // Find all segments at the split point
        const allSegs = wmeSdk.DataModel.Segments.getAll();
        const isAtSplit = seg => seg.geometry && seg.geometry.type === 'LineString' && seg.geometry.coordinates.some(c => coordsEqual(c, splitCoord));
        const candidates = allSegs.filter(isAtSplit).filter(s => s.id !== segmentId);
        if (candidates.length >= 2) {
          segA = candidates[0];
          segB = candidates[1];
        }
      }
      if (!segA || !segB) {
        alert('Failed to split segment.');
        console.debug('splitAndShiftSelectedSegment: Could not find both split segments', splitResult);
        return;
      }
      // Split the original geometry into two halves
      // Offset the first half to the left, second half to the right, using OpenLayers-style vector math
      let coordsA = newLine.coordinates.slice(0, insertIdx + 2); // start to split
      let coordsB = newLine.coordinates.slice(insertIdx + 1);    // split to end
      // Remove consecutive duplicate points
      function dedupeCoords(arr) {
        return arr.filter((pt, i, a) => i === 0 || !(pt[0] === a[i-1][0] && pt[1] === a[i-1][1]));
      }
      coordsA = dedupeCoords(coordsA);
      coordsB = dedupeCoords(coordsB);
      console.debug('splitAndShiftSelectedSegment: coordsA (deduped)', coordsA);
      console.debug('splitAndShiftSelectedSegment: coordsB (deduped)', coordsB);
      const offsetA = openLayersLegacyOffset(coordsA, -distance/2).left;
      const offsetB = openLayersLegacyOffset(coordsB, distance/2).right;
      console.debug('splitAndShiftSelectedSegment: offsetA', offsetA);
      console.debug('splitAndShiftSelectedSegment: offsetB', offsetB);
      function isValidCoords(arr) {
        return Array.isArray(arr) && arr.length >= 2 && arr.every(pt => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite));
      }
      if (!isValidCoords(offsetA) || !isValidCoords(offsetB)) {
        console.error('Invalid offset geometry:', { offsetA, offsetB, coordsA, coordsB });
        alert('Error: Offset geometry is invalid. See console for details.');
        return;
      }
      await wmeSdk.DataModel.Segments.updateSegment({ segmentId: segA.id, geometry: { type: 'LineString', coordinates: offsetA } });
      await wmeSdk.DataModel.Segments.updateSegment({ segmentId: segB.id, geometry: { type: 'LineString', coordinates: offsetB } });
      console.debug('splitAndShiftSelectedSegment: END');
      alert('Segment split and shifted!');
    }, 'Split and shift segment (OpenLayers-style offset)');
  }

  // --- Multi-segment Split/Shift (optional, can be removed if not needed) ---
  async function splitAndShiftMultipleSegments(distance) {
    const selection = wmeSdk.Editing.getSelection();
    if (!selection || selection.objectType !== 'segment' || selection.ids.length < 1) {
      alert('Please select at least one segment.');
      return;
    }
    if (selection.ids.length > 1 && !confirm('You have selected multiple segments. Continue?')) return;
    const segmentIds = selection.ids.map(Number);
    for (const segmentId of segmentIds) {
      await splitAndShiftSelectedSegment(distance, segmentId);
    }
    alert('All selected segments split and shifted!');
  }
})();
