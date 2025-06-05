// ==UserScript==
// @name         WAZEPT Segments mod for NP Beta
// @version      2025.06.04.01
// @description  Facilitates the standardisation of segments for left-hand traffic AKA right-hand-driving
// @author       kid4rm90s
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor\/?.*$/
// @namespace    https://greasyfork.org/users/1087400
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @require      https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @require      https://cdn.jsdelivr.net/gh/WazeSpace/wme-sdk-plus@latest/wme-sdk-plus.js
// @require      https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js
// @connect      githubusercontent.com
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta.user.js
// @updateURL    https://raw.githubusercontent.com/kid4rm90s/Wazept-Segment-Mod-for-NP-Beta/main/WAZEPT-Segments-mod-for-NP-Beta.user.js
// ==/UserScript==
/* Original Author Thanks : J0N4S13 (jonathanserrario@gmail.com) */

/* global getWmeSdk */
/* global initWmeSdkPlus */
/* global WazeWrap */
/* global turf */
/* global $ */
/* global jQuery */
/* eslint curly: ["warn", "multi-or-nest"] */

/* Changelog
 Added segment distance
*/

(function main() {
    'use strict';

    var roads_id = [3,4,6,7,2,1,22,8,20,17,15,18,19];
    var pedestrian_id = [5,10,16];
    var language = {
        btnSplit: "Split the segments",
        strMeters: "m",
        strDistance: "Distance between the two parallel segments:",
        strSelMoreSeg: "Since you have more than 1 segment selected, to use this function make sure that you have selected segments sequentially (from one end to the other) and after executing the script, VERIFY the result obtained."
    };
    var indexselected = "";
    var valueselected = "";
    var array_roads = {};
    var last_node_A = null;
    var last_node_B = null;
    var last_coord_left_first = null;
    var last_coord_left_last = null;
    var last_coord_right_first = null;
    var last_coord_right_last = null;
    var baseDirection = null;
    
    const SCRIPT_VERSION = GM_info.script.version.toString();
    const SCRIPT_NAME = GM_info.script.name;
    const DOWNLOAD_URL = GM_info.scriptUpdateURL;
    let sdk;
    let _settings;
    const updateMessage = 'Conversion to WME SDK. Now uses turf for calculations and geometry.';

    async function bootstrap() {
        const wmeSdk = getWmeSdk({ scriptId: 'wzept-segments-mod-for-np-beta', scriptName: 'WAZEPT Segments mod for NP Beta' });
        const sdkPlus = await initWmeSdkPlus(wmeSdk, {
            hooks: ['Editing.Transactions']
        });
        sdk = sdkPlus || wmeSdk;
        sdk.Events.once({ eventName: 'wme-ready' }).then(() => {
            loadScriptUpdateMonitor();
            init();
        });
    }

    function waitForWME() {
        if (!unsafeWindow.SDK_INITIALIZED) {
            setTimeout(waitForWME, 500);
            return;
        }
        unsafeWindow.SDK_INITIALIZED.then(bootstrap);
    }
    waitForWME();

    function loadScriptUpdateMonitor() {
        try {
            const updateMonitor = new WazeWrap.Alerts.ScriptUpdateMonitor(SCRIPT_NAME, SCRIPT_VERSION, DOWNLOAD_URL, GM_xmlhttpRequest);
            updateMonitor.start();
        } catch (ex) {
            // Report, but don't stop if ScriptUpdateMonitor fails.
            console.error(`${SCRIPT_NAME}:`, ex);
        }
    }

    async function init() {
        console.log(`${SCRIPT_NAME} - Version: ${SCRIPT_VERSION}`);
        sdk.Events.on({
            eventName: 'wme-selection-changed',
            eventHandler: selectedFeature
        });
    }

    function selectedFeature() {
        console.log("selectedFeature called");
        setTimeout(() => {
            if (!sdk || !sdk.Selection || typeof sdk.Selection.getSelectedFeatures !== "function") {
                setTimeout(selectedFeature, 200);
                return;
            }
            const selected = sdk.Selection.getSelectedFeatures();
            console.log("selected:", selected);
            if (selected.length > 0) {
                console.log("selected[0].type:", selected[0].type);
            }
            const user = sdk.Users.getCurrentUser();
            console.log("User object:", user);
            if (selected.length > 0 && selected[0].type === "segment") {
                myTimer();
                console.log("User rank:", user ? user.rank : "unknown");
                if (user && user.rank >= 3) {
                    console.log("Calling insertButtons");
                    insertButtons();
                } else {
                    console.log("User rank too low or not found");
                }
            } else {
                console.log("No segment selected or wrong type");
            }
        }, 100);
    }

    function myTimer() {
        if (!$("#signsroad").length) {
            var signsroad = document.createElement("div");
            signsroad.id = 'signsroad';
            
            var btnAB = document.createElement("button");
            btnAB.innerHTML = 'A->B';
            btnAB.id = 'btnAB';
            btnAB.style.cssText = 'height: 20px;font-size:11px';

                btnAB.onclick = function() {
                    const selectedFeatures = sdk.Selection.getSelectedFeatures();
                    if (selectedFeatures.length === 0 || selectedFeatures[0].type !== "segment") {
                        return;
                    }
                    const segment = selectedFeatures[0];
                    let myRoad = segment.attributes;

                    if(myRoad.fwdDirection == true) //A to B
                    {
                        let center = sdk.Map.getCenter(); // Returns {lon, lat} in EPSG:4326
                        var $temp = $("<input>");
                        $("body").append($temp);
                        // Assuming getPermalink() should be a permalink to the segment
                        const permalink = sdk.Permalink.getLinkToSegment(myRoad.id);
                        $temp.val(`${center.lon.toString().slice(0,8)},${center.lat.toString().slice(0,8)}|${myRoad.id}|TRUE|${permalink}|${myRoad.fromNodeID}|${myRoad.toNodeID}`).select();
                        document.execCommand("copy");
                        $temp.remove();
                    }
                }

            var btnBA = document.createElement("button");
            btnBA.innerHTML = 'B->A';
            btnBA.id = 'btnBA';
            btnBA.style.cssText = 'height: 20px;font-size:11px';

                btnBA.onclick =  function() {
                    const selectedFeatures = sdk.Selection.getSelectedFeatures();
                    if (selectedFeatures.length === 0 || selectedFeatures[0].type !== "segment") {
                        return;
                    }
                    const segment = selectedFeatures[0];
                    let myRoad = segment.attributes;

                    if(myRoad.revDirection == true) //B to A
                    {
                        let center = sdk.Map.getCenter(); // Returns {lon, lat} in EPSG:4326
                        var $temp = $("<input>");
                        $("body").append($temp);
                        // Assuming getPermalink() should be a permalink to the segment
                        const permalink = sdk.Permalink.getLinkToSegment(myRoad.id);
                        $temp.val(`${center.lon.toString().slice(0,8)},${center.lat.toString().slice(0,8)}|${myRoad.id}|FALSE|${permalink}|${myRoad.toNodeID}|${myRoad.fromNodeID}`).select();
                        document.execCommand("copy");
                        $temp.remove();
                    }
                }

            var divdirections = document.createElement("div");
            divdirections.id = 'divdirections';
            divdirections.appendChild(btnAB);
            divdirections.appendChild(btnBA);

            var divLandmarkScript = document.createElement("div");
            divLandmarkScript.id = 'divLandmarkScript';
            divLandmarkScript.style.cssText = 'float:left;';
            divLandmarkScript.appendChild(signsroad);
            divLandmarkScript.appendChild(divdirections);

            $("div #segment-edit-general").prepend(divLandmarkScript);
            $( "#divdirections" ).hide();
        }
    }

    function defineSpeed (segment, speed) {
        const attributesToUpdate = {};
        if (segment.attributes.fwdMaxSpeed == null && segment.attributes.revMaxSpeed == null) {
            attributesToUpdate.fwdMaxSpeed = speed;
            attributesToUpdate.revMaxSpeed = speed;
        } else if (segment.attributes.fwdMaxSpeed == null) {
            attributesToUpdate.fwdMaxSpeed = speed;
        } else if (segment.attributes.revMaxSpeed == null) {
            attributesToUpdate.revMaxSpeed = speed;
        }
        if (Object.keys(attributesToUpdate).length > 0) {
            sdk.Segments.update({ segmentId: segment.id, attributes: attributesToUpdate });
        }
    }

    function defineRoadType (segment, type) {
        sdk.Segments.update({ segmentId: segment.id, attributes: { roadType: type } });
    }

    function defineLockRankRoad (segment, rank) {
        rank--; // Adjust rank as per original logic
        let currentUserRank = sdk.Users.getCurrentUser().rank;
        var targetLockRank = currentUserRank >= rank ? rank : currentUserRank;
        let currentLockRank = segment.attributes.lockRank;
        if (currentLockRank === null || currentLockRank < targetLockRank) {
            sdk.Segments.update({ segmentId: segment.id, attributes: { lockRank: targetLockRank } });
        }
    }

    async function convertSegmentType(segment) {
        const originalSegmentId = segment.id;
        const originalGeometry = turf.clone(segment.geometry);
        const originalFromNodeId = segment.fromNodeId;
        const originalToNodeId = segment.toNodeId;

        // Prepare new attributes, copying only relevant editable fields
        const newAttributes = {
            fwdDirection: segment.attributes.fwdDirection,
            revDirection: segment.attributes.revDirection,
            fwdMaxSpeed: segment.attributes.fwdMaxSpeed,
            revMaxSpeed: segment.attributes.revMaxSpeed,
            level: segment.attributes.level,
            fwdToll: segment.attributes.fwdToll,
            revToll: segment.attributes.revToll,
            restrictions: Array.isArray(segment.attributes.restrictions) ? [...segment.attributes.restrictions] : [],
            allowNoTurns: segment.attributes.allowNoTurns
        };

        // Set the new roadType and lockRank
        newAttributes.roadType = parseInt(array_config_country[indexselected][2]);
        newAttributes.lockRank = null;
/*
        // Set node connections for the new segment
        newAttributes.fromNodeID = originalFromNodeId;
        newAttributes.toNodeID = originalToNodeId;
        let newSegmentModel;
        try {
            await sdk.Editing.doActions(async () => {
                // 1. Delete the old segment
                await sdk.Segments.remove({ segmentId: originalSegmentId });

                // 2. Add the new segment
                const addedSegmentInfo = await sdk.Segments.add({
                    geometry: originalGeometry,
                    attributes: newAttributes
                });

                // 3. Fetch the new segment model
                newSegmentModel = sdk.Segments.getById({ segmentId: addedSegmentInfo.id });

                if (newSegmentModel && roads_id.includes(newSegmentModel.attributes.roadType)) {
                    // 4. Lock turns for the new segment
                    await sdk.Segments.update({
                        segmentId: newSegmentModel.id,
                        attributes: { fwdTurnsLocked: true, revTurnsLocked: true }
                    });

                    // 5. Refresh node connections
                    if (originalFromNodeId) {
                        await sdk.Editing.updateAllConnections({ nodeId: originalFromNodeId });
                    }
                    if (originalToNodeId) {
                        await sdk.Editing.updateAllConnections({ nodeId: originalToNodeId });
                    }
                }
            }, `Convert segment type for ID: ${originalSegmentId}`);
        } catch (error) {
            console.error("Error during convertSegmentType:", error);
            return null;
        }
        return newSegmentModel;
    }
*/
        // Set the new roadType and lockRank
        newAttributes.roadType = parseInt(array_config_country[indexselected][2]);
        newAttributes.lockRank = null; // Explicitly setting to null

        // Set node connections for the new segment
        newAttributes.fromNodeID = originalFromNodeId;
        newAttributes.toNodeID = originalToNodeId;

        let newSegmentModel;

        try {
            await sdk.Editing.doActions(async () => {
                // 1. Delete the old segment
                await sdk.Segments.remove({ segmentId: originalSegmentId });

                // 2. Add the new segment
                const addedSegmentInfo = await sdk.Segments.add({
                    geometry: originalGeometry,
                    attributes: newAttributes
                });
                
                // Fetch the full model of the newly added segment
                newSegmentModel = sdk.Segments.getById({ segmentId: addedSegmentInfo.id });

                if (newSegmentModel && roads_id.includes(newSegmentModel.attributes.roadType)) {
                    // 3. Update turns locked status for the new segment
                    await sdk.Segments.update({
                        segmentId: newSegmentModel.id,
                        attributes: { fwdTurnsLocked: true, revTurnsLocked: true }
                    });

                    // 4. Refresh connections/turns at the nodes
                    // This replaces the legacy ModifyAllConnections
                    if (originalFromNodeId) {
                        await sdk.Editing.updateAllConnections({ nodeId: originalFromNodeId });
                    }
                    if (originalToNodeId) {
                        await sdk.Editing.updateAllConnections({ nodeId: originalToNodeId });
                    }
                }
            }, `Convert segment type for ID: ${originalSegmentId}`);
        } catch (error) {
            console.error("Error during convertSegmentType:", error);
            return null; // Or throw error
        }

        return newSegmentModel; // Return the model of the newly created segment
    }

    // Split Segments

    function insertButtons() {
        console.log("insertButtons called");
        const currentUser = sdk.Users.getCurrentUser();
        if (!currentUser || !currentUser.isLoggedIn()) {
            console.log("User not logged in or sdk.Users.getCurrentUser() failed");
            return;
        }

        const selectedFeatures = sdk.Selection.getSelectedFeatures();
        if (selectedFeatures.length === 0) {
            console.log("No features selected");
            return;
        }
        if (selectedFeatures[0].type !== "segment") {
            console.log("First selected feature is not a segment:", selectedFeatures[0].type);
            return;
        }

        let exit = false;
        selectedFeatures.forEach(segment => {
            if (segment.type === "segment" && segment.attributes) {
                if (segment.attributes.fwdLaneCount != 0 || segment.attributes.revLaneCount != 0) {
                    console.log("Segment has lanes, skipping");
                    exit = true;
                }
                if (segment.attributes.fwdDirection == false || segment.attributes.revDirection == false) {
                    console.log("Segment direction is false, skipping");
                    exit = true;
                }
                if (pedestrian_id.includes(segment.attributes.roadType)) {
                    console.log("Segment is pedestrian, skipping");
                    exit = true;
                }
            } else {
                console.log("Segment missing attributes or not a segment");
                exit = true; 
            }
            if (exit) return;
        });
        if (exit) {
            console.log("Segment not eligible for button");
            return;
        }
        try {
            if (document.getElementById('split-segment') !== null) {
                console.log("Button already exists");
                return;
            }
        } catch (e) {
            console.error("Error checking for existing 'split-segment' element:", e);
        }

        var btn1 = $('<wz-button color="secondary" size="sm" style="float:right;margin-top: 5px;">' + language.btnSplit + '</wz-button>');
        btn1.click(mainSplitSegments);
        var strMeters = language.strMeters;
        var selSegmentsDistance = $('<wz-select id="segmentsDistance" data-type="numeric" value="5" style="width: 45%;float:left;" />');
        selSegmentsDistance.append($('<wz-option value="5">5 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="7">7 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="9">9 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="10">10 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="11">11 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="13">13 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="14">14 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="15">15 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="17">17 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="19">19 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="21">21 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="23">23 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="25">25 ' + strMeters + '</wz-option>'));
        selSegmentsDistance.append($('<wz-option value="37">37 ' + strMeters + '</wz-option>'));
        var cnt = $('<div id="split-segment" class="form-group" style="display: flex;" />');
        var divGroup1 = $('<div/>');
        divGroup1.append($('<wz-label>' + language.strDistance + '</wz-label>'));
        divGroup1.append(selSegmentsDistance);
        divGroup1.append(btn1);
        cnt.append(divGroup1);

        // Robust container targeting with logs
        let targetContainer = null;
        if ($("#segment-edit-general").length > 0) {
            targetContainer = $("#segment-edit-general");
            console.log("Target: #segment-edit-general");
        } else if ($(".multi-segment-edit").length > 0) {
            targetContainer = $(".multi-segment-edit");
            console.log("Target: .multi-segment-edit");
        } else if ($(".segment-edit").length > 0) {
            targetContainer = $(".segment-edit");
            console.log("Target: .segment-edit");
        } else if ($(".edit-panel").length > 0) {
            targetContainer = $(".edit-panel");
            console.log("Target: .edit-panel");
        }

        if (targetContainer && targetContainer.length > 0) {
            targetContainer.append(cnt);
            console.log("Button inserted");
        } else {
            console.error("WAZEPT Segments mod: Could not find a place to insert the split segment UI.");
            return;
        }

        const storedMeters = localStorage.getItem("metersSplitSegment");
        if (storedMeters !== null) {
            $("#segmentsDistance").val(storedMeters);
        }
        $('#segmentsDistance').on('change', function(){
            localStorage.setItem("metersSplitSegment", $(this).val());
        });
    }

    function orderSegments() {
        const selectedFeatures = sdk.Selection.getSelectedFeatures().filter(f => f.type === "segment");
        const orderedSegments = [];
        const nodes = [];
        let nextNode = null;
        selectedFeatures.forEach(segment => {
            const fromNodeID = segment.fromNodeId ?? segment.attributes.fromNodeID;
            const toNodeID = segment.toNodeId ?? segment.attributes.toNodeID;
            if (nodes.length > 0) {
                let fromExists = false;
                let toExists = false;
                nodes.forEach(no1 => {
                    if (no1[0] === fromNodeID) {
                        no1[1] = 2;
                        fromExists = true;
                    }
                    if (no1[0] === toNodeID) {
                        no1[1] = 2;
                        toExists = true;
                    }
                });
                if (!fromExists) nodes.push([fromNodeID, 1]);
                if (!toExists) nodes.push([toNodeID, 1]);
            } else {
                nodes.push([fromNodeID, 1]);
                nodes.push([toNodeID, 1]);
            }
        });
        let segments = selectedFeatures.length;
        for (const no of nodes) {
            if (no[1] === 1) {
                nextNode = no[0];
                break;
            }
        }
        while (segments > 0) {
            for (const segment of selectedFeatures) {
                const fromNodeID = segment.fromNodeId ?? segment.attributes.fromNodeID;
                const toNodeID = segment.toNodeId ?? segment.attributes.toNodeID;
                const segId = segment.id ?? segment.attributes.id;
                if (fromNodeID === nextNode) {
                    orderedSegments.push(segId);
                    nextNode = toNodeID;
                    segments--;
                    break;
                } else if (toNodeID === nextNode) {
                    orderedSegments.push(segId);
                    nextNode = fromNodeID;
                    segments--;
                    break;
                }
            }
        }
        return orderedSegments;
    }

    async function mainSplitSegments() {
        last_coord_left_first = null;
        last_coord_left_last = null;
        last_coord_right_first = null;
        last_coord_right_last = null;
        if (sdk.Selection.getSelectedFeatures().length > 1)
            if (!confirm(language.strSelMoreSeg))
                return;
        const distance = $("#segmentsDistance").val();
        let orderedSegments = orderSegments();
        let leftSegments = [];
        let rightSegments = [];

        // 1. Split all segments and collect new segment IDs
        for (const idsegment of orderedSegments) {
            const segment = sdk.Segments.getById({ segmentId: idsegment });
            if (!segment) {
                console.error(`Segment with ID ${idsegment} not found.`);
                continue;
            }
            try {
                const segments = await createSegments(segment, distance, null);
                if (!segments || segments.length !== 2) {
                    console.error(`Failed to create parallel segments for segment ID ${idsegment}`);
                    continue;
                }
                leftSegments.push(segments[0]);
                rightSegments.push(segments[1]);
            } catch (e) {
                console.error(`Error splitting segment ID ${idsegment}:`, e);
            }
        }

        // 2. Wait for Waze to process the split actions, then connect the ends
        setTimeout(async () => {
            try {
                for (let i = 0; i < leftSegments.length - 1; i++) {
                    const segA = sdk.Segments.getById({ segmentId: leftSegments[i] });
                    const segB = sdk.Segments.getById({ segmentId: leftSegments[i + 1] });
                    if (segA && segB) {
                        const nodeId = segA.toNodeId;
                        if (nodeId && segB) {
                            await sdk.Editing.connectSegment({ nodeId, segmentId: segB.id });
                            await sdk.Editing.updateAllConnections({ nodeId });
                        }
                    }
                }
                for (let i = 0; i < rightSegments.length - 1; i++) {
                    const segA = sdk.Segments.getById({ segmentId: rightSegments[i] });
                    const segB = sdk.Segments.getById({ segmentId: rightSegments[i + 1] });
                    if (segA && segB) {
                        const nodeId = segA.toNodeId;
                        if (nodeId && segB) {
                            await sdk.Editing.connectSegment({ nodeId, segmentId: segB.id });
                            await sdk.Editing.updateAllConnections({ nodeId });
                        }
                    }
                }
            } catch (e) {
                console.error("Error connecting split segments:", e);
            }
        }, 500);
    }

    // Create two parallel segments using WME SDK+ and turf.js
    async function createSegments(sel, displacement, no) {
        const originalLine = turf.lineString(turf.getCoords(sel.geometry));
        const offset = Number(displacement) / 2;
        const leftLine = turf.lineOffset(originalLine, -offset, { units: "meters" });
        const rightLine = turf.lineOffset(originalLine, offset, { units: "meters" });
        const splitResult = await sdk.Segments.split({ segmentId: sel.id });
        if (!splitResult || splitResult.length !== 2) {
            console.error("Failed to split segment:", sel.id);
            return [];
        }
        let leftSegment = sdk.Segments.getById({ segmentId: splitResult[0] });
        let rightSegment = sdk.Segments.getById({ segmentId: splitResult[1] });
        let leftCoords = turf.getCoords(leftLine);
        let rightCoords = turf.getCoords(rightLine);
        if (no === "AA" || no === "BB") {
            leftCoords = leftCoords.reverse();
            rightCoords = rightCoords.reverse();
        }
        if (
            last_coord_left_first && last_coord_left_last &&
            last_coord_right_first && last_coord_right_last
        ) {
            if (no === "AB") {
                leftCoords[leftCoords.length - 1] = [last_coord_left_first.x, last_coord_left_first.y];
                rightCoords[rightCoords.length - 1] = [last_coord_right_first.x, last_coord_right_first.y];
            }
            if (no === "BA") {
                leftCoords[0] = [last_coord_left_last.x, last_coord_left_last.y];
                rightCoords[0] = [last_coord_right_last.x, last_coord_right_last.y];
            }
            if (no === "AA") {
                leftCoords[leftCoords.length - 1] = [last_coord_left_first.x, last_coord_left_first.y];
                rightCoords[rightCoords.length - 1] = [last_coord_right_first.x, last_coord_right_first.y];
            }
            if (no === "BB") {
                leftCoords[0] = [last_coord_left_last.x, last_coord_left_last.y];
                rightCoords[0] = [last_coord_right_last.x, last_coord_right_last.y];
            }
        }
        sdk.Segments.update({
            segmentId: leftSegment.id,
            geometry: { type: "LineString", coordinates: leftCoords }
        });
        sdk.Segments.update({
            segmentId: rightSegment.id,
            geometry: { type: "LineString", coordinates: rightCoords }
        });
        last_coord_left_first = { x: leftCoords[0][0], y: leftCoords[0][1] };
        last_coord_left_last = { x: leftCoords[leftCoords.length - 1][0], y: leftCoords[leftCoords.length - 1][1] };
        last_coord_right_first = { x: rightCoords[0][0], y: rightCoords[0][1] };
        last_coord_right_last = { x: rightCoords[rightCoords.length - 1][0], y: rightCoords[rightCoords.length - 1][1] };

        // 9. Update directions if needed
        if (no === "AA" || no === "BB") {
            sdk.Segments.update({
                segmentId: rightSegment.id,
                attributes: {
                    revDirection: false,
                    fwdMaxSpeed: rightSegment.attributes.revMaxSpeed,
                    revMaxSpeed: rightSegment.attributes.fwdMaxSpeed
                }
            });
            sdk.Segments.update({
                segmentId: leftSegment.id,
                attributes: {
                    fwdDirection: false,
                    fwdMaxSpeed: leftSegment.attributes.revMaxSpeed,
                    revMaxSpeed: leftSegment.attributes.fwdMaxSpeed
                }
            });
        } else {
            sdk.Segments.update({
                segmentId: rightSegment.id,
                attributes: { revDirection: false }
            });
            sdk.Segments.update({
                segmentId: leftSegment.id,
                attributes: { fwdDirection: false }
            });
        }
        return [leftSegment.id, rightSegment.id];
    }

    function getEquation(segment) {
        let coords;
        if (segment && segment.type === "LineString" && Array.isArray(segment.coordinates)) {
            coords = segment.coordinates;
        } else if (Array.isArray(segment) && segment.length === 2) {
            coords = segment;
        } else {
            throw new Error("getEquation: Invalid segment format");
        }
        const [x1, y1] = coords[0];
        const [x2, y2] = coords[1];
        if (x2 === x1) {
            return { x: x1 };
        }
        const slope = (y2 - y1) / (x2 - x1);
        const offset = y1 - (slope * x1);
        return { slope, offset };
    }

    function intersectX(eqa, eqb, defaultPoint) {
        if (eqa.points && eqb.points) {
            try {
                const line1 = turf.lineString(eqa.points);
                const line2 = turf.lineString(eqb.points);
                const intersect = turf.lineIntersect(line1, line2);
                if (intersect.features.length > 0) {
                    return intersect.features[0].geometry.coordinates;
                }
            } catch (e) {}
        }
        if (typeof eqa.slope === "number" && typeof eqb.slope === "number") {
            if (eqa.slope === eqb.slope) return null;
            const ix = (eqb.offset - eqa.offset) / (eqa.slope - eqb.slope);
            const iy = eqa.slope * ix + eqa.offset;
            return [ix, iy];
        }
        if (typeof eqa.x === "number" && typeof eqb.slope === "number") {
            const ix = eqa.x;
            const iy = eqb.slope * ix + eqb.offset;
            return [ix, iy];
        }
        if (typeof eqb.x === "number" && typeof eqa.slope === "number") {
            const ix = eqb.x;
            const iy = eqa.slope * ix + eqa.offset;
            return [ix, iy];
        }
        return defaultPoint || null;
    }


    // Split a segment using WME SDK+ and turf.js, returning the new segment IDs
    async function SplitSegment(road) {
        // Ensure the road is editable
        if (!road || !road.arePropertiesEditable || !road.arePropertiesEditable()) {
            return undefined;
        }

        // Clone the geometry using turf
        const coords = turf.getCoords(road.geometry);
        if (!Array.isArray(coords) || coords.length < 2) {
            return undefined;
        }

        // If only two points, insert a midpoint
        let splitIndex = Math.floor(coords.length / 2);
        let splitPoint;
        if (coords.length === 2) {
            // Calculate midpoint
            splitPoint = [
                (coords[0][0] + coords[1][0]) / 2,
                (coords[0][1] + coords[1][1]) / 2
            ];
            coords.splice(1, 0, splitPoint);
            // Update geometry before split
            await sdk.Segments.update({
                segmentId: road.id,
                geometry: { type: "LineString", coordinates: coords }
            });
            splitIndex = 1;
        } else {
            splitPoint = coords[splitIndex];
        }

        // Use SDK+ to split at the midpoint
        let splitResult;
        try {
            splitResult = await sdk.Segments.split({
                segmentId: road.id,
                splitIndex: splitIndex
            });
        } catch (e) {
            console.error("SplitSegment error:", e);
            return undefined;
        }
        if (!splitResult || !Array.isArray(splitResult) || splitResult.length !== 2) {
            return undefined;
        }
        return splitResult;
    }

    
    function verifyNull(variable)
    {
        if (variable === null || typeof variable !== "object" || !("v" in variable)) return "";
        return variable["v"];
    }

})();