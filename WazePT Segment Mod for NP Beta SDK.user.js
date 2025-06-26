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
// @version         2025.06.26.2
// ==/UserScript==

/* global W, OpenLayers, require, $, _, WazeWrap, turf, getWmeSdk, initWmeSdkPlus, SDK_INITIALIZED, GM_info, GM_xmlhttpRequest */

(async function () {
  'use strict';
  console.log('[WazePTSegment] Userscript loaded.');

  await SDK_INITIALIZED;
  console.log('[WazePTSegment] SDK_INITIALIZED resolved.');

  const SCRIPT_NAME = GM_info.script.name;
  const SCRIPT_VERSION = GM_info.script.version;
  const wmeSdk = getWmeSdk({ scriptId: 'wme-pt-segment-mod' });

  if (!wmeSdk.State.isInitialized()) {
    await wmeSdk.Events.once({ eventName: 'wme-initialized' });
  }

  initWmeSdkPlus(wmeSdk);
  WazePTSegment_bootstrap();
  console.log('[WazePTSegment] Bootstrap complete.');

  // --- Overlay and Drawing Functions ---
  function drawParallelOverlays(leftLineCoords, rightLineCoords) {
    if (!window.WazePTSegment_OverlayLayer) {
      window.WazePTSegment_OverlayLayer = new OpenLayers.Layer.Vector('WazePTSegment_ParallelOverlay', {
        displayInLayerSwitcher: false,
        uniqueName: "WazePTSegment_ParallelOverlay_v2"
      });
      W.map.addLayer(window.WazePTSegment_OverlayLayer);
      W.map.setLayerIndex(window.WazePTSegment_OverlayLayer, W.map.layers.length - 1);
    }
    const overlayLayer = window.WazePTSegment_OverlayLayer;
    overlayLayer.setVisibility(true);
    overlayLayer.removeAllFeatures();

    function coordsToOL(coords, color) {
      if (!Array.isArray(coords) || coords.length < 2) return null;
      try {
        const olPoints = coords.map(([lon, lat]) => {
          const { x, y } = OpenLayers.Layer.SphericalMercator.forwardMercator(lon, lat);
          return new OpenLayers.Geometry.Point(x, y);
        });
        const olLine = new OpenLayers.Geometry.LineString(olPoints);
        return new OpenLayers.Feature.Vector(olLine, null, {
          strokeColor: color,
          strokeWidth: 5,
          strokeOpacity: 0.7
        });
      } catch (e) {
        console.error('[WazePTSegment] Error creating overlay feature:', e);
        return null;
      }
    }

    const leftOverlay = coordsToOL(leftLineCoords, '#00ff00'); // Green for left
    const rightOverlay = coordsToOL(rightLineCoords, '#ff0000'); // Red for right
    overlayLayer.addFeatures([leftOverlay, rightOverlay].filter(Boolean));
  }

  function clearParallelOverlays() {
    if (window.WazePTSegment_OverlayLayer) {
      window.WazePTSegment_OverlayLayer.removeAllFeatures();
      window.WazePTSegment_OverlayLayer.setVisibility(false);
    }
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
        "https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta.user.js",
        GM_xmlhttpRequest,
      ).start();
    } catch (ex) {
      console.log(ex.message);
    }

    function addWMESelectSegmentbutton() {
      $('#split-segment').remove();
      clearParallelOverlays();
      if (!wmeSdk.Editing.getSelection()) return;
      if (document.getElementById('split-segment')) return;

      let segmentSelection = wmeSdk.Editing.getSelection();
      if (!segmentSelection || segmentSelection.objectType !== 'segment') return;

      let exit = false;
      const pedonal_id = [5, 10, 16];
      segmentSelection.ids.forEach(segmentId => {
        const seg = wmeSdk.DataModel.Segments.getById({ segmentId });
        if (!seg) return;
        if ((seg.fwdLaneCount && seg.fwdLaneCount !== 0) || (seg.revLaneCount && seg.revLaneCount !== 0)) exit = true;
        if (seg.fwdDirection === false || seg.revDirection === false) exit = true;
        if (pedonal_id.includes(seg.roadType)) exit = true;
      });

      if (!exit) {
        const selSegmentsDistance = $('<wz-select id="segmentsDistance" data-type="numeric" value="5" style="width: 45%;float:left;" />');
        [5, 7, 9, 10, 11, 13, 14, 15, 17, 19, 21, 23, 25, 37].forEach(val => {
          selSegmentsDistance.append($(`<wz-option value="${val}">${val} m</wz-option>`));
        });
        const btn1 = $('<wz-button color="secondary" size="sm" style="float:right;margin-top: 5px;">Split Segment</wz-button>');

        btn1.click(() => {
          const dist = parseFloat(selSegmentsDistance.val());
          splitAndShiftSelectedSegment(dist);
        });

        const cnt = $('<div id="split-segment" class="form-group" style="display: flex;" />');
        const divGroup1 = $('<div/>');
        divGroup1.append($('<wz-label>Distance between the two parallel segments:</wz-label>'));
        divGroup1.append(selSegmentsDistance);
        divGroup1.append(btn1);
        cnt.append(divGroup1);

        const $panel = $('#segment-edit-general');
        const $attrForm = $panel.find('.attributes-form');
        if ($attrForm.length) cnt.insertAfter($attrForm);
        else if ($panel.length) $panel.append(cnt);
        else {
          setTimeout(addWMESelectSegmentbutton, 250);
          return;
        }

        const storedDist = localStorage.getItem('metersSplitSegment') || '5';
        selSegmentsDistance.val(storedDist);

        function handlePreview() {
            const seg = wmeSdk.Editing.getSelection()?.objects?.[0];
            if (seg) {
                const dist = parseFloat(selSegmentsDistance.val());
                const { left, right } = openLayersLegacyOffset(seg.geometry.coordinates, dist / 2);
                drawParallelOverlays(left, right);
            }
        }

        selSegmentsDistance.on('wz-change', function () {
          localStorage.setItem('metersSplitSegment', $(this).val());
          handlePreview();
        });

        // Initial preview
        handlePreview();
      }
    }

    wmeSdk.Events.on({
      eventName: 'wme-selection-changed',
      eventHandler: addWMESelectSegmentbutton
    });
    if (wmeSdk.Editing.getSelection()?.objectType === 'segment') {
      addWMESelectSegmentbutton();
    }
  }


  // --- Core Geometry Logic ---

  /**
   * Replicates the precise geometry offset calculation from the legacy OpenLayers-based script.
   * @param {number[][]} coords - An array of [lon, lat] coordinates for the line.
   * @param {number} offsetMeters - The distance to offset (e.g., distance / 2).
   * @returns {{left: number[][], right: number[][]}} The calculated left and right offset coordinates.
   */
  function openLayersLegacyOffset(coords, offsetMeters) {
    if (coords.length < 2) return { left: [], right: [] };

    // Helper functions for coordinate conversion and math
    function toMercator(c) { return OpenLayers.Layer.SphericalMercator.forwardMercator(c[0], c[1]); }
    function toLonLat(p) { return OpenLayers.Layer.SphericalMercator.inverseMercator(p[0], p[1]); }
    function resize(point, center, scale) { return [center[0] + (point[0] - center[0]) * scale, center[1] + (point[1] - center[1]) * scale]; }
    function rotate(point, center, angleDeg) {
      const angleRad = angleDeg * Math.PI / 180, s = Math.sin(angleRad), c = Math.cos(angleRad);
      const px = point[0] - center[0], py = point[1] - center[1];
      return [px * c - py * s + center[0], px * s + py * c + center[1]];
    }
    function getEq(p1, p2) {
      if (Math.abs(p1[0] - p2[0]) < 1e-9) return { x: p1[0] };
      const slope = (p2[1] - p1[1]) / (p2[0] - p1[0]);
      return { slope, offset: p1[1] - slope * p1[0] };
    }
    function intersect(eq1, eq2) {
      if ("slope" in eq1 && "slope" in eq2) {
        if (Math.abs(eq1.slope - eq2.slope) < 1e-9) return null;
        const x = (eq2.offset - eq1.offset) / (eq1.slope - eq2.slope);
        return [x, eq1.slope * x + eq1.offset];
      } else if ("x" in eq1) { return "x" in eq2 ? null : [eq1.x, eq2.slope * eq1.x + eq2.offset];
      } else if ("x" in eq2) { return [eq2.x, eq1.slope * eq2.x + eq1.offset]; }
      return null;
    }

    const mercCoords = coords.map(toMercator);
    let leftPoints = [], rightPoints = [], prevLeftEq = null, prevRightEq = null;

    for (let i = 0; i < mercCoords.length - 1; i++) {
      const pa = mercCoords[i], pb = mercCoords[i + 1];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const scale = (len + offsetMeters) / len;

      let leftPa_temp = rotate(resize(pa, pb, scale), pa, 90);
      let rightPa_temp = rotate(resize(pa, pb, scale), pa, -90);
      let leftPb_temp = rotate(resize(pb, pa, scale), pb, -90);
      let rightPb_temp = rotate(resize(pb, pa, scale), pb, 90);

      const leftEq = getEq(leftPa_temp, leftPb_temp);
      const rightEq = getEq(rightPa_temp, rightPb_temp);

      if (i === 0) {
        leftPoints.push(leftPa_temp);
        rightPoints.push(rightPa_temp);
      } else {
        leftPoints.push(intersect(leftEq, prevLeftEq) || leftPa_temp);
        rightPoints.push(intersect(rightEq, prevRightEq) || rightPa_temp);
      }

      prevLeftEq = leftEq;
      prevRightEq = rightEq;

      if (i === mercCoords.length - 2) {
        leftPoints.push(leftPb_temp);
        rightPoints.push(rightPb_temp);
      }
    }
    function finalize(points) {
        return points
            .filter((p, i, arr) => i === 0 || Math.abs(p[0] - arr[i-1][0]) > 1e-9 || Math.abs(p[1] - arr[i-1][1]) > 1e-9)
            .map(toLonLat);
    }
    return { left: finalize(leftPoints), right: finalize(rightPoints) };
  }

  /**
   * Main function to split a selected segment and shift the resulting parts.
   * @param {number} distance - The total distance between the new parallel segments.
   */
  async function splitAndShiftSelectedSegment(distance) {
    const selection = wmeSdk.Editing.getSelection();
    if (!selection || selection.objectType !== 'segment' || selection.ids.length !== 1) {
      alert('Please select a single road segment to use this function.');
      return;
    }

    const segmentId = Number(selection.ids[0]);
    const segori = wmeSdk.DataModel.Segments.getById({ segmentId });
    if (!segori || segori.geometry.type !== 'LineString') {
      alert('Could not retrieve valid segment data. Please try again.');
      return;
    }

    // 1. Calculate final geometries before touching the map
    const offsetGeometries = openLayersLegacyOffset(segori.geometry.coordinates, distance / 2);
    if (offsetGeometries.left.length < 2 || offsetGeometries.right.length < 2) {
      alert('Failed to calculate offset geometries. The operation was cancelled.');
      console.error('[WazePTSegment] Offset calculation resulted in invalid geometry.');
      return;
    }
    const leftCoords = offsetGeometries.left;
    const rightCoords = offsetGeometries.right;
    drawParallelOverlays(leftCoords, rightCoords);

    // 2. Perform all WME actions within a single transaction
    await wmeSdk.Editing.doActions(async () => {
      // Find a point to split the segment (midpoint is reliable)
      const origLine = segori.geometry;
      const midPoint = turf.along(origLine, turf.length(origLine) / 2, { units: 'meters' });
      const splitCoord = midPoint.geometry.coordinates;

      // Split the segment. This deletes the original and returns two new segment IDs.
      const splitResult = await wmeSdk.DataModel.Segments.splitSegmentAtPoint({
        segmentId: segmentId,
        lon: splitCoord[0],
        lat: splitCoord[1],
      });

      if (!splitResult || !splitResult.newSegmentIds || splitResult.newSegmentIds.length < 2) {
        throw new Error('Segment splitting failed on the server. The action has been rolled back.');
      }

      const [id1, id2] = splitResult.newSegmentIds;

      // Update the two new segments with the pre-calculated parallel geometries.
      // One becomes the left road (B->A), the other the right road (A->B).
      // Note: LHD countries might want fwdDirection=true for left, revDirection=true for right.
      // This implementation matches the original script's logic for RHD.
      await wmeSdk.DataModel.Segments.updateSegment({
        segmentId: id1,
        geometry: { type: 'LineString', coordinates: leftCoords },
        fwdDirection: false, // Set to one-way, B->A
      });
      await wmeSdk.DataModel.Segments.updateSegment({
        segmentId: id2,
        geometry: { type: 'LineString', coordinates: rightCoords },
        revDirection: false, // Set to one-way, A->B
      });
    }, 'Split and shift segment (legacy offset)')
      .then(() => {
        alert('Segment split and shifted successfully!');
        clearParallelOverlays();
      })
      .catch((err) => {
        alert(`An error occurred: ${err.message}`);
        console.error('[WazePTSegment] Action failed:', err);
      });
  }
})();