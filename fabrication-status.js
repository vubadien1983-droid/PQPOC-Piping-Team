// ============================================================================
// FABRICATION STATUS & NDT PROGRESSIVE LOGIC
// ============================================================================

const DEFAULT_RULE = { rtBw: 10, mtBw: 10, mtSw: 10, mtFw: 0 };
const FULL_MATRIX = new Map();
// Common defaults
FULL_MATRIX.set("L|J3N", { rtBw: 100, mtBw: 100, mtSw: 100, mtFw: 10 });
FULL_MATRIX.set("OW|B2", { rtBw: 100, mtBw: 100, mtSw: 100, mtFw: 10 });

function classifyWeldType(weldType) {
    if (!weldType) return 'BW';
    const wt = weldType.toUpperCase();
    if (wt.includes('BW') || wt.includes('BRW') || wt.includes('BUTT')) return 'BW';
    if (wt.includes('SW') || wt.includes('SOCKET') || wt.includes('TW') || wt.includes('WOL')) return 'SW';
    if (wt.includes('FW') || wt.includes('FILLET') || wt.includes('SUPPORT')) return 'FW';
    if (wt.includes('DEL')) return 'DEL';
    return 'BW';
}

function getMatrixRequirement(sys, spec) {
    const key = (sys || '') + '|' + (spec || '');
    return FULL_MATRIX.get(key) || DEFAULT_RULE;
}

