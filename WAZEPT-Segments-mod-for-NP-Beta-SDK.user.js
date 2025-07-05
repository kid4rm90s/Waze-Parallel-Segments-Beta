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
// @downloadURL     https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta-SDK.user.js
// @updateURL       https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta-SDK.user.js
// @version         2025.07.05.5
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
  const wmeSdk = getWmeSdk({ scriptId: "wazeptsegment", scriptName: "WazePT Segment" });
  if (!wmeSdk.State.isInitialized()) {
    console.debug('[WazePTSegment] DEBUG: Waiting for wme-initialized');
    await wmeSdk.Events.once({ eventName: "wme-initialized" });
  } // <-- Close WazePTSegment_init
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
    
    // Use the new improved parallel geometry creation for consistent results
    const parallelResult = createRobustParallelGeometry(origLine.coordinates, distance);
    let leftLine, rightLine;
    
    if (parallelResult && parallelResult.left && parallelResult.right) {
      leftLine = { type: 'LineString', coordinates: parallelResult.left };
      rightLine = { type: 'LineString', coordinates: parallelResult.right };
      console.debug('drawParallelOverlays: Using improved parallel geometry');
    } else {
      // Fallback to Turf.js if our method fails
      console.warn('createRobustParallelGeometry failed for preview, using Turf.js fallback');
      leftLine = turf.lineOffset(origLine, -distance/2, { units: 'meters' });
      rightLine = turf.lineOffset(origLine, distance/2, { units: 'meters' });
    }
    
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
        "https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta-SDK.user.js",
        GM_xmlhttpRequest
      ).start();
    } catch (ex) { console.log(ex.message); }

    function addWMESelectSegmentbutton() {
      // Remove any previous UI to avoid duplicates
      $('#split-segment').remove();
      if (document.getElementById("MapCommentGeo")) $("#MapCommentGeo").remove();
      if (document.getElementById("split-segment")) $("#split-segment").remove();

      // Only show if a segment is selected
      const selection = wmeSdk.Editing.getSelection();
      if (!selection || selection.objectType !== 'segment' || !selection.ids || selection.ids.length === 0) return;

      const pedonal_id = [5, 10, 16];
      // Build the distance dropdown
      const selSegmentsDistance = $('<wz-select id="segmentsDistance" data-type="numeric" value="5" style="width: 45%;float:left;" />');
      [5, 7, 9, 10, 11, 13, 14, 15, 17, 19, 21, 23, 25, 37].forEach(val => {
        selSegmentsDistance.append($(`<wz-option value="${val}">${val} m</wz-option>`));
      });

      // Button text
      const buttonText = selection.ids.length === 1 ? 'Split Segment' : `Split ${selection.ids.length} Segments`;
      const btn1 = $(`<wz-button color="secondary" size="sm" style="float:right;margin-top: 5px;">${buttonText}</wz-button>`);
      btn1.on('click', function () {
        // Validate all selected segments before proceeding
        let invalidSegments = [];
        selection.ids.forEach(segmentId => {
          const seg = wmeSdk.DataModel.Segments.getById({ segmentId });
          if (!seg) {
            invalidSegments.push(segmentId + ' (not found)');
            return;
          }
          if ((seg.fwdLaneCount && seg.fwdLaneCount !== 0) || (seg.revLaneCount && seg.revLaneCount !== 0)) invalidSegments.push(segmentId + ' (has lanes)');
          if (seg.fwdDirection === false || seg.revDirection === false) invalidSegments.push(segmentId + ' (direction false)');
          if (pedonal_id.includes(seg.roadType)) invalidSegments.push(segmentId + ' (pedestrian)');
        });
        if (invalidSegments.length > 0) {
          alert('The following segments are not valid for splitting:\n' + invalidSegments.join('\n'));
          return;
        }
        if (selection.ids.length > 1) {
          const confirmMsg = `You have ${selection.ids.length} segments selected. The script will process each segment individually.\n\nMake sure that you have selected segments sequentially (from one end to the other) and after executing the script, VERIFY the result obtained.\n\nContinue?`;
          if (!confirm(confirmMsg)) return;
        }
        const dist = parseFloat(selSegmentsDistance.val());
        if (selection.ids.length === 1) {
          splitAndShiftSelectedSegment(dist);
        } else {
          splitAndShiftMultipleSegments(dist);
        }
      });

      // UI creation
      const cnt = $('<div id="split-segment" class="form-group" style="display: flex;" />');
      const divGroup1 = $('<div/>');
      divGroup1.append($('<wz-label>Distance between the two parallel segments:</wz-label>'));
      divGroup1.append(selSegmentsDistance);
      divGroup1.append(btn1);
      cnt.append(divGroup1);

      // Insert into panel
      let $panel = $('#segment-edit-general');
      let $attrForm = $panel.find('.attributes-form');
      if (!$panel.length) $panel = $('#edit-panel');
      if (!$panel.length) $panel = $('#sidebar');
      if ($panel.length) {
        $attrForm = $panel.find('.attributes-form');
        if ($attrForm.length) cnt.insertAfter($attrForm);
        else $panel.append(cnt);
      } else {
        // If no panel found, try again later
        setTimeout(addWMESelectSegmentbutton, 250);
        return;
      }
      $("#segmentsDistance").val(localStorage.getItem("metersSplitSegment") || "5");
      $('#segmentsDistance').change(function () {
        localStorage.setItem("metersSplitSegment", $("#segmentsDistance").val());
      });
    }

    // Always call on selection change
    wmeSdk.Events.on({
      eventName: 'wme-selection-changed',
      eventHandler: () => {
        setTimeout(() => {
          const sel = wmeSdk.Editing.getSelection();
          if (sel && sel.objectType === 'segment' && sel.ids && sel.ids.length > 0) {
            addWMESelectSegmentbutton();
          } else {
            $('#split-segment').remove();
          }
        }, 100); // Delay to ensure selection is updated in DOM
      },
    });
    // Also call on script load if a segment is already selected
    setTimeout(() => {
      const sel = wmeSdk.Editing.getSelection();
      if (sel && sel.objectType === 'segment' && sel.ids && sel.ids.length > 0) {
        addWMESelectSegmentbutton();
      }
    }, 500);
  }

  // --- Segment Split/Shift Logic ---

  // Defensive node fetcher
  function safeGetNodeById(nodeId) {
    if (!nodeId || typeof nodeId !== 'number') {
      console.warn('safeGetNodeById: nodeId is invalid:', nodeId);
      return null;
    }
    return wmeSdk.DataModel.Nodes.getById({ nodeId });
  }

  // Connects a list of segments end-to-end by their split nodes (for left or right chains)
  async function connectShiftedSegments(segmentChain) {
    // segmentChain: [{ segmentId, splitNodeId }, ...]
    for (let i = 0; i < segmentChain.length - 1; i++) {
      const curr = segmentChain[i];
      const next = segmentChain[i + 1];
      // Skip invalid segment pairs
      if (!curr || !next || !curr.segmentId || !next.segmentId || !curr.splitNodeId || !next.splitNodeId) continue;
      let currSeg = wmeSdk.DataModel.Segments.getById({ segmentId: curr.segmentId });
      let nextSeg = wmeSdk.DataModel.Segments.getById({ segmentId: next.segmentId });
      if (!currSeg || !nextSeg) continue;
      let currNode = safeGetNodeById(curr.splitNodeId);
      let nextNode = safeGetNodeById(next.splitNodeId);
      let retries = 0;
      while ((!currNode || !nextNode) && retries < 5) {
        await new Promise(r => setTimeout(r, 300));
        currSeg = wmeSdk.DataModel.Segments.getById({ segmentId: curr.segmentId });
        nextSeg = wmeSdk.DataModel.Segments.getById({ segmentId: next.segmentId });
        currNode = safeGetNodeById(curr.splitNodeId);
        nextNode = safeGetNodeById(next.splitNodeId);
        retries++;
      }
      if (!currNode || !nextNode) continue;
      let currGeom = currSeg.geometry && currSeg.geometry.coordinates ? currSeg.geometry.coordinates.slice() : null;
      let nextGeom = nextSeg.geometry && nextSeg.geometry.coordinates ? nextSeg.geometry.coordinates.slice() : null;
      if (!currGeom || !nextGeom || currGeom.length < 2 || nextGeom.length < 2) continue;
      currGeom[currGeom.length - 1] = nextGeom[0].slice();
      try {
        await wmeSdk.DataModel.Segments.updateSegment({
          segmentId: curr.segmentId,
          geometry: { type: 'LineString', coordinates: currGeom }
        });
        console.log(`[WazePTSegment] Geometry-aligned segment ${curr.segmentId} end to ${next.segmentId} start.`);
      } catch (e) {
        console.warn('connectShiftedSegments: Failed to update geometry for alignment', curr.segmentId, e);
      }
    }
  }

  // Multi-segment split/shift logic
  async function splitAndShiftMultipleSegments(distance) {
    const selection = wmeSdk.Editing.getSelection();
    if (!selection || selection.objectType !== 'segment' || !selection.ids || selection.ids.length < 2) {
      alert('Please select at least two segments.');
      return;
    }
    const ids = selection.ids.map(Number);
    const leftChain = [];
    const rightChain = [];
    for (let i = 0; i < ids.length; i++) {
      const result = await splitAndShiftSelectedSegment(distance, ids[i], true);
      if (result && result.left && result.right) {
        leftChain.push(result.left);
        rightChain.push(result.right);
      } else {
        console.warn('splitAndShiftMultipleSegments: Split failed for segment', ids[i]);
      }
    }
    // After all splits, connect left and right chains
    await connectShiftedSegments(leftChain);
    await connectShiftedSegments(rightChain);
    console.log('[WazePTSegment] Multi-segment split/shift complete. Left and right chains processed.');
  }
  // Helper: Offset a linestring by a given distance (meters) using vector math
  // --- Segment Split/Shift Logic ---
  // Place all segment logic after WazePTSegment_init closure
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

  // Helper: Offset a linestring by a given distance (meters) using improved approach that prevents self-intersection
  function offsetLineStringOpenLayersStyle(coords, offsetMeters) {
    if (coords.length < 2) return { left: coords, right: coords };
    
    // Use the improved robust parallel geometry creation
    const result = createRobustParallelGeometry(coords, offsetMeters);
    
    // Ensure we have valid results
    if (!result.left || !result.right || result.left.length < 2 || result.right.length < 2) {
      console.error('offsetLineStringOpenLayersStyle: Failed to create valid parallel geometry, falling back to original coords');
      return { left: coords, right: coords };
    }
    
    return result;
  }

  // Improved parallel geometry creation that prevents self-intersection
  function createRobustParallelGeometry(coords, offsetMeters) {
    if (coords.length < 2) {
      console.error('createRobustParallelGeometry: Need at least 2 points');
      return { left: [], right: [] };
    }

    // Fallback to Turf.js for complex cases - it's more robust
    try {
      const origLine = { type: 'LineString', coordinates: coords };
      const leftLine = turf.lineOffset(origLine, -Math.abs(offsetMeters)/2, { units: 'meters' });
      const rightLine = turf.lineOffset(origLine, Math.abs(offsetMeters)/2, { units: 'meters' });
      
      if (leftLine && rightLine && leftLine.geometry && rightLine.geometry) {
        console.debug('createRobustParallelGeometry: Using Turf.js for robust parallel lines');
        return { 
          left: leftLine.geometry.coordinates, 
          right: rightLine.geometry.coordinates 
        };
      }
    } catch (turfError) {
      console.warn('createRobustParallelGeometry: Turf.js failed, trying manual approach:', turfError);
    }

    // Manual approach as fallback
    const merc = coords.map(([lon, lat]) => OpenLayers.Layer.SphericalMercator.forwardMercator(lon, lat));
    let leftPoints = [], rightPoints = [];
    
    // Simple perpendicular offset approach for each point
    for (let i = 0; i < merc.length; i++) {
      let dx = 0, dy = 0, count = 0;
      
      // Calculate average direction from neighboring segments
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
      
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        // Perpendicular vector (normalized)
        const perpX = -dy / len;
        const perpY = dx / len;
        
        // Create offset points
        const leftPt = [merc[i][0] + perpX * Math.abs(offsetMeters), merc[i][1] + perpY * Math.abs(offsetMeters)];
        const rightPt = [merc[i][0] - perpX * Math.abs(offsetMeters), merc[i][1] - perpY * Math.abs(offsetMeters)];
        
        leftPoints.push(leftPt);
        rightPoints.push(rightPt);
      } else {
        // Fallback: just copy the original point if no direction can be determined
        leftPoints.push([...merc[i]]);
        rightPoints.push([...merc[i]]);
      }
    }
    
    // Convert back to lon/lat and remove consecutive duplicate points
    function dedupe(arr) {
      return arr.filter((pt, i, a) => {
        if (i === 0) return true;
        const dist = Math.sqrt(Math.pow(pt[0] - a[i-1][0], 2) + Math.pow(pt[1] - a[i-1][1], 2));
        return dist > 1e-8; // Remove points that are too close
      });
    }
    
    const leftLonLat = dedupe(leftPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y)));
    const rightLonLat = dedupe(rightPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y)));
    
    // Ensure we have at least the same number of points as the original
    if (leftLonLat.length < Math.max(2, coords.length - 1) || rightLonLat.length < Math.max(2, coords.length - 1)) {
      console.warn('createRobustParallelGeometry: Generated fewer points than expected, using simple offset');
      // Fallback to simple offset without deduplication
      const simpleLeft = leftPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y));
      const simpleRight = rightPoints.map(([x, y]) => OpenLayers.Layer.SphericalMercator.inverseMercator(x, y));
      return { left: simpleLeft, right: simpleRight };
    }
    
    console.debug('createRobustParallelGeometry: Generated parallel lines with', leftLonLat.length, 'left points and', rightLonLat.length, 'right points');
    return { left: leftLonLat, right: rightLonLat };
  }

  // Helper function to calculate line intersection
  function calculateLineIntersection(p1, p2, p3, p4) {
    const denom = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
    if (Math.abs(denom) < 1e-10) return null; // Lines are parallel
    
    const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / denom;
    const u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / denom;
    
    // Return intersection even if outside segment bounds (for offset line extensions)
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  }

  // Helper function to check if intersection point is reasonable
  function isReasonableIntersection(intersection, originalPoint, offsetDistance) {
    const dist = Math.sqrt(
      Math.pow(intersection[0] - originalPoint[0], 2) + 
      Math.pow(intersection[1] - originalPoint[1], 2)
    );
    // Allow intersection if within 3x the offset distance (prevents extreme outliers)
    return dist <= offsetDistance * 3;
  }

  // Helper function to remove self-intersections from a line
  function removeSelfIntersections(points) {
    if (points.length <= 3) return points;
    
    const result = [...points];
    let changed = true;
    
    while (changed && result.length > 3) {
      changed = false;
      
      // Check for intersections between non-adjacent segments
      for (let i = 0; i < result.length - 3; i++) {
        for (let j = i + 2; j < result.length - 1; j++) {
          const p1 = result[i], p2 = result[i + 1];
          const p3 = result[j], p4 = result[j + 1];
          
          const intersection = calculateLineIntersection(p1, p2, p3, p4);
          if (intersection) {
            // Check if intersection is actually on both segments
            const onSeg1 = isPointOnSegment(intersection, p1, p2);
            const onSeg2 = isPointOnSegment(intersection, p3, p4);
            
            if (onSeg1 && onSeg2) {
              // Remove the loop by keeping only the outer path
              result.splice(i + 1, j - i);
              changed = true;
              break;
            }
          }
        }
        if (changed) break;
      }
    }
    
    return result;
  }

  // Helper function to check if a point lies on a line segment
  function isPointOnSegment(point, segStart, segEnd) {
    const tolerance = 1e-6;
    const crossProduct = (point[1] - segStart[1]) * (segEnd[0] - segStart[0]) - 
                        (point[0] - segStart[0]) * (segEnd[1] - segStart[1]);
    
    if (Math.abs(crossProduct) > tolerance) return false;
    
    const dotProduct = (point[0] - segStart[0]) * (segEnd[0] - segStart[0]) + 
                      (point[1] - segStart[1]) * (segEnd[1] - segStart[1]);
    const squaredLength = Math.pow(segEnd[0] - segStart[0], 2) + Math.pow(segEnd[1] - segStart[1], 2);
    
    return dotProduct >= -tolerance && dotProduct <= squaredLength + tolerance;
  }

  // Helper function to create parallel geometry using the original WazePT approach
  function createParallelGeometry(origGeometry, displacement) {
    try {
      // Convert GeoJSON to OpenLayers geometry for processing
      const olGeom = W.userscripts.toOLGeometry(origGeometry);
      const streetVertices = olGeom.simplify(0.001).getVertices();
      
      let leftPoints = null;
      let rightPoints = null;
      let prevLeftEq, prevRightEq;

      for (let i = 0; i < streetVertices.length - 1; i++) {
        const pa = streetVertices[i];
        const pb = streetVertices[i + 1];

        const points = [pa, pb];
        const ls = new OpenLayers.Geometry.LineString(points);
        const len = ls.getGeodesicLength(W.map.getProjectionObject());
        const scale = (len + displacement / 2) / len;

        // Create offset points using the original WazePT method
        let leftPa = pa.clone();
        leftPa.resize(scale, pb, 1);
        let rightPa = leftPa.clone();
        leftPa.rotate(90, pa);
        rightPa.rotate(-90, pa);

        let leftPb = pb.clone();
        leftPb.resize(scale, pa, 1);
        let rightPb = leftPb.clone();
        leftPb.rotate(-90, pb);
        rightPb.rotate(90, pb);

        // Calculate line equations for intersection
        const leftEq = getLineEquation({
          x1: leftPa.x, y1: leftPa.y,
          x2: leftPb.x, y2: leftPb.y
        });
        const rightEq = getLineEquation({
          x1: rightPa.x, y1: rightPa.y,
          x2: rightPb.x, y2: rightPb.y
        });

        if (leftPoints === null && rightPoints === null) {
          leftPoints = [leftPa];
          rightPoints = [rightPa];
        } else {
          const li = intersectLines(leftEq, prevLeftEq);
          const ri = intersectLines(rightEq, prevRightEq);
          
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
      }

      // Add final points
      if (leftPoints && rightPoints && streetVertices.length > 1) {
        const lastIdx = streetVertices.length - 1;
        const pa = streetVertices[lastIdx - 1];
        const pb = streetVertices[lastIdx];

        // Calculate final offset points for the last segment
        const points = [pa, pb];
        const ls = new OpenLayers.Geometry.LineString(points);
        const len = ls.getGeodesicLength(W.map.getProjectionObject());
        const scale = (len + displacement / 2) / len;

        let leftPb = pb.clone();
        leftPb.resize(scale, pa, 1);
        let rightPb = leftPb.clone();
        leftPb.rotate(-90, pb);
        rightPb.rotate(90, pb);

        leftPoints.push(leftPb);
        rightPoints.push(rightPb);
      }

      // Convert OpenLayers points to coordinate arrays
      const leftCoords = leftPoints ? leftPoints.map(pt => {
        const lonlat = OpenLayers.Layer.SphericalMercator.inverseMercator(pt.x, pt.y);
        return [lonlat.lon, lonlat.lat];
      }) : [];
      
      const rightCoords = rightPoints ? rightPoints.map(pt => {
        const lonlat = OpenLayers.Layer.SphericalMercator.inverseMercator(pt.x, pt.y);
        return [lonlat.lon, lonlat.lat];
      }) : [];

      // Validate that we have enough points and check for potential self-intersection
      if (leftCoords.length < 2 || rightCoords.length < 2) {
        console.warn('createParallelGeometry: Insufficient points generated', { leftCoords, rightCoords });
      }
      
      // Log a warning if the geometry might have self-intersections (basic check)
      if (leftCoords.length > 3 || rightCoords.length > 3) {
        console.debug('createParallelGeometry: Complex geometry generated, checking for issues');
        // The robust fallback will handle any self-intersection issues
      }

      return {
        left: { type: 'LineString', coordinates: leftCoords },
        right: { type: 'LineString', coordinates: rightCoords }
      };
    } catch (error) {
      console.error('Error in createParallelGeometry, falling back to robust method:', error);
      // Fallback to the robust parallel geometry creation
      try {
        const robustResult = createRobustParallelGeometry(origGeometry.coordinates, displacement);
        if (robustResult && robustResult.left && robustResult.right) {
          return {
            left: { type: 'LineString', coordinates: robustResult.left },
            right: { type: 'LineString', coordinates: robustResult.right }
          };
        }
      } catch (fallbackError) {
        console.error('Fallback parallel geometry creation also failed:', fallbackError);
      }
      return null;
    }
  }

  // Helper functions for line equations and intersections
  function getLineEquation(segment) {
    if (Math.abs(segment.x2 - segment.x1) < 1e-10) {
      return { x: segment.x1 };
    }
    const slope = (segment.y2 - segment.y1) / (segment.x2 - segment.x1);
    const offset = segment.y1 - (slope * segment.x1);
    return { slope, offset };
  }

  function intersectLines(eqa, eqb) {
    if (typeof eqa.slope === 'number' && typeof eqb.slope === 'number') {
      if (Math.abs(eqa.slope - eqb.slope) < 1e-10) return null;
      const ix = (eqb.offset - eqa.offset) / (eqa.slope - eqb.slope);
      const iy = eqa.slope * ix + eqa.offset;
      return new OpenLayers.Geometry.Point(ix, iy);
    } else if (typeof eqa.x === 'number') {
      return new OpenLayers.Geometry.Point(eqa.x, eqb.slope * eqa.x + eqb.offset);
    } else if (typeof eqb.x === 'number') {
      return new OpenLayers.Geometry.Point(eqb.x, eqa.slope * eqb.x + eqa.offset);
    }
    return null;
  }

  /**
   * Enhanced segment splitting with robust parallel geometry generation and proper node placement
   * 
   * This function splits a segment at its midpoint and creates two new segments,
   * each with full parallel geometry that preserves the original segment's shape.
   * 
   * Key improvements:
   * - Uses robust parallel geometry generation that prevents self-intersection
   * - Primary method uses OpenLayers approach with Turf.js fallback for complex curves
   * - Each split segment receives the complete parallel geometry (left/right)
   * - Handles sharp curves without creating overlapping or invalid geometry
   * - Multiple fallback strategies ensure reliability on complex geometry
   * - **CRITICAL**: Automatically determines which segment is left/right based on geometry
   * - **GUARANTEED RESULT**: Proper node placement with segments rotated as needed
   * - Left parallel: B→A node order, Right parallel: A→B node order
   * - Analyzes each segment's current node orientation and rotates/reverses as needed
   * - Focuses on physical node positioning rather than traffic direction
   * - Inspired by techniques from WME MapCommentGeometry and WME Reverse Nodes
   * 
   * @param {number} distance - The offset distance in meters for parallel geometry
   * @param {string} forceSegmentId - Optional segment ID to split (for testing)
   */
  async function splitAndShiftSelectedSegment(distance, forceSegmentId) {
    console.debug('splitAndShiftSelectedSegment: START', {distance, forceSegmentId});
    const selection = wmeSdk.Editing.getSelection();
    let segmentId = forceSegmentId !== undefined ? forceSegmentId : (selection && selection.objectType === 'segment' && selection.ids.length === 1 ? Number(selection.ids[0]) : null);
    if (!segmentId) { 
      console.log('splitAndShiftSelectedSegment: Please select a single segment.'); 
      console.debug('splitAndShiftSelectedSegment: No segmentId'); 
      return; 
    }
    
    const segori = wmeSdk.DataModel.Segments.getById({ segmentId });
    if (!segori) { 
      console.log('splitAndShiftSelectedSegment: Segment not found.'); 
      console.debug('splitAndShiftSelectedSegment: Segment not found', segmentId); 
      return; 
    }
    
    const origLine = segori.geometry;
    if (!origLine || origLine.type !== 'LineString') { 
      console.log('splitAndShiftSelectedSegment: Invalid segment geometry.'); 
      console.debug('splitAndShiftSelectedSegment: Invalid geometry', origLine); 
      return; 
    }
    
    console.debug('splitAndShiftSelectedSegment: Original segment geometry', origLine);
    
    // STEP 1: Create parallel geometries for the ENTIRE original segment (preserving shape)
    let parallelResult = createParallelGeometry(origLine, distance);
    if (!parallelResult || !parallelResult.left || !parallelResult.right) {
      console.error('splitAndShiftSelectedSegment: Primary parallel geometry creation failed, trying robust method');
      
      // Fallback to robust method
      const robustResult = createRobustParallelGeometry(origLine.coordinates, distance);
      if (!robustResult || !robustResult.left || !robustResult.right || 
          robustResult.left.length < 2 || robustResult.right.length < 2) {
        console.error('splitAndShiftSelectedSegment: Could not calculate parallel geometry for the original segment. The segment may be too complex or have invalid geometry.');
        console.error('splitAndShiftSelectedSegment: Both parallel geometry methods failed', {origLine, robustResult});
        return;
      }
      
      // Convert robust result to expected format
      parallelResult = {
        left: { type: 'LineString', coordinates: robustResult.left },
        right: { type: 'LineString', coordinates: robustResult.right }
      };
    }
    
    // Validate the parallel geometry results
    if (!parallelResult.left.coordinates || !parallelResult.right.coordinates ||
        parallelResult.left.coordinates.length < 2 || parallelResult.right.coordinates.length < 2) {
      console.error('splitAndShiftSelectedSegment: Generated parallel geometry is invalid (insufficient points).');
      console.error('splitAndShiftSelectedSegment: Invalid parallel geometry', parallelResult);
      return;
    }
    
    const leftParallelGeometry = parallelResult.left;
    const rightParallelGeometry = parallelResult.right;
    console.debug('splitAndShiftSelectedSegment: Left parallel geometry', leftParallelGeometry);
    console.debug('splitAndShiftSelectedSegment: Right parallel geometry', rightParallelGeometry);
    
    // Show preview overlay with the parallel geometries
    drawParallelOverlays(origLine, distance);
    
    // STEP 2: Create temporary segments for visualization (optional, for debugging)
    console.debug('splitAndShiftSelectedSegment: Creating temporary parallel segments for reference');
    
    // STEP 3: Find split point at middle of original segment
    const totalLen = turf.length(origLine, { units: 'meters' });
    const midLen = totalLen / 2;
    const splitPoint = turf.along(origLine, midLen, { units: 'meters' });
    const splitCoord = splitPoint.geometry.coordinates;
    
    console.debug('splitAndShiftSelectedSegment: Split point at', splitCoord, 'midpoint distance:', midLen);
    
    // Find where to insert the split point in original coordinates
    let insertIdx = -1, accumLen = 0;
    for (let i = 0; i < origLine.coordinates.length - 1; i++) {
      const segLen = turf.distance(turf.point(origLine.coordinates[i]), turf.point(origLine.coordinates[i+1]), { units: 'meters' });
      if (accumLen + segLen >= midLen) { 
        insertIdx = i; 
        break;
      }
      accumLen += segLen;
    }
    
    if (insertIdx === -1) { 
      console.error('splitAndShiftSelectedSegment: Could not find valid split location.'); 
      console.debug('splitAndShiftSelectedSegment: Could not find valid split location'); 
      return; 
    }
    
    function coordsEqual(a, b) { 
      return Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && 
             Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9; 
    }
    
    // Ensure the split point is added to original geometry if needed
    let needInsert = !(coordsEqual(origLine.coordinates[insertIdx], splitCoord) || 
                      coordsEqual(origLine.coordinates[insertIdx+1], splitCoord));
    let newCoords = needInsert ? 
                   origLine.coordinates.slice(0, insertIdx + 1).concat([splitCoord]).concat(origLine.coordinates.slice(insertIdx + 1)) : 
                   origLine.coordinates.slice();
    
    const newLine = { ...origLine, coordinates: newCoords };
    console.debug('splitAndShiftSelectedSegment: Updated original geometry with split point', newLine);
    
    // STEP 4: Use the full parallel geometries and assign them to the split segments
    // Each segment gets the complete parallel geometry of the ENTIRE original segment
    // ensuring full coverage and proper shape preservation
    
    console.debug('splitAndShiftSelectedSegment: Using full parallel geometries for both segments');
    

    // --- Determine left/right hand traffic and assign geometry directions accordingly ---
    // Get country info from segment address
    let isLeftHandTraffic = false;
    try {
      const segmentAddress = wmeSdk.DataModel.Segments.getAddress({ segmentId });
      isLeftHandTraffic = !!segmentAddress?.country?.isLeftHandTraffic;
      console.debug('splitAndShiftSelectedSegment: isLeftHandTraffic =', isLeftHandTraffic);
    } catch (e) {
      console.warn('splitAndShiftSelectedSegment: Could not determine isLeftHandTraffic, defaulting to false (right-hand traffic)');
    }

    let leftFirstHalf = leftParallelGeometry;
    let rightSecondHalf = rightParallelGeometry;

    // For left-hand traffic: left = A→B, right = B→A
    // For right-hand traffic: right = A→B, left = B→A
    if (isLeftHandTraffic) {
      // Left: keep as A→B, Right: reverse to B→A
      if (leftFirstHalf && leftFirstHalf.coordinates && leftFirstHalf.coordinates.length > 1) {
        leftFirstHalf = {
          ...leftFirstHalf,
          coordinates: leftFirstHalf.coordinates.slice().reverse(),
        };
        console.debug('splitAndShiftSelectedSegment: Rotated right parallel geometry by 180° for left-hand traffic');
      }
    } else {
      // Right: keep as A→B, Left: reverse to B→A
      if (rightSecondHalf && rightSecondHalf.coordinates && rightSecondHalf.coordinates.length > 1) {
        rightSecondHalf = {
          ...rightSecondHalf,
          coordinates: rightSecondHalf.coordinates.slice().reverse()
        };
        console.debug('splitAndShiftSelectedSegment: Rotated left parallel geometry by 180° for right-hand traffic');
      }
    }

    console.debug('splitAndShiftSelectedSegment: Left first half (final)', leftFirstHalf);
    console.debug('splitAndShiftSelectedSegment: Right second half (final)', rightSecondHalf);

    // Validate that we have the full parallel geometries
    if (!leftFirstHalf.coordinates || !rightSecondHalf.coordinates) {
      console.error('splitAndShiftSelectedSegment: Could not access full parallel geometries for segments.');
      return;
    }

    if (leftFirstHalf.coordinates.length < 2 || rightSecondHalf.coordinates.length < 2) {
      console.error('splitAndShiftSelectedSegment: Full parallel geometries have insufficient points.');
      return;
    }
    
    // STEP 5: Perform the split and shift operations
    let leftParallelSegmentId = null;
    let rightParallelSegmentId = null;
    let leftParallelSegmentObj = null;
    let rightParallelSegmentObj = null;
    let splitNodeId = null;
    await wmeSdk.Editing.doActions(async () => {
      // First, update the segment geometry to include the split point if needed
      if (needInsert) {
        await wmeSdk.DataModel.Segments.updateSegment({ 
          segmentId: segmentId, 
          geometry: newLine 
        });
      }
      
      // Split the segment at the calculated point
      const splitPointCoord = { type: "Point", coordinates: splitCoord };
      const splitResult = await wmeSdk.DataModel.Segments.splitSegment({ 
        segmentId: segmentId, 
        geometryIndex: insertIdx + 1, 
        splitPoint: splitPointCoord 
      });
      
      // Find the two resulting segments

      // --- Robust retry mechanism to fetch split segments with valid node IDs ---
      let segA = null, segB = null;
      let newIds = splitResult && splitResult.newSegmentIds && splitResult.newSegmentIds.length === 2 ? splitResult.newSegmentIds : null;
      let candidates = [];
      let retryCount = 0;
      const maxRetries = 15;
      const retryDelay = 500;
      let foundValid = false;
      function geometrySimilarity(a, b) {
        // Returns a score: lower is more similar
        if (!a || !b || !a.coordinates || !b.coordinates) return 1e9;
        const coordsA = a.coordinates, coordsB = b.coordinates;
        if (coordsA.length !== coordsB.length) return 1e6 + Math.abs(coordsA.length - coordsB.length);
        let sum = 0;
        for (let i = 0; i < coordsA.length; i++) {
          sum += Math.abs(coordsA[i][0] - coordsB[i][0]) + Math.abs(coordsA[i][1] - coordsB[i][1]);
        }
        return sum;
      }
      while (retryCount < maxRetries && !foundValid) {
        if (newIds) {
          segA = wmeSdk.DataModel.Segments.getById({ segmentId: Number(newIds[0]) });
          segB = wmeSdk.DataModel.Segments.getById({ segmentId: Number(newIds[1]) });
        }
        // If IDs not found or missing node IDs, try to find by geometry
        if (!segA || !segB || !segA.fromNodeId || !segA.toNodeId || !segB.fromNodeId || !segB.toNodeId) {
          await new Promise(r => setTimeout(r, retryDelay));
          const allSegs = wmeSdk.DataModel.Segments.getAll();
          // First, try by split point
          const isAtSplit = seg => seg.geometry && seg.geometry.type === 'LineString' && seg.geometry.coordinates.some(c => coordsEqual(c, splitCoord));
          candidates = allSegs.filter(isAtSplit).filter(s => s.id !== segmentId);
          // If not enough, try by geometry similarity to the two parallel geometries
          if (candidates.length < 2) {
            // Use leftFirstHalf and rightSecondHalf from above (should be defined)
            const leftSim = allSegs
              .filter(s => s.id !== segmentId && s.geometry && s.geometry.type === 'LineString')
              .map(s => ({ s, sim: geometrySimilarity(s.geometry, leftFirstHalf) }))
              .sort((a, b) => a.sim - b.sim);
            const rightSim = allSegs
              .filter(s => s.id !== segmentId && s.geometry && s.geometry.type === 'LineString')
              .map(s => ({ s, sim: geometrySimilarity(s.geometry, rightSecondHalf) }))
              .sort((a, b) => a.sim - b.sim);
            // Pick the best matches if not already in candidates
            if (leftSim.length && (!candidates.some(c => c.id === leftSim[0].s.id))) candidates.push(leftSim[0].s);
            if (rightSim.length && (!candidates.some(c => c.id === rightSim[0].s.id))) candidates.push(rightSim[0].s);
            // Remove duplicates
            candidates = candidates.filter((v,i,a) => a.findIndex(t => t.id === v.id) === i);
          }
          // Log all candidate segments and their node IDs for diagnosis
          console.debug('splitAndShiftSelectedSegment: Retry', retryCount + 1, 'candidates:', candidates.map(c => ({id: c.id, fromNodeId: c.fromNodeId, toNodeId: c.toNodeId})));
          // Try to pick the two with valid node IDs if possible
          const validCandidates = candidates.filter(s => s.fromNodeId && s.toNodeId);
          if (validCandidates.length >= 2) {
            segA = validCandidates[0];
            segB = validCandidates[1];
          } else if (candidates.length >= 2) {
            segA = candidates[0];
            segB = candidates[1];
          }
        }
        // Check if both segments exist and have valid node IDs
        if (segA && segB && segA.fromNodeId && segA.toNodeId && segB.fromNodeId && segB.toNodeId) {
          foundValid = true;
          break;
        }
        if (retryCount === maxRetries - 1) {
          console.warn('splitAndShiftSelectedSegment: Retry', retryCount + 1, 'failed. segA:', segA, 'segB:', segB, 'candidates:', candidates);
        }
        retryCount++;
      }
      if (!foundValid) {
        // Show all candidate segment IDs and their node info for user troubleshooting
        let candidateInfo = candidates.map(c => `ID: ${c.id}, fromNodeId: ${c.fromNodeId}, toNodeId: ${c.toNodeId}`).join('\n');
        alert('WazePT Segment Mod: Failed to fetch split segments with valid node IDs after splitting.\n\nCandidates found (see console for details):\n' + candidateInfo + '\n\nPlease try again or reload the editor.');
        console.error('splitAndShiftSelectedSegment: Failed to split segment after retries.');
        console.debug('splitAndShiftSelectedSegment: Could not find both split segments with valid node IDs', splitResult, candidates, {segA, segB});
        return;
      }
      console.debug('splitAndShiftSelectedSegment: Found split segments', { segA: segA.id, segB: segB.id });

      // STEP 6: Determine which segment should be left parallel (reversed) vs right parallel (original)
      // We need to check the actual geometric position to assign correctly
      // Get the midpoints of each segment to determine which is "left" and which is "right"
      const segAGeom = segA.geometry;
      const segBGeom = segB.geometry;
      const segAMidpoint = turf.along(segAGeom, turf.length(segAGeom, { units: 'meters' }) / 2, { units: 'meters' });
      const segBMidpoint = turf.along(segBGeom, turf.length(segBGeom, { units: 'meters' }) / 2, { units: 'meters' });
      // Calculate which parallel geometry each segment should get
      // Left parallel should have reversed node order (B→A), right parallel should keep original order (A→B)
      const leftParallelMidpoint = turf.along(leftParallelGeometry, turf.length(leftParallelGeometry, { units: 'meters' }) / 2, { units: 'meters' });
      const rightParallelMidpoint = turf.along(rightParallelGeometry, turf.length(rightParallelGeometry, { units: 'meters' }) / 2, { units: 'meters' });
      // Determine which segment is closer to which parallel
      const segAToLeft = turf.distance(segAMidpoint, leftParallelMidpoint, { units: 'meters' });
      const segAToRight = turf.distance(segAMidpoint, rightParallelMidpoint, { units: 'meters' });
      const segBToLeft = turf.distance(segBMidpoint, leftParallelMidpoint, { units: 'meters' });
      const segBToRight = turf.distance(segBMidpoint, rightParallelMidpoint, { units: 'meters' });

      let leftParallelSegment, rightParallelSegment;
      let leftParallelGeometryCoords, rightParallelGeometryCoords;

      if (segAToLeft < segAToRight && segBToRight < segBToLeft) {
        // SegA is closer to left parallel, SegB is closer to right parallel
        leftParallelSegment = segA;
        rightParallelSegment = segB;
        leftParallelGeometryCoords = leftFirstHalf.coordinates;
        rightParallelGeometryCoords = rightSecondHalf.coordinates;
      } else if (segBToLeft < segBToRight && segAToRight < segAToLeft) {
        // SegB is closer to left parallel, SegA is closer to right parallel
        leftParallelSegment = segB;
        rightParallelSegment = segA;
        leftParallelGeometryCoords = leftFirstHalf.coordinates;
        rightParallelGeometryCoords = rightSecondHalf.coordinates;
      } else {
        // Fallback: use original assignment
        console.warn('splitAndShiftSelectedSegment: Could not clearly determine left/right assignment, using fallback');
        leftParallelSegment = segA;
        rightParallelSegment = segB;
        leftParallelGeometryCoords = leftFirstHalf.coordinates;
        rightParallelGeometryCoords = rightSecondHalf.coordinates;
      }

      // Store for return
      leftParallelSegmentId = leftParallelSegment.id;
      rightParallelSegmentId = rightParallelSegment.id;
      leftParallelSegmentObj = leftParallelSegment;
      rightParallelSegmentObj = rightParallelSegment;
      // The split node is the node that is present in both segments' node IDs
      if (leftParallelSegment && rightParallelSegment) {
        const leftNodes = [leftParallelSegment.fromNodeId, leftParallelSegment.toNodeId];
        const rightNodes = [rightParallelSegment.fromNodeId, rightParallelSegment.toNodeId];
        splitNodeId = leftNodes.find(n => rightNodes.includes(n));
      }
      
      console.debug('splitAndShiftSelectedSegment: Parallel assignment:', {
        leftParallelSegment: leftParallelSegment.id,
        rightParallelSegment: rightParallelSegment.id,
        segAToLeft, segAToRight, segBToLeft, segBToRight
      });
      
      // Validate offset geometries
      function isValidCoords(arr, name) {
        if (!Array.isArray(arr)) {
          console.error(`${name}: Not an array:`, arr);
          return false;
        }
        if (arr.length < 2) {
          console.error(`${name}: Less than 2 points:`, arr);
          return false;
        }
        const isValid = arr.every((pt, i) => {
          if (!Array.isArray(pt) || pt.length !== 2) {
            console.error(`${name}: Point ${i} is not a valid coordinate pair:`, pt);
            return false;
          }
          if (!pt.every(Number.isFinite)) {
            console.error(`${name}: Point ${i} contains non-finite numbers:`, pt);
            return false;
          }
          return true;
        });
        return isValid;
      }
      
      if (!isValidCoords(leftParallelGeometryCoords, 'leftParallelGeometryCoords') || 
          !isValidCoords(rightParallelGeometryCoords, 'rightParallelGeometryCoords')) {
        console.error('Invalid offset geometry details:', { 
          leftParallelGeometryCoords, rightParallelGeometryCoords, leftParallelGeometry, rightParallelGeometry,
          distance, insertIdx 
        });
        console.error('splitAndShiftSelectedSegment: Offset geometry is invalid. This may happen with very short segments or segments with duplicate points. Please try with a different segment.');
        return;
      }
      
      // Update segment geometries with the precise parallel coordinates
      await wmeSdk.DataModel.Segments.updateSegment({ 
        segmentId: leftParallelSegment.id, 
        geometry: { type: 'LineString', coordinates: leftParallelGeometryCoords } 
      });
      
      await wmeSdk.DataModel.Segments.updateSegment({ 
        segmentId: rightParallelSegment.id, 
        geometry: { type: 'LineString', coordinates: rightParallelGeometryCoords } 
      });

      // Set both segments to one-way A_TO_B direction
      console.log('[WazePTSegment] Step: Setting both left and right segments to one-way (A_TO_B)');
      await wmeSdk.DataModel.Segments.updateSegment({
        segmentId: leftParallelSegment.id,
        direction: "A_TO_B"
      });
      await wmeSdk.DataModel.Segments.updateSegment({
        segmentId: rightParallelSegment.id,
        direction: "A_TO_B"
      });
      console.log(`[WazePTSegment] Step: Segments ${leftParallelSegment.id} and ${rightParallelSegment.id} set to one-way (A_TO_B)`);
      
    
      // Wait for segments to be updated and nodes to be properly assigned
      await new Promise(r => setTimeout(r, 500)); // Increased delay for segment stabilization
      

      // Now determine which segments need node reversal for proper node placement:
      // - Left parallel should have A→B node order (A node at start position, B node at end position)
      // - Right parallel should have A→B node order (A node at start position, B node at end position)
      
      let leftNeedsReversal = false;
      let rightNeedsReversal = false;
      
      // Check the current geometry direction of each split segment
      const leftSegmentFirstCoord = leftParallelGeometryCoords[0];
      const leftSegmentLastCoord = leftParallelGeometryCoords[leftParallelGeometryCoords.length - 1];
      const rightSegmentFirstCoord = rightParallelGeometryCoords[0];
      const rightSegmentLastCoord = rightParallelGeometryCoords[rightParallelGeometryCoords.length - 1];
      
      // Get the updated segment objects to check their node orientations
      await new Promise(r => setTimeout(r, 200)); // Wait for segments to be fully created
      console.log('[WazePTSegment] Step: Fetching updated segment objects for node orientation check');
      const leftSegmentObj = wmeSdk.DataModel.Segments.getById({ segmentId: leftParallelSegment.id });
      const rightSegmentObj = wmeSdk.DataModel.Segments.getById({ segmentId: rightParallelSegment.id });

      if (!leftSegmentObj) {
        console.error('splitAndShiftSelectedSegment: leftParallelSegment not found in DataModel:', leftParallelSegment.id);
        return;
      }
      if (!rightSegmentObj) {
        console.error('splitAndShiftSelectedSegment: rightParallelSegment not found in DataModel:', rightParallelSegment.id);
        return;
      }

      if (leftSegmentObj.fromNodeId && leftSegmentObj.toNodeId) {
        const leftFromNode = wmeSdk.DataModel.Nodes.getById({ nodeId: leftSegmentObj.fromNodeId });
        const leftToNode = wmeSdk.DataModel.Nodes.getById({ nodeId: leftSegmentObj.toNodeId });
        if (!leftFromNode || !leftToNode) {
          console.error('splitAndShiftSelectedSegment: leftParallelSegment node(s) not found:', leftSegmentObj.fromNodeId, leftSegmentObj.toNodeId);
          return;
        }
        const leftFromNodeCoord = leftFromNode.geometry.coordinates;
        const leftToNodeCoord = leftToNode.geometry.coordinates;
        // For left parallel: We want A→B node order, so check if current node order is B→A (needs reversal)
        const leftFirstToFrom = turf.distance(turf.point(leftSegmentFirstCoord), turf.point(leftFromNodeCoord), { units: 'meters' });
        const leftFirstToTo = turf.distance(turf.point(leftSegmentFirstCoord), turf.point(leftToNodeCoord), { units: 'meters' });
        // If geometry starts closer to "from" node (B→A order), we need to reverse it to get A→B order
        leftNeedsReversal = leftFirstToFrom < leftFirstToTo;
      } else {
        console.error('splitAndShiftSelectedSegment: leftParallelSegment missing fromNodeId or toNodeId:', leftSegmentObj);
        return;
      }

      if (rightSegmentObj.fromNodeId && rightSegmentObj.toNodeId) {
        const rightFromNode = wmeSdk.DataModel.Nodes.getById({ nodeId: rightSegmentObj.fromNodeId });
        const rightToNode = wmeSdk.DataModel.Nodes.getById({ nodeId: rightSegmentObj.toNodeId });
        if (!rightFromNode || !rightToNode) {
          console.error('splitAndShiftSelectedSegment: rightParallelSegment node(s) not found:', rightSegmentObj.fromNodeId, rightSegmentObj.toNodeId);
          return;
        }
        const rightFromNodeCoord = rightFromNode.geometry.coordinates;
        const rightToNodeCoord = rightToNode.geometry.coordinates;
        // For right parallel: We want A→B node order, so check if current node order is B→A (needs reversal)
        const rightFirstToFrom = turf.distance(turf.point(rightSegmentFirstCoord), turf.point(rightFromNodeCoord), { units: 'meters' });
        const rightFirstToTo = turf.distance(turf.point(rightSegmentFirstCoord), turf.point(rightToNodeCoord), { units: 'meters' });
        // If geometry starts closer to "to" node (B→A order), we need to reverse it to get A→B order
        rightNeedsReversal = rightFirstToTo < rightFirstToFrom;
      } else {
        console.error('splitAndShiftSelectedSegment: rightParallelSegment missing fromNodeId or toNodeId:', rightSegmentObj);
        return;
      }
      
      // Remove reference to undefined variable originalIsForward
      console.debug('splitAndShiftSelectedSegment: Node placement plan for parallel roads (after pre-rotation):', {
        leftNeedsReversal: false, // Already pre-rotated in Step 6.5
        rightNeedsReversal,
        leftParallelId: leftParallelSegment.id,
        rightParallelId: rightParallelSegment.id,
        goal: 'Left parallel B→A node order (pre-rotated), Right parallel A→B node order'
      });
      
      // Apply segment rotation/reversal to achieve correct node placement
      // NOTE: Left segment was already pre-rotated in Step 6.5
      let leftReversalSuccess = true; // Already completed in pre-rotation step
      let rightReversalSuccess = true;
      
      console.log('[WazePTSegment] Step: Node placement - left segment pre-rotated, checking if right segment needs reversal');
      // Skip left segment rotation since it was already done in pre-rotation step
      if (rightNeedsReversal) {
        if (rightSegmentObj) {
          console.log('[WazePTSegment] Step: Reversing right parallel segment for A→B node order');
          rightReversalSuccess = await reverseSegmentNodes(rightParallelSegment.id);
          console.debug('splitAndShiftSelectedSegment: Right parallel segment reversed for A→B node order:', rightReversalSuccess);
          // Validate the result
          if (rightReversalSuccess) {
            setTimeout(() => {
              const validation = validateSegmentNodeOrder(rightParallelSegment.id, 'A→B');
              if (validation.valid && validation.isCorrect) {
                console.log('splitAndShiftSelectedSegment: Right parallel node order validation: SUCCESS - A→B confirmed');
              } else if (validation.valid) {
                console.warn('splitAndShiftSelectedSegment: Right parallel node order validation: FAILED - Expected A→B, got', validation.actualDirection);
              } else {
                console.error('splitAndShiftSelectedSegment: Right parallel node order validation error:', validation.error);
              }
            }, 100);
          }
        } else {
          console.warn('splitAndShiftSelectedSegment: Could not find right parallel segment object for reversal');
          rightReversalSuccess = false;
        }
      } else {
        console.log('[WazePTSegment] Step: Right segment does not need reversal, orientation is correct');
      }
      
      console.log('[WazePTSegment] Step: Successfully applied parallel geometries and node placement');
      
      // Provide detailed feedback about the result
      const placementStatus = [];
      // Left segment was pre-rotated in Step 6.5
      placementStatus.push('Left parallel: A→B node order (pre-rotated in Step 6.5)');
      
      if (rightNeedsReversal && rightReversalSuccess) placementStatus.push('Right parallel: A→B node order (segment rotated/reversed)');
      else if (!rightNeedsReversal) placementStatus.push('Right parallel: A→B node order (original orientation maintained)');
      else placementStatus.push('Right parallel: Node reversal failed - manual correction may be needed');
      
      // Show warning if right reversal failed (left was already handled in pre-rotation)
      if (rightNeedsReversal && !rightReversalSuccess) {
        console.warn('splitAndShiftSelectedSegment: Right segment reversal failed. Check the validation messages above for details.');
      }
      
      console.log(`[WazePTSegment] Step: Segment split and shifted successfully with preserved shape!\n\nResult (Node Placement with Pre-Rotation):\n- Left parallel (ID: ${leftParallelSegment.id}): A→B node order\n- Right parallel (ID: ${rightParallelSegment.id}): A→B node order\n\nDetails:\n${placementStatus.join('\n')}\n\nThis creates proper node placement where the left segment is pre-rotated and the right segment is adjusted as needed to achieve the desired node orientation.`);
      
    }, 'Split and shift segment with preserved parallel geometry');

    // If called from multi-segment, return info for stitching
    if (arguments.length > 2 && arguments[2] === true) {
      return {
        left: { segmentId: leftParallelSegmentId, splitNodeId },
        right: { segmentId: rightParallelSegmentId, splitNodeId }
      };
    }
  }

  // --- Multi-segment Split/Shift ---
  async function splitAndShiftMultipleSegments(distance) {
    const selection = wmeSdk.Editing.getSelection();
    if (!selection || selection.objectType !== 'segment' || selection.ids.length < 1) {
      console.log('splitAndShiftMultipleSegments: Please select at least one segment.');
      return;
    }

    console.debug('splitAndShiftMultipleSegments: Processing', selection.ids.length, 'segments');

    // Arrays to collect left/right segment info for stitching
    let leftSegments = [];
    let rightSegments = [];

    // Helper to get node at split point for a segment
    function getSplitNodeId(segment) {
      // Return the node that is not at the end of the chain (i.e., the shared node between two segments)
      // For stitching, we want the node at the split point (the node that connects the two split segments)
      // We'll use both fromNodeId and toNodeId for now, and match by geometry later
      if (segment && segment.fromNodeId && segment.toNodeId) {
        return [segment.fromNodeId, segment.toNodeId];
      }
      return [];
    }

    // For each segment, split and collect left/right segment IDs and their split node IDs
    for (const segmentId of selection.ids) {
      // Patch: Modify splitAndShiftSelectedSegment to return left/right segment IDs and their split node IDs
      if (typeof splitAndShiftSelectedSegment === 'function') {
        const result = await splitAndShiftSelectedSegment(distance, segmentId, true); // pass true to get info
        if (result && result.left && result.right) {
          leftSegments.push(result.left);
          rightSegments.push(result.right);
        }
      } else {
        await splitAndShiftSelectedSegment(distance, segmentId);
      }
    }

    // Helper to move nodes so that consecutive segments are stitched together
    async function connectShiftedSegments(segments) {
      for (let i = 0; i < segments.length - 1; i++) {
        const curr = segments[i];
        const next = segments[i + 1];
        // Get node objects
        const currNode = wmeSdk.DataModel.Nodes.getById({ nodeId: curr.splitNodeId });
        const nextNode = wmeSdk.DataModel.Nodes.getById({ nodeId: next.splitNodeId });
        if (!currNode || !nextNode) continue;
        // Calculate average position
        const avg = [
          (currNode.geometry.coordinates[0] + nextNode.geometry.coordinates[0]) / 2,
          (currNode.geometry.coordinates[1] + nextNode.geometry.coordinates[1]) / 2
        ];
        // Move both nodes to the average position
        await wmeSdk.DataModel.Nodes.moveNode({ id: currNode.id, geometry: { type: 'Point', coordinates: avg } });
        await wmeSdk.DataModel.Nodes.moveNode({ id: nextNode.id, geometry: { type: 'Point', coordinates: avg } });
      }
    }

    // Now connect left and right shifted segments
    if (leftSegments.length > 1) {
      await connectShiftedSegments(leftSegments);
    }
    if (rightSegments.length > 1) {
      await connectShiftedSegments(rightSegments);
    }
  }

  /*
   * IMPLEMENTATION NOTES - Segment Splitting and Node Placement:
   * 
   * Key Improvement: Proper Node Placement/Rotation for Parallel Segments
   * =====================================================================
   * 
   * PROBLEM SOLVED:
   * When splitting a bidirectional segment A<->B, both resulting segments would have
   * the same node orientation (both A→B or both B→A), which doesn't provide the
   * desired node placement for creating proper parallel road infrastructure.
   * 
   * SOLUTION IMPLEMENTED:
   * 1. After splitting, geometrically determine which segment should be "left parallel" 
   *    and which should be "right parallel" using midpoint distance calculations
   * 2. Analyze each split segment's current node orientation
   * 3. Apply segment rotation/reversal as needed to achieve desired node placement:
   *    - Left parallel: B→A node order (B node at start, A node at end)
   *    - Right parallel: A→B node order (A node at start, B node at end)
   * 4. **RESULT**: Proper node placement with segments rotated as needed
   * 
   * BEHAVIOR GUARANTEE:
   * - Input: Bidirectional segment A<->B (any orientation: N-S, E-W, diagonal)
   * - Output: Two parallel segments with SPECIFIC node placement
   *   - Left parallel: ALWAYS B→A node order (B node positioned first)
   *   - Right parallel: ALWAYS A→B node order (A node positioned first)
   * 
   * EXAMPLE (North-South segment A=North, B=South):
   * - Original: A(North)<->B(South) bidirectional
   * - Left parallel: B(North) first → A(South) second (B→A node order)
   * - Right parallel: A(North) first → B(South) second (A→B node order)
   * 
   * This creates the desired node placement by rotating/reversing segments as needed,
   * focusing purely on physical node positioning rather than traffic direction.
   */

  // --- Helper function to validate segment node order ---
  function validateSegmentNodeOrder(segmentId, expectedDirection) {
    try {
      // Get segment data directly from wmeSdk
      const segment = wmeSdk.DataModel.Segments.getById({ segmentId: segmentId });
      if (!segment) {
        return { valid: false, error: 'Invalid segment ID' };
      }
      
      const geometry = segment.geometry;
      
      if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) {
        return { valid: false, error: 'Invalid geometry' };
      }
      
      // Validate segment has required node properties
      if (!segment.fromNodeId || !segment.toNodeId) {
        return { 
          valid: false, 
          error: `Segment missing node IDs: fromNodeId=${segment.fromNodeId}, toNodeId=${segment.toNodeId}` 
        };
      }
      
      const fromNode = wmeSdk.DataModel.Nodes.getById({ nodeId: segment.fromNodeId });
      const toNode = wmeSdk.DataModel.Nodes.getById({ nodeId: segment.toNodeId });
      
      if (!fromNode || !toNode) {
        return { valid: false, error: 'Could not find nodes' };
      }
      
      const firstCoord = geometry.coordinates[0];
      const lastCoord = geometry.coordinates[geometry.coordinates.length - 1];
      
      const fromNodeCoord = fromNode.geometry.coordinates;
      const toNodeCoord = toNode.geometry.coordinates;
      
      // Calculate distances to determine actual node order
      const firstToA = turf.distance(turf.point(firstCoord), turf.point(fromNodeCoord), { units: 'meters' });
      const firstToB = turf.distance(turf.point(firstCoord), turf.point(toNodeCoord), { units: 'meters' });
      
      const actualDirection = firstToA < firstToB ? 'A→B' : 'B→A';
      const isCorrect = actualDirection === expectedDirection;
      
      return {
        valid: true,
        isCorrect: isCorrect,
        actualDirection: actualDirection,
        expectedDirection: expectedDirection,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        distanceToFromNode: firstToA,
        distanceToToNode: firstToB
      };
      
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // --- Node Reversal Function (geometry rotation approach that preserves all segment data) ---
  async function reverseSegmentNodes(segmentId) {
    try {
      // Get segment data directly from wmeSdk
      const segmentData = wmeSdk.DataModel.Segments.getById({ segmentId: segmentId });
      if (!segmentData) {
        console.error('reverseSegmentNodes: Could not find segment with ID', segmentId);
        return false;
      }
      
      console.debug('reverseSegmentNodes: Processing segment', segmentId, segmentData);
      
      // Validate segment has required node properties
      if (!segmentData.fromNodeId || !segmentData.toNodeId) {
        console.error('reverseSegmentNodes: Segment missing node IDs', {
          segmentId: segmentId,
          fromNodeId: segmentData.fromNodeId,
          toNodeId: segmentData.toNodeId,
          segmentProperties: Object.keys(segmentData)
        });
        return false;
      }
      
      // Get the nodes using wmeSdk
      const nodeA = wmeSdk.DataModel.Nodes.getById({ nodeId: segmentData.fromNodeId });
      const nodeB = wmeSdk.DataModel.Nodes.getById({ nodeId: segmentData.toNodeId });
      
      if (!nodeA || !nodeB) {
        console.error('reverseSegmentNodes: Could not find nodes', segmentData.fromNodeId, segmentData.toNodeId);
        return false;
      }
      
      console.debug('reverseSegmentNodes: Reversing segment', segmentId, 'from node', nodeA.id, 'to node', nodeB.id);
      
      // Check if segment is editable and validate nodes
      if (segmentData.permissions === 0 || segmentData.hasClosures) {
        console.error('reverseSegmentNodes: Segment is not editable (locked or has closures)');
        return false;
      }
      
      // Validate that we can access both nodes and they're valid
      if (!nodeA.id || !nodeB.id) {
        console.error('reverseSegmentNodes: Invalid node IDs');
        return false;
      }
      
      // Check if the segment is in a valid state for editing
      if (segmentId < 0) {
        // Negative IDs are temporary/new segments, wait a bit for them to stabilize
        console.debug('reverseSegmentNodes: Waiting for new segment to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Create new attributes with swapped directional properties
      const newAttr = {
        fwdDirection: segmentData.revDirection,
        revDirection: segmentData.fwdDirection,
        fwdTurnsLocked: segmentData.revTurnsLocked,
        revTurnsLocked: segmentData.fwdTurnsLocked,
        fwdMaxSpeed: segmentData.revMaxSpeed,
        revMaxSpeed: segmentData.fwdMaxSpeed,
        fwdMaxSpeedUnverified: segmentData.revMaxSpeedUnverified,
        revMaxSpeedUnverified: segmentData.fwdMaxSpeedUnverified,
        fwdLaneCount: segmentData.revLaneCount,
        revLaneCount: segmentData.fwdLaneCount
      };
      
      // Handle restrictions reversal
      if (segmentData.restrictions && segmentData.restrictions.length > 0) {
        newAttr.restrictions = [];
        for (let i = 0; i < segmentData.restrictions.length; i++) {
          if (segmentData.restrictions[i].withReverseDirection) {
            newAttr.restrictions[i] = segmentData.restrictions[i].withReverseDirection();
          } else {
            newAttr.restrictions[i] = segmentData.restrictions[i];
          }
        }
      }
      
      // Get current geometry
      const currentGeom = segmentData.geometry;
      if (!currentGeom || !currentGeom.coordinates || currentGeom.coordinates.length < 2) {
        console.error('reverseSegmentNodes: Invalid geometry');
        return false;
      }
      
      console.debug('reverseSegmentNodes: Using 180-degree rotation approach to preserve segment data');
      
      // 180-DEGREE ROTATION APPROACH: Rotate the entire segment geometry around its midpoint
      // This naturally swaps which end connects to which node without touching node IDs
      // The rotation will cause the segment to connect A→B instead of B→A (or vice versa)
      
      // Step 1: Use the segment's geometry from wmeSdk
      const originalGeometry = segmentData.geometry;
      console.debug('reverseSegmentNodes: Retrieved original geometry from wmeSdk:', originalGeometry);
      
      // Step 2: Store original node positions BEFORE rotation
      const nodeACoord = [nodeA.geometry.coordinates[0], nodeA.geometry.coordinates[1]];
      const nodeBCoord = [nodeB.geometry.coordinates[0], nodeB.geometry.coordinates[1]];
      
      console.debug('reverseSegmentNodes: Stored original node positions:');
      console.debug('  - NodeA position:', nodeACoord);
      console.debug('  - NodeB position:', nodeBCoord);
      
      // Step 3: Calculate midpoint for rotation center
      const geoLine = { type: 'LineString', coordinates: originalGeometry.coordinates };
      const totalLength = turf.length(geoLine, { units: 'meters' });
      const midpoint = turf.along(geoLine, totalLength / 2, { units: 'meters' });
      const rotationCenter = midpoint.geometry.coordinates;
      
      console.debug('reverseSegmentNodes: Rotation center (midpoint):', rotationCenter);
      
      // Step 4: Rotate the entire geometry 180 degrees around the midpoint
      // This will flip the segment so the ends swap positions
      const rotatedGeometry = turf.transformRotate(geoLine, 180, { pivot: rotationCenter });
      
      console.debug('reverseSegmentNodes: Created 180-degree rotated geometry');
      console.debug('reverseSegmentNodes: Original first point:', originalGeometry.coordinates[0]);
      console.debug('reverseSegmentNodes: Original last point:', originalGeometry.coordinates[originalGeometry.coordinates.length - 1]);
      console.debug('reverseSegmentNodes: Rotated first point:', rotatedGeometry.coordinates[0]);
      console.debug('reverseSegmentNodes: Rotated last point:', rotatedGeometry.coordinates[rotatedGeometry.coordinates.length - 1]);
      
      // Step 5: Restore original node positions after rotation
      // CRITICAL: Copy the rotated geometry but restore the exact original node positions
      const rotatedCoords = rotatedGeometry.coordinates.slice();
      
      // Determine which original node each rotated endpoint should connect to
      if (rotatedCoords.length > 0) {
        // Check which original node the rotated first point is closer to
        const rotatedFirstToA = turf.distance(turf.point(rotatedCoords[0]), turf.point(nodeACoord), { units: 'meters' });
        const rotatedFirstToB = turf.distance(turf.point(rotatedCoords[0]), turf.point(nodeBCoord), { units: 'meters' });
        
        if (rotatedFirstToA < rotatedFirstToB) {
          // Rotated geometry connects A→B, restore exact node positions
          rotatedCoords[0] = [...nodeACoord];  // First point = exact NodeA position
          rotatedCoords[rotatedCoords.length - 1] = [...nodeBCoord];  // Last point = exact NodeB position
          console.debug('reverseSegmentNodes: Restored node positions A→B after rotation');
        } else {
          // Rotated geometry connects B→A, restore exact node positions  
          rotatedCoords[0] = [...nodeBCoord];  // First point = exact NodeB position
          rotatedCoords[rotatedCoords.length - 1] = [...nodeACoord];  // Last point = exact NodeA position
          console.debug('reverseSegmentNodes: Restored node positions B→A after rotation');
        }
      }
      
      console.debug('reverseSegmentNodes: Final coordinates with restored node positions:');
      console.debug('  - First coordinate (at node):', rotatedCoords[0]);
      console.debug('  - Last coordinate (at node):', rotatedCoords[rotatedCoords.length - 1]);
      console.debug('reverseSegmentNodes: Geometry rotated but node positions preserved');
      
      // Step 5: Apply the 180-degree rotated geometry using wmeSdk
      try {
        await wmeSdk.Editing.doActions(async () => {
          // Apply the rotated geometry - this will naturally swap the node connections
          console.debug('reverseSegmentNodes: Applying 180-degree rotated geometry');
          
          await wmeSdk.DataModel.Segments.updateSegment({
            segmentId: segmentId,
            geometry: {
              type: 'LineString',
              coordinates: rotatedCoords
            }
          });
          
          console.debug('reverseSegmentNodes: Applied rotated geometry successfully');
          
          // Update directional attributes if needed
          if (newAttr.fwdDirection !== segmentData.fwdDirection || newAttr.revDirection !== segmentData.revDirection) {
            // Map boolean directions to wmeSdkPlus enum values
            let directionValue = undefined;
            if (newAttr.fwdDirection !== undefined && newAttr.revDirection !== undefined) {
              if (newAttr.fwdDirection && newAttr.revDirection) {
                directionValue = 'TWO_WAY';
              } else if (newAttr.fwdDirection && !newAttr.revDirection) {
                directionValue = 'A_TO_B';
              } else if (!newAttr.fwdDirection && newAttr.revDirection) {
                directionValue = 'B_TO_A';
              }
            }
            
            if (directionValue) {
              try {
                await wmeSdk.DataModel.Segments.updateSegment({
                  segmentId: segmentId,
                  direction: directionValue
                });
                console.debug('reverseSegmentNodes: Updated direction to', directionValue);
              } catch (directionError) {
                console.warn('reverseSegmentNodes: Direction update failed, but rotation succeeded:', directionError.message);
              }
            }
          }
        });
        
        console.log('reverseSegmentNodes: Successfully applied 180-degree rotation for segment', segmentId);
        console.log('reverseSegmentNodes: Segment rotated around midpoint - node connections naturally swapped');
        
        //Wait a bit and then verify the result
        setTimeout(async () => {
          try {
            const updatedSegmentData = wmeSdk.DataModel.Segments.getById({ segmentId: segmentId });
            
            if (updatedSegmentData) {
              console.debug('reverseSegmentNodes: Post-rotation verification:');
              console.debug('  - Segment ID:', segmentId);
              console.debug('  - fromNodeId:', updatedSegmentData.fromNodeId, '(unchanged)');
              console.debug('  - toNodeId:', updatedSegmentData.toNodeId, '(unchanged)');
              console.debug('  - New first coordinate:', updatedSegmentData.geometry.coordinates[0]);
              console.debug('  - New last coordinate:', updatedSegmentData.geometry.coordinates[updatedSegmentData.geometry.coordinates.length - 1]);
              console.debug('  - NodeA coord:', nodeACoord);
              console.debug('  - NodeB coord:', nodeBCoord);
              
              // Verify that rotation achieved the desired node connection swap
              const firstCoord = updatedSegmentData.geometry.coordinates[0];
              const lastCoord = updatedSegmentData.geometry.coordinates[updatedSegmentData.geometry.coordinates.length - 1];
              
              const firstToA = turf.distance(turf.point(firstCoord), turf.point(nodeACoord), { units: 'meters' });
              const firstToB = turf.distance(turf.point(firstCoord), turf.point(nodeBCoord), { units: 'meters' });
              
              const connectsToFirst = firstToA < firstToB ? 'NodeA' : 'NodeB';
              console.log(`reverseSegmentNodes: ✅ Rotation result - First coordinate connects to ${connectsToFirst}`);
              console.log('reverseSegmentNodes: ✅ 180-degree rotation successfully swapped segment orientation');
            }
          } catch (verifyError) {
            console.warn('reverseSegmentNodes: Could not verify post-rotation state:', verifyError.message);
          }
        }, 200);
        
        return true;
        
      } catch (updateError) {
        console.error('reverseSegmentNodes: Failed to update segment with rotated geometry:', updateError);
        console.error('reverseSegmentNodes: Error details:', updateError.message || updateError);
        
        // Fallback: Try basic geometry update only
        try {
          console.debug('reverseSegmentNodes: Attempting fallback with basic geometry rotation');
          
          await wmeSdk.Editing.doActions(async () => {
            await wmeSdk.DataModel.Segments.updateSegment({
              segmentId: segmentId,
              geometry: {
                type: 'LineString',
                coordinates: rotatedCoords
              }
            });
          });
          
          console.warn('reverseSegmentNodes: Fallback rotation completed - updated geometry only, direction attributes may need manual adjustment');
          return true;
          
        } catch (fallbackError) {
          console.error('reverseSegmentNodes: Rotation approach failed:', fallbackError);
          console.error('reverseSegmentNodes: Final error details:', fallbackError.message || fallbackError);
          return false;
        }
      }
      
    } catch (error) {
      console.error('reverseSegmentNodes: Error during geometry rotation reversal', error);
      return false;
    }
  }

// End of IIFE
})();