function buildFabricationGroups(data) {
    const groups = {};
    
    data.forEach(row => {
        if (!row.jointNo) return;
        
        const tp = row.testPackageNo || 'Unknown TP';
        const line = row.line || 'Unknown Line';
        const spool = row.spoolNo || 'Unknown Spool';
        
        if (!groups[tp]) groups[tp] = { 
            lines: {}, 
            actual: 0, 
            wBacklog: 0, 
            vBacklog: 0, 
            ndtReq: 0, 
            ndtDone: 0, 
            ndtBacklog: 0, 
            weldingDone: 0, 
            designNdtReq: 0, 
            designNdtDone: 0,
            rtReq: 0, rtDone: 0,
            pautReq: 0, pautDone: 0,
            mtReq: 0, mtDone: 0,
            ptReq: 0, ptDone: 0
        };
        if (!groups[tp].lines[line]) groups[tp].lines[line] = { spools: {}, actual: 0, wBacklog: 0, vBacklog: 0, ndtReq: 0, ndtDone: 0, ndtBacklog: 0, weldingDone: 0, weldTypes: {} };
        if (!groups[tp].lines[line].spools[spool]) groups[tp].lines[line].spools[spool] = { actual: 0, wBacklog: 0, vBacklog: 0, ndtReq: 0, ndtDone: 0, ndtBacklog: 0, weldingDone: 0 };
        
        const tpObj = groups[tp];
        const lineObj = tpObj.lines[line];
        const spoolObj = lineObj.spools[spool];
        
        // Identity
        const sys = row.system || '';
        const spec = row.spec || '';
        const wClass = classifyWeldType(row.weldType);
        
        if (!lineObj.weldTypes[wClass]) lineObj.weldTypes[wClass] = { sys, spec, actual: 0, req: 0, sel: 0, isExcl: wClass === 'FW' };
        const wtObj = lineObj.weldTypes[wClass];
        
        // Progress counts
        tpObj.actual++; lineObj.actual++; spoolObj.actual++;
        wtObj.actual++;
        
        const hasFitup = !!row.fitupAcc;
        const hasWeld = !!(row.visualAcc && row.visualAcc.toUpperCase() === 'ACC');
        const hasVisual = !!(row.visualAcc || row.visualReportNo);
        
        if (hasWeld) {
            tpObj.weldingDone++; lineObj.weldingDone++; spoolObj.weldingDone++;
        }
        
        if (hasFitup && !hasWeld) {
            tpObj.wBacklog++; lineObj.wBacklog++; spoolObj.wBacklog++;
        }
        if (hasWeld && !hasVisual) {
            tpObj.vBacklog++; lineObj.vBacklog++; spoolObj.vBacklog++;
        }
        
        // NDT logic
        const matrix = getMatrixRequirement(sys, spec);
        let requiresVolumetric = false;
        let requiresSurface = false;
        
        if (wClass === 'BW' || wClass === 'DEL') {
            requiresVolumetric = matrix.rtBw > 0;
            requiresSurface = matrix.mtBw > 0;
        } else if (wClass === 'SW') {
            requiresSurface = matrix.mtSw > 0;
        }
        
        const isNdtReqByData = !!(row.ndtRequest || row.rt || row.paut || row.mt || row.pt);
        const needsNdt = requiresVolumetric || requiresSurface || isNdtReqByData;
        
        const hasNdtReport = !!(row.rtReportNo || row.pautReportDate || row.mtReportNo || row.ptReportDate);
        const hasNdtRequest = !!row.ndtRequest;
        
        // NDT Backlog: Welded > 3 days, needs NDT, but NO request
        if (hasWeld && needsNdt && !hasNdtRequest) {
            const weldDate = new Date(row.weldingCompletedDate);
            const now = new Date();
            const diffDays = Math.floor((now - weldDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 3 && !isNaN(diffDays)) {
                tpObj.ndtBacklog++; lineObj.ndtBacklog++; spoolObj.ndtBacklog++;
            }
        }
        
        // NDT Done (ACC + REJ)
        const rtDone = row.rtResult ? 1 : 0;
        const pautDone = row.pautResult ? 1 : 0;
        const mtDone = row.mtResult ? 1 : 0;
        const ptDone = row.ptResult ? 1 : 0;
        
        const doneVol = (rtDone || pautDone);
        const doneSur = (mtDone || ptDone);
        
        if (doneVol || doneSur) {
            tpObj.ndtDone++; lineObj.ndtDone++; spoolObj.ndtDone++;
            wtObj.sel++;
        }
        
        // Design NDT Progress (Chỉ gộp 2 phương pháp RT và PAUT)
        const isRtReq = row.rt && row.rt.toLowerCase() === 'x';
        const isPautReq = row.paut && row.paut.toLowerCase() === 'x';
        const isNdtVolReq = isRtReq || isPautReq;
        const isNdtVolDone = (isRtReq && row.rtDone) || (isPautReq && row.pautDone);
        
        if (isNdtVolReq) {
            tpObj.designNdtReq++;
            if (isNdtVolDone) {
                tpObj.designNdtDone++;
            }
        }
        
        // Count specific NDT methods for design tracking
        if (row.rt && row.rt.toLowerCase() === 'x') {
            tpObj.rtReq++;
            if (row.rtDone) tpObj.rtDone++;
        }
        if (row.paut && row.paut.toLowerCase() === 'x') {
            tpObj.pautReq++;
            if (row.pautDone) tpObj.pautDone++;
        }
        if (row.mt && row.mt.toLowerCase() === 'x') {
            tpObj.mtReq++;
            if (row.mtDone) tpObj.mtDone++;
        }
        if (row.pt && row.pt.toLowerCase() === 'x') {
            tpObj.ptReq++;
            if (row.ptDone) tpObj.ptDone++;
        }
    });
    
    // Per-line compliance calculation
    Object.keys(groups).forEach(tp => {
        let tpCompliant = true;
        Object.keys(groups[tp].lines).forEach(line => {
            let lineCompliant = true;
            let lineNdtReq = 0;
            
            Object.values(groups[tp].lines[line].weldTypes).forEach(wt => {
                if (wt.isExcl) return;
                const matrix = getMatrixRequirement(wt.sys, wt.spec);
                let pct = 0;
                if (wt.sys && wt.spec) {
                   pct = matrix.rtBw; // Simplify logic: using rtBw for BW, mtSw for SW
                   if (wt.isExcl) pct = 0;
                   // Just use 10% as default fallback for logic testing if matrix not full
                   if (pct === 0 && !wt.isExcl) pct = 10;
                } else {
                   pct = 10;
                }
                
                wt.req = Math.ceil(wt.actual * (pct / 100));
                lineNdtReq += wt.req;
                
                if (wt.sel < wt.req) {
                    lineCompliant = false;
                }
            });
            
            groups[tp].lines[line].ndtReq = lineNdtReq;
            groups[tp].lines[line].isCompliant = lineCompliant;
            groups[tp].ndtReq += lineNdtReq;
            
            if (!lineCompliant) tpCompliant = false;
        });
        groups[tp].isCompliant = tpCompliant;
    });
    
    // Compute System-level global stats for Analytics Dashboard
    const systemStats = {};
    
    // Global counters for Project Summary
    const projectTotals = {
        joints: 0,
        weldDone: 0,
        rt: {req: 0, done: 0},
        paut: {req: 0, done: 0},
        ut: {req: 0, done: 0},
        mt: {req: 0, done: 0},
        pt: {req: 0, done: 0},
        pmi: {req: 0, done: 0},
        pwht: {req: 0, done: 0},
        hardness: {req: 0, done: 0},
        tpTotal: 0,
        hydro: {req: 0, done: 0}, // Req here will just be tpTotal, but we track done
        reinst: {req: 0, done: 0},
        leak: {req: 0, done: 0}
    };
    
    const uniquePackages = new Set();

    data.forEach(row => {
        if (!row.jointNo) return;
        projectTotals.joints++;
        
        // Test Package unique tracking
        if (row.testPackageNo) {
            if (!uniquePackages.has(row.testPackageNo)) {
                uniquePackages.add(row.testPackageNo);
                projectTotals.tpTotal++;
                
                if (row.hydrotestDate) projectTotals.hydro.done++;
                if (row.reinstatementDate) projectTotals.reinst.done++;
                if (row.leakDate1 || row.leakDate2 || row.leakDate3) projectTotals.leak.done++;
            }
        }

        const sys = row.system || 'Unknown';
        if (!systemStats[sys]) systemStats[sys] = { 
            weldingDone: 0, weldingTotal: 0, 
            ndtDone: 0, ndtTotal: 0,
            tpTotal: 0, hydroDone: 0, leakDone: 0,
            _uniquePackages: new Set()
        };
        
        systemStats[sys].weldingTotal++;
        
        if (row.testPackageNo && !systemStats[sys]._uniquePackages.has(row.testPackageNo)) {
            systemStats[sys]._uniquePackages.add(row.testPackageNo);
            systemStats[sys].tpTotal++;
            if (row.hydrotestDate) systemStats[sys].hydroDone++;
            if (row.leakDate1 || row.leakDate2 || row.leakDate3) systemStats[sys].leakDone++;
        }
        
        // Welding Done: VisualACC === "ACC"
        const isWeldDone = row.visualAcc && row.visualAcc.toUpperCase() === 'ACC';
        if (isWeldDone) {
            systemStats[sys].weldingDone++;
            projectTotals.weldDone++;
        }
        
        // Helper function for checking requirement and completion
        const checkNdt = (reqVal, accVal) => {
            const req = reqVal && reqVal.toString().toLowerCase() === 'x';
            // Some columns use 'Acc', others have report numbers. Check if truthy and not 'rej'.
            const done = req && !!accVal && accVal.toString().toLowerCase() !== 'rej';
            return { req, done };
        };

        const rt = checkNdt(row.rt, row.rtAcc || row.rtResult);
        if (rt.req) { projectTotals.rt.req++; if (rt.done) projectTotals.rt.done++; }
        
        const paut = checkNdt(row.paut, row.pautAcc || row.pautResult);
        if (paut.req) { projectTotals.paut.req++; if (paut.done) projectTotals.paut.done++; }
        
        const ut = checkNdt(row.ut, row.utAcc || row.utResult);
        if (ut.req) { projectTotals.ut.req++; if (ut.done) projectTotals.ut.done++; }
        
        const mt = checkNdt(row.mt, row.mtAcc || row.mtResult);
        if (mt.req) { projectTotals.mt.req++; if (mt.done) projectTotals.mt.done++; }
        
        const pt = checkNdt(row.pt, row.ptAcc || row.ptResult);
        if (pt.req) { projectTotals.pt.req++; if (pt.done) projectTotals.pt.done++; }
        
        const pmi = checkNdt(row.pmi, row.pmiAcc || row.pmiResult);
        if (pmi.req) { projectTotals.pmi.req++; if (pmi.done) projectTotals.pmi.done++; }
        
        const pwht = checkNdt(row.pwht, row.htAcc || row.htResult);
        if (pwht.req) { projectTotals.pwht.req++; if (pwht.done) projectTotals.pwht.done++; }
        
        const hd = checkNdt(row.hardness, row.hardnessAcc || row.hardnessResult);
        if (hd.req) { projectTotals.hardness.req++; if (hd.done) projectTotals.hardness.done++; }

        // ndtVolRequired: RT = x or PAUT = x
        const ndtVolRequired = rt.req || paut.req;
        // ndtVolDone: [RT = x and rtDone] or [PAUT = x and pautDone]
        const ndtVolDone = rt.done || paut.done;
        
        if (ndtVolRequired) {
            systemStats[sys].ndtTotal++;
            if (ndtVolDone) {
                systemStats[sys].ndtDone++;
            }
        }
    });
    
    window.globalFabricationStats = {
        groups,
        systemStats,
        projectTotals,
        totals: {
            weldingTotal: Object.values(systemStats).reduce((sum, s) => sum + s.weldingTotal, 0),
            weldingDone: Object.values(systemStats).reduce((sum, s) => sum + s.weldingDone, 0),
            ndtTotal: Object.values(systemStats).reduce((sum, s) => sum + s.ndtTotal, 0),
            ndtDone: Object.values(systemStats).reduce((sum, s) => sum + s.ndtDone, 0)
        }
    };
    
    return groups;
}

window.recalculateGlobalFabricationStats = function(data) {
    if (!data) return;
    buildFabricationGroups(data);
};

function renderFabricationStatus() {
    const tbody = document.getElementById('fabrication-status-body');
    if (!tbody) return;
    
    try {
        tbody.innerHTML = '';
        
        // Make sure filteredData is available from app.js
        if (typeof window.filteredData === 'undefined' || !window.filteredData || window.filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No data available (Database chưa được tải hoặc trống)</td></tr>';
            document.getElementById('fab-status-summary').innerText = '0 Test Packages';
            return;
        }
        
        const groups = buildFabricationGroups(window.filteredData);
        const tpKeys = Object.keys(groups).sort();
        
        document.getElementById('fab-status-summary').innerText = `${tpKeys.length} Test Packages`;
        
        let html = '';
        tpKeys.forEach((tp, i) => {
            const tpObj = groups[tp];
            const tpId = `tp-${i}`;
            
            const complianceText = tpObj.isCompliant ? '<span class="badge bg-success">Compliant</span>' : '<span class="badge bg-danger">Non-Compliant</span>';
            
            html += `
            <tr class="fw-bold" style="background: rgba(255,255,255,0.05); cursor: pointer;" onclick="toggleRow('${tpId}')">
                <td class="text-center"><i class="fa-solid fa-chevron-right transition-icon" id="icon-${tpId}"></i></td>
                <td><i class="fa-solid fa-folder text-warning me-2"></i>${tp}</td>
                <td colspan="2" class="text-muted text-center">-</td>
                <td class="text-end">${tpObj.actual}</td>
                <td class="text-end ${tpObj.wBacklog > 0 ? 'text-warning' : ''}">${tpObj.wBacklog}</td>
                <td class="text-end ${tpObj.vBacklog > 0 ? 'text-warning' : ''}">${tpObj.vBacklog}</td>
                <td class="text-end">${tpObj.ndtReq}</td>
                <td class="text-end text-info">${tpObj.ndtDone}</td>
                <td class="text-end ${tpObj.ndtBacklog > 0 ? 'text-danger' : ''}">${tpObj.ndtBacklog}</td>
                <td class="text-center">${complianceText}</td>
            </tr>`;
            
            Object.keys(tpObj.lines).sort().forEach((line, j) => {
                const lineObj = tpObj.lines[line];
                const lineId = `${tpId}-line-${j}`;
                const sysKeys = Object.values(lineObj.weldTypes).map(w => w.sys).filter((v, idx, a) => a.indexOf(v) === idx && v).join(', ');
                const lineComplianceText = lineObj.isCompliant ? '<span class="badge bg-success">Compliant</span>' : '<span class="badge bg-danger">Non-Compliant</span>';
                
                html += `
                <tr class="child-of-${tpId} fw-medium" style="display: none; background: rgba(255,255,255,0.02); cursor: pointer;" onclick="toggleRow('${lineId}')">
                    <td class="text-center"><i class="fa-solid fa-chevron-right transition-icon" id="icon-${lineId}" style="margin-left: 10px; font-size: 0.8rem;"></i></td>
                    <td style="padding-left: 25px;"><i class="fa-solid fa-code-branch text-info me-2"></i>${line}</td>
                    <td class="text-center">${sysKeys || '-'}</td>
                    <td class="text-center">-</td>
                    <td class="text-end">${lineObj.actual}</td>
                    <td class="text-end ${lineObj.wBacklog > 0 ? 'text-warning' : ''}">${lineObj.wBacklog}</td>
                    <td class="text-end ${lineObj.vBacklog > 0 ? 'text-warning' : ''}">${lineObj.vBacklog}</td>
                    <td class="text-end">${lineObj.ndtReq}</td>
                    <td class="text-end text-info">${lineObj.ndtDone}</td>
                    <td class="text-end ${lineObj.ndtBacklog > 0 ? 'text-danger' : ''}">${lineObj.ndtBacklog}</td>
                    <td class="text-center">${lineComplianceText}</td>
                </tr>`;
                
                Object.keys(lineObj.spools).sort().forEach((spool) => {
                    const spoolObj = lineObj.spools[spool];
                    html += `
                    <tr class="child-of-${lineId}" style="display: none;">
                        <td></td>
                        <td style="padding-left: 50px; font-size: 0.9em;"><i class="fa-solid fa-pipe text-secondary me-2"></i>${spool}</td>
                        <td colspan="2" class="text-center">-</td>
                        <td class="text-end">${spoolObj.actual}</td>
                        <td class="text-end ${spoolObj.wBacklog > 0 ? 'text-warning' : ''}">${spoolObj.wBacklog}</td>
                        <td class="text-end ${spoolObj.vBacklog > 0 ? 'text-warning' : ''}">${spoolObj.vBacklog}</td>
                        <td class="text-end">-</td>
                        <td class="text-end text-info">${spoolObj.ndtDone}</td>
                        <td class="text-end ${spoolObj.ndtBacklog > 0 ? 'text-danger' : ''}">${spoolObj.ndtBacklog}</td>
                        <td class="text-center">-</td>
                    </tr>`;
                });
            });
        });
        
        tbody.innerHTML = html;
    } catch (err) {
        console.error("Error in renderFabricationStatus:", err);
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger py-4" style="color: var(--accent-red); font-family: monospace;">Lỗi tổng hợp dữ liệu: ${err.message}<br/><pre style="text-align: left; font-size: 0.72rem; max-width: 900px; margin: 10px auto; overflow-x: auto; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">${err.stack}</pre></td></tr>`;
        document.getElementById('fab-status-summary').innerText = 'Error loading';
    }
}

function toggleRow(id) {
    const icon = document.getElementById(`icon-${id}`);
    if (icon) {
        if (icon.classList.contains('fa-chevron-right')) {
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-chevron-down');
        } else {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-right');
            closeAllChildren(id);
        }
    }
    
    const children = document.querySelectorAll(`.child-of-${id}`);
    children.forEach(child => {
        if (child.style.display === 'none') {
            child.style.display = 'table-row';
        } else {
            child.style.display = 'none';
        }
    });
}

function closeAllChildren(parentId) {
    const children = document.querySelectorAll(`.child-of-${parentId}`);
    children.forEach(child => {
        child.style.display = 'none';
        const childIcon = child.querySelector('.transition-icon');
        if (childIcon && childIcon.id) {
            const childId = childIcon.id.replace('icon-', '');
            if (childIcon.classList.contains('fa-chevron-down')) {
                childIcon.classList.remove('fa-chevron-down');
                childIcon.classList.add('fa-chevron-right');
                closeAllChildren(childId);
            }
        }
    });
}

function exportFabricationStatus() {
    alert("Export to Excel will be implemented in a future update.");
}

// Hook up events after DOM load
document.addEventListener('DOMContentLoaded', () => {
    const fabTabBtn = document.getElementById('tab-fabrication-status');
    const fabContainer = document.getElementById('fabrication-status-container');
    
    if (fabTabBtn) {
        
    }
    
    // Monkey patch applyFilters to also trigger renderFabricationStatus if it's the active tab
    const originalApplyFilters = window.applyFilters;
    if (typeof originalApplyFilters === 'function') {
        window.applyFilters = function() {
            originalApplyFilters.apply(this, arguments);
            if (fabTabBtn && fabTabBtn.classList.contains('active')) {
                renderFabricationStatus();
            }
        };
    }
});

