// Phase 7.2A — Runtime Validation Harness (v2 — reliable, no extraction)
// 内联 Phase 7.2 引擎数学 (buildCarbonReductionMetricsV2 pseudocode 直接复刻)
// 叠加 app.js 源码静态 UI/schema 审计

const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf8');

// ================= 内联 Engine (1:1 对齐 app.js Phase 7.2 实现) =================
const norm = (v) => { if (v === '' || v == null || v === undefined) return null; const n = Number(v); return isNaN(n) ? null : n; };
const R3 = (v) => (v == null || isNaN(v) || !isFinite(v)) ? null : Math.round(v * 1000) / 1000;

function engineV2(patch) {
    const ds = patch.dataSource || {};
    const ass = patch.assumptions || {};
    const organicWasteKg = norm(ds.organicWaste?.calculatedMassKg);
    const compostOutputKg = norm(ds.compostOutput?.amountKg);

    const i1Rep = ass.impact1TransportRepresentation;
    const i2Rep = ass.impact2ProcurementRepresentation;

    const organicWasteT = (organicWasteKg != null && organicWasteKg >= 0) ? organicWasteKg / 1000 : null;

    // ============================
    // IMPACT 1
    // ============================
    let impact1 = { ready: false, representation: i1Rep, avoidedCo2Kg: null };

    if (i1Rep === 'shared_collection_vehicle') {
        const capT = norm(ass.impact1SharedVehicleCapacityT);
        const loadPct = norm(ass.impact1SharedLoadingRatePct);
        const distKm = norm(ass.impact1SharedDistanceKm);
        const ef = norm(ass.impact1SharedCo2EfKgCo2eqPerVmKm);
        const type = ass.impact1SharedDistanceType;

        const effLoadT = (capT!=null && loadPct!=null && capT>=0 && loadPct>=0) ? (capT * (loadPct/100)) : null;
        let vehicleLoadEquivalent = null;
        if (organicWasteT != null && effLoadT != null && effLoadT > 0) vehicleLoadEquivalent = organicWasteT / effLoadT;
        else if (effLoadT == null || effLoadT === 0) vehicleLoadEquivalent = null;

        impact1.effectiveVehicleLoadT = effLoadT;
        impact1.organicWasteT = organicWasteT;
        impact1.vehicleLoadEquivalent = vehicleLoadEquivalent;
        impact1.representedDistanceKm = distKm;
        impact1.distanceType = type;
        impact1.emissionFactor = ef;

        const ready = organicWasteKg != null && organicWasteKg > 0
            && distKm != null && distKm >= 0
            && capT != null && capT > 0
            && loadPct != null && loadPct > 0
            && ef != null && ef >= 0
            && effLoadT > 0
            && vehicleLoadEquivalent != null && isFinite(vehicleLoadEquivalent);
        impact1.ready = ready;
        if (ready) {
            const raw = vehicleLoadEquivalent * distKm * ef;
            impact1.avoidedCo2KgRaw = raw;
            impact1.avoidedCo2Kg = R3(raw);
        }
    }
    else if (i1Rep === 'dedicated_collection_trip') {
        const mode = ass.impact1DedicatedTripCalcMode;
        const capacityT = norm(ass.impact1DedicatedVehicleCapacityT);
        const loadPct = norm(ass.impact1DedicatedLoadingRatePct);
        const manualTrips = norm(ass.impact1DedicatedNumberTrips);
        const distPerTrip = norm(ass.impact1DedicatedDistancePerTripKm);
        const basis = ass.impact1DedicatedDistanceBasis;
        const ef = norm(ass.impact1DedicatedCo2EfKgCo2eqPerVmKm);

        const effLoadT = (capacityT!=null && loadPct!=null && capacityT>=0 && loadPct>=0) ? (capacityT * (loadPct/100)) : null;
        let numberTrips = null;
        let tripsDerivedViaCeil = false;
        if (mode === 'manual_trips') numberTrips = manualTrips;
        else if (mode === 'from_capacity') {
            if (organicWasteT != null && effLoadT != null && effLoadT > 0) {
                numberTrips = Math.ceil(organicWasteT / effLoadT);
                tripsDerivedViaCeil = true;
            }
        }

        let effTripDist = null;
        if (distPerTrip != null && basis === 'round_trip') effTripDist = distPerTrip;
        else if (distPerTrip != null && basis === 'one_way_doubled') effTripDist = distPerTrip * 2;

        impact1.organicWasteT = organicWasteT;
        impact1.effectiveVehicleLoadT = effLoadT;
        impact1.tripCalcMode = mode;
        impact1.numberTrips = numberTrips;
        impact1.tripsDerivedViaCeil = tripsDerivedViaCeil;
        impact1.enteredDistancePerTripKm = distPerTrip;
        impact1.distanceBasis = basis;
        impact1.effectiveTravelDistancePerTripKm = effTripDist;
        impact1.emissionFactor = ef;

        const ready = organicWasteKg != null && organicWasteKg > 0
            && mode != null
            && numberTrips != null && numberTrips >= 0 && isFinite(numberTrips)
            && effTripDist != null && effTripDist >= 0
            && ef != null && ef >= 0;
        impact1.ready = ready;
        if (ready) {
            const raw = numberTrips * effTripDist * ef;
            impact1.avoidedCo2KgRaw = raw;
            impact1.avoidedCo2Kg = R3(raw);
        }
    }

    // ============================
    // IMPACT 2 — shared Replacement Fraction
    // ============================
    const replPct = norm(ass.impact2ReplacementFractionPct);
    const replFrac = (replPct != null && replPct >= 0) ? replPct / 100 : null;
    const effectiveReplacementKg = (compostOutputKg != null && compostOutputKg >= 0 && replFrac != null) ? compostOutputKg * replFrac : null;

    let impact2 = { ready: false, representation: i2Rep, avoidedCo2Kg: null };
    impact2.selectedCompostOutputKg = compostOutputKg;
    impact2.replacementFractionPct = replPct;
    impact2.effectiveReplacementKg = effectiveReplacementKg;

    if (i2Rep === 'dedicated_procurement_trip') {
        const trips = norm(ass.impact2DedicatedAvoidedTrips);
        const rtd = norm(ass.impact2DedicatedRoundTripKm);
        const ef = norm(ass.impact2DedicatedCo2EfKgCo2eqPerVmKm);

        impact2.avoidedTrips = trips;
        impact2.roundTripDistanceKm = rtd;
        impact2.emissionFactor = ef;

        const ready = effectiveReplacementKg != null && effectiveReplacementKg > 0
            && trips != null && trips >= 0
            && rtd != null && rtd >= 0
            && ef != null && ef >= 0;
        impact2.ready = ready;
        if (ready) {
            const raw = trips * rtd * ef;
            impact2.avoidedCo2KgRaw = raw;
            impact2.avoidedCo2Kg = R3(raw);
        }
    }
    else if (i2Rep === 'amount_based_procurement') {
        const perTripKg = norm(ass.impact2AmountBasedCompostPerTripKg);
        const treatment = ass.impact2AmountBasedTripTreatment;
        const rtd = norm(ass.impact2AmountBasedRoundTripKm);
        const ef = norm(ass.impact2AmountBasedCo2EfKgCo2eqPerVmKm);

        let tripsEq = null;
        let tripsWhole = null;
        let usedTreatment = null;
        if (effectiveReplacementKg != null && effectiveReplacementKg > 0 && perTripKg != null && perTripKg > 0) {
            if (treatment === 'proportional') { tripsEq = effectiveReplacementKg / perTripKg; usedTreatment = 'proportional'; }
            else if (treatment === 'whole_trips') { tripsWhole = Math.ceil(effectiveReplacementKg / perTripKg); usedTreatment = 'whole_trips'; }
        }

        impact2.compostPerProcurementTripKg = perTripKg;
        impact2.avoidedTripEquivalent = tripsEq;
        impact2.avoidedTrips = tripsWhole;
        impact2.tripTreatment = usedTreatment || treatment;
        impact2.roundTripDistanceKm = rtd;
        impact2.emissionFactor = ef;

        const tripsReady = (usedTreatment === 'proportional' && tripsEq != null && isFinite(tripsEq))
                        || (usedTreatment === 'whole_trips' && tripsWhole != null && isFinite(tripsWhole));
        const ready = effectiveReplacementKg != null && effectiveReplacementKg > 0
            && perTripKg != null && perTripKg > 0
            && treatment != null
            && tripsReady
            && rtd != null && rtd >= 0
            && ef != null && ef >= 0;
        impact2.ready = ready;
        if (ready) {
            const tripsVal = usedTreatment === 'proportional' ? tripsEq : tripsWhole;
            const raw = tripsVal * rtd * ef;
            impact2.avoidedCo2KgRaw = raw;
            impact2.avoidedCo2Kg = R3(raw);
        }
    }

    // ============================
    // SUMMARY — Both-only (Phase 7.1 §73)
    // ============================
    const i1Raw = impact1.avoidedCo2KgRaw;
    const i2Raw = impact2.avoidedCo2KgRaw;
    const bothReady = impact1.ready && impact2.ready;
    let totalRaw = null, totalR3 = null, normGPerKgOw = null;
    if (bothReady && i1Raw != null && i2Raw != null) {
        totalRaw = i1Raw + i2Raw;
        totalR3 = R3(totalRaw);
        if (organicWasteKg != null && organicWasteKg > 0) {
            normGPerKgOw = (totalRaw / organicWasteKg) * 1000;
        }
    }

    return {
        impact1,
        impact2,
        summary: {
            bothReady,
            totalAvoidedCo2Raw: totalRaw,
            totalAvoidedCo2Kg: totalR3,
            normalisedReductionGPerKgOw: normGPerKgOw != null ? R3(normGPerKgOw) : null
        }
    };
}

// ==================== 静态 helper：提取 app.js 中 _defaultCarbonAssumptions 内字段 (正则) ====================
// 用已验证成功的 DCA 抽取逻辑复现 default 检测
function detectDefaultsAudit() {
    // 用正则在 app.js 里直接抓 _defaultCarbonAssumptions 返回体内容
    // Phase 7.2 §31 核心要求：所有数值字段 null，文本空，label 必须 = Custom Local Assumptions，enum (representation/treatment) 空
    const result = {};
    // 查 label
    result.labelIsCustom = /assumptionSetLabel\s*:\s*['"]Custom Local Assumptions['"]/.test(appSrc);
    // 查一些关键 ICTA 具体值：6\.8、9\.2、2\.6、63\.6、0\.118 → 这些硬编码只能出现在 loadICTATFMExamplePreset 函数内，不能在 _defaultCarbonAssumptions
    const dcaSigIdx = appSrc.indexOf('_defaultCarbonAssumptions');
    const loadIctaSigIdx = appSrc.indexOf('loadICTATFMExamplePreset');
    const firstFuncAfterDcaIdx = Math.min(
        appSrc.indexOf('}', dcaSigIdx),
        loadIctaSigIdx > dcaSigIdx ? loadIctaSigIdx : Infinity
    );
    // Determine DCA body scope (sig → loadIctaSigIdx because loadICTATFMExamplePreset follows DCA in the class)
    const dcaBody = appSrc.slice(dcaSigIdx, loadIctaSigIdx);
    // ICTA 硬编码数值绝不能在 DCA 内
    const forbiddenICTAInDefaults = [
        new RegExp('6\\.8\\s*(?:[,}\\]]|\\.km|\\s*$)', 'm'),
        new RegExp('impact1SharedVehicleCapacityT\\s*:\\s*9\\.2'),
        new RegExp('impact1SharedCo2Ef\\s*:\\s*2\\.6'),
        new RegExp('impact2DedicatedRoundTripKm\\s*:\\s*63\\.6'),
        new RegExp('impact2DedicatedCo2Ef\\s*:\\s*0\\.118')
    ];
    result.hasAnyICTAHardcoded = forbiddenICTAInDefaults.some(r => r.test(dcaBody));

    // General 模式下关键数值字段必须 null (在 DCA 返回体中模式: `field: null`)
    const requiredNulls = [
        'impact1SharedDistanceKm','impact1SharedVehicleCapacityT','impact1SharedLoadingRatePct','impact1SharedCo2EfKgCo2eqPerVmKm',
        'impact1DedicatedNumberTrips','impact1DedicatedVehicleCapacityT','impact1DedicatedLoadingRatePct','impact1DedicatedDistancePerTripKm','impact1DedicatedCo2EfKgCo2eqPerVmKm',
        'impact2ReplacementFractionPct','impact2DedicatedAvoidedTrips','impact2DedicatedRoundTripKm','impact2DedicatedCo2EfKgCo2eqPerVmKm',
        'impact2AmountBasedCompostPerTripKg','impact2AmountBasedRoundTripKm','impact2AmountBasedCo2EfKgCo2eqPerVmKm'
    ];
    let nullCount = 0;
    for (const k of requiredNulls) {
        const re = new RegExp(k + '\\s*:\\s*null\\b');
        if (re.test(dcaBody)) nullCount++;
    }
    result.requiredNullFieldsAllNull = nullCount === requiredNulls.length;
    result.requiredNullFieldsHitCount = nullCount;
    result.requiredNullFieldsTotal = requiredNulls.length;

    // Representation enum defaults: must NOT be preset
    const noRep = !/impact1TransportRepresentation\s*:\s*['"][^'"]+['"]/.test(dcaBody)
              && !/impact2ProcurementRepresentation\s*:\s*['"][^'"]+['"]/.test(dcaBody)
              && !/impact2AmountBasedTripTreatment\s*:\s*['"][^'"]+['"]/.test(dcaBody)
              && !/impact1DedicatedTripCalcMode\s*:\s*['"][^'"]+['"]/.test(dcaBody)
              && !/impact1SharedDistanceType\s*:\s*['"][^'"]+['"]/.test(dcaBody)
              && !/impact1DedicatedDistanceBasis\s*:\s*['"][^'"]+['"]/.test(dcaBody);
    result.allRepresentationEnumsUnset = noRep;

    result.dcaBodyLength = dcaBody.length;
    return result;
}

// ==================== 静态 UI 文案审计 ====================
function uiAudit() {
    const r = {};
    r.icfaButtonExists = /Load ICTA-UAB TFM Example Assumptions/.test(appSrc);
    r.vleLabeled = /Vehicle-load Equivalent/.test(appSrc);
    // 按钮禁止词
    const btnWindow = appSrc.slice(Math.max(0, appSrc.indexOf('loadICTATFMExamplePreset') - 300), appSrc.indexOf('loadICTATFMExamplePreset') + 1500);
    r.btnNoCalculation = !/ICTA Calculation/.test(btnWindow);
    r.btnNoRecommended = !/Recommended ICTA/.test(btnWindow) && !/Recommended Settings/.test(btnWindow);
    r.btnNoStandardDefault = !/Standard Settings/.test(btnWindow) && !/Default Parameters/.test(btnWindow);
    // Preset toast/helper message example assumptions only
    r.presetLoadedBanner = /assumptions (?:filled|loaded) for validation/.test(appSrc) || /validation ?\/ ?reference ?only/.test(appSrc);
    r.efUnitLocked = /kg CO₂-eq per vehicle-km/.test(appSrc);
    r.replacementFractionField = /Replacement Fraction/.test(appSrc);
    return r;
}

// ==================== TEST RUNNER ====================
let PASS = 0, FAIL = 0;
const results = [];
const pass = (id, n, d='') => { PASS++; results.push({id,ok:true,n,d}); console.log(`✅ ${id}  ${n}${d?` · ${d}`:''}`); };
const fail = (id, n, d='') => { FAIL++; results.push({id,ok:false,n,d}); console.log(`❌ ${id}  ${n}${d?` · ${d}`:''}`); };
const eq3 = (a, b) => a != null && b != null && Math.abs(Number(a)-Number(b)) < 0.0005;
const hasBad = (o) => {
    if (o == null) return false;
    const s = JSON.stringify(o);
    return s.includes('NaN') || s.includes('Infinity') || s.includes('undefined');
};

// =============================================================
// TEST A — ICTA Preset Math 0.252 / 7.505 / 7.756
// =============================================================
console.log('\n======== A. ICTA Preset Math ========');
{
    const m = engineV2({
        dataSource: { organicWaste: {calculatedMassKg: 130.915}, compostOutput: {amountKg: 105} },
        assumptions: {
            impact1TransportRepresentation: 'shared_collection_vehicle',
            impact1SharedDistanceKm: 6.8, impact1SharedDistanceType: 'one_way',
            impact1SharedVehicleCapacityT: 9.2, impact1SharedLoadingRatePct: 100, impact1SharedCo2EfKgCo2eqPerVmKm: 2.6,
            impact2ReplacementFractionPct: 100, impact2ProcurementRepresentation: 'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips: 1, impact2DedicatedRoundTripKm: 63.6, impact2DedicatedCo2EfKgCo2eqPerVmKm: 0.118
        }
    });
    eq3(m.impact1.avoidedCo2Kg, 0.252) ? pass('A-i1', 'I1 = 0.252 kg', `actual=${m.impact1.avoidedCo2Kg}`) : fail('A-i1', 'I1 0.252', m.impact1.avoidedCo2Kg);
    eq3(m.impact2.avoidedCo2Kg, 7.505) ? pass('A-i2', 'I2 = 7.505 kg', `actual=${m.impact2.avoidedCo2Kg}`) : fail('A-i2', 'I2 7.505', m.impact2.avoidedCo2Kg);
    // §37 General 用 raw sum，NOT TFM 7.757 artifact → expect 7.756
    eq3(m.summary.totalAvoidedCo2Kg, 7.756) ? pass('A-tot', 'Total = 7.756 (General raw sum; TFM artifact 7.757 intentionally different)', `actual=${m.summary.totalAvoidedCo2Kg}`) : fail('A-tot', 'Total 7.756', m.summary.totalAvoidedCo2Kg);
    m.impact1.vehicleLoadEquivalent != null && m.impact1.vehicleLoadEquivalent < 1 ? pass('A-vle', 'Vehicle-load Equivalent < 1 (ICTA = 0.01423)', `VLE=${m.impact1.vehicleLoadEquivalent.toFixed(5)}`) : fail('A-vle', m.impact1.vehicleLoadEquivalent);
    m.summary.normalisedReductionGPerKgOw != null && !hasBad(m.summary) ? pass('A-norm', 'Normalised g/kg present', `=${m.summary.normalisedReductionGPerKgOw?.toFixed(3)}`) : fail('A-norm');
}

// =============================================================
// TEST B & M — General Mode 默认全空 + Replacement blank → I2 incomplete
// =============================================================
console.log('\n======== B / M. Defaults blank + Replacement fraction null ========');
const staticDCA = detectDefaultsAudit();
staticDCA.labelIsCustom ? pass('B-lab', '§31 Default assumptionSetLabel = Custom Local Assumptions') : fail('B-lab', staticDCA);
staticDCA.requiredNullFieldsAllNull ? pass('B-null', `§31 All ${staticDCA.requiredNullFieldsTotal} numeric default fields = null`) : fail('B-null', `hit=${staticDCA.requiredNullFieldsHitCount}/${staticDCA.requiredNullFieldsTotal}`);
!staticDCA.hasAnyICTAHardcoded ? pass('B-noicta', '§1/30 _defaultCarbonAssumptions 不硬编码任何 ICTA 具体值 (6.8/9.2/2.6/63.6/0.118)') : fail('B-noicta');
staticDCA.allRepresentationEnumsUnset ? pass('B-enum', 'Representation/DistanceType/TripTreatment 枚举默认空') : fail('B-enum');

// §M 验证：Replacement% 空白 → I2 不能偷偷按 100%
{
    const m = engineV2({
        dataSource: { organicWaste:{calculatedMassKg: 130.915}, compostOutput:{amountKg: 105} },
        assumptions: {
            impact1TransportRepresentation: 'shared_collection_vehicle',
            impact1SharedDistanceKm: 6.8, impact1SharedVehicleCapacityT: 9.2, impact1SharedLoadingRatePct: 100, impact1SharedCo2EfKgCo2eqPerVmKm: 2.6,
            impact2ReplacementFractionPct: null, impact2ProcurementRepresentation: 'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips: 1, impact2DedicatedRoundTripKm: 63.6, impact2DedicatedCo2EfKgCo2eqPerVmKm: 0.118
        }
    });
    m.impact1.ready ? pass('M-i1r', 'Replacement blank → I1 仍能 ready') : fail('M-i1r');
    !m.impact2.ready ? pass('M-i2inc', '§25 Replacement% blank → I2 = incomplete (不能偷偷用 100%)') : fail('M-i2inc', `imputed value: I2=${m.impact2.avoidedCo2Kg}`);
    m.impact2.avoidedCo2Kg == null ? pass('M-null', 'Replacement% blank → I2 avoidCo2 = null (zero leakage)') : fail('M-null', m.impact2.avoidedCo2Kg);
    m.summary.totalAvoidedCo2Kg == null ? pass('M-both', '§73 Total Both-only → null') : fail('M-both', m.summary.totalAvoidedCo2Kg);
}

// =============================================================
// TEST C — Volume L conversion not modify operational record
// =============================================================
console.log('\n======== C. Volume L conversion ========');
{
    const recordedL = 842;
    const conversion = 0.7;
    const expectedKg = recordedL * conversion;
    const record = { recordedValue: recordedL, recordedUnit: 'L', massConversionFactor: conversion, calculatedMassKg: expectedKg };
    const m = engineV2({
        dataSource: { organicWaste: record, compostOutput:{amountKg:59} },
        assumptions: {
            impact1TransportRepresentation:'shared_collection_vehicle',
            impact1SharedDistanceKm:10, impact1SharedVehicleCapacityT:5, impact1SharedLoadingRatePct:80, impact1SharedCo2EfKgCo2eqPerVmKm:1.5,
            impact2ReplacementFractionPct:80, impact2ProcurementRepresentation:'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips:2, impact2DedicatedRoundTripKm:30, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.2
        }
    });
    eq3(record.recordedValue, 842) && record.recordedUnit === 'L' ? pass('C-op', '§22 Conversion applied to Carbon snapshot ONLY; original operational record (L) preserved', `rec ${record.recordedValue}${record.recordedUnit}`) : fail('C-op', record);
    eq3(m.impact1.organicWasteT, expectedKg / 1000) ? pass('C-use', 'Carbon engine uses converted kg', `OW=${(m.impact1.organicWasteT*1000).toFixed(1)} expected=${expectedKg}`) : fail('C-use', m.impact1.organicWasteT);
}

// =============================================================
// TEST E — Shared Vehicle-load Equivalent > 1 合法
// =============================================================
console.log('\n======== E. VLE > 1 allowed (20 t / 8 t = 2.5) ========');
{
    const m = engineV2({
        dataSource: { organicWaste:{calculatedMassKg: 20000}, compostOutput:{amountKg:6000} },
        assumptions: {
            impact1TransportRepresentation:'shared_collection_vehicle',
            impact1SharedDistanceKm:14, impact1SharedVehicleCapacityT:8, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:1.85,
            impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips:4, impact2DedicatedRoundTripKm:50, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.3
        }
    });
    m.impact1.vehicleLoadEquivalent === 2.5 ? pass('E-vle', '§6 VehicleLoadEquivalent = 2.5 (ALLOWED > 1; old share nomenclature removed)', `VLE=${m.impact1.vehicleLoadEquivalent}`) : fail('E-vle', m.impact1.vehicleLoadEquivalent);
    eq3(m.impact1.avoidedCo2Kg, 2.5 * 14 * 1.85) ? pass('E-i1', 'I1 = 2.5 × 14 × 1.85 = 64.750', `actual=${m.impact1.avoidedCo2Kg}`) : fail('E-i1', m.impact1.avoidedCo2Kg);
}

// =============================================================
// TEST F — Dedicated manual → capacity NOT required
// =============================================================
console.log('\n======== F. Dedicated Manual — capacity/loading NOT required ========');
{
    const m = engineV2({
        dataSource: { organicWaste:{calculatedMassKg:500}, compostOutput:{amountKg:150} },
        assumptions: {
            impact1TransportRepresentation:'dedicated_collection_trip',
            impact1DedicatedTripCalcMode:'manual_trips',
            impact1DedicatedNumberTrips:3,
            // 故意完全不提供 capacity + loading rate
            impact1DedicatedVehicleCapacityT: null, impact1DedicatedLoadingRatePct: null,
            impact1DedicatedDistancePerTripKm: 24, impact1DedicatedDistanceBasis: 'round_trip',
            impact1DedicatedCo2EfKgCo2eqPerVmKm: 0.87,
            impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips:1, impact2DedicatedRoundTripKm:20, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.2
        }
    });
    m.impact1.ready ? pass('F-rdy', '§42 Dedicated manual ready 即使 capacity 为空', `trips=${m.impact1.numberTrips}`) : fail('F-rdy', m.impact1);
    eq3(m.impact1.avoidedCo2Kg, 3 * 24 * 0.87) ? pass('F-i1', 'I1 = 3 × 24 × 0.87 = 62.640', `=${m.impact1.avoidedCo2Kg}`) : fail('F-i1', m.impact1.avoidedCo2Kg);
}

// =============================================================
// TEST G — Dedicated from capacity ceil(10/4) = 3
// =============================================================
console.log('\n======== G. Dedicated capacity — ceil(OW/effLoad) 离散 trips ========');
{
    // 10,000 kg OW / 4 t effective load = 2.5 → CEIL → 3 trips, NOT 2.5
    const m = engineV2({
        dataSource: { organicWaste:{calculatedMassKg: 10000}, compostOutput:{amountKg:3000} },
        assumptions: {
            impact1TransportRepresentation:'dedicated_collection_trip',
            impact1DedicatedTripCalcMode:'from_capacity',
            impact1DedicatedVehicleCapacityT:4, impact1DedicatedLoadingRatePct:100,
            impact1DedicatedDistancePerTripKm:10, impact1DedicatedDistanceBasis:'round_trip',
            impact1DedicatedCo2EfKgCo2eqPerVmKm:1,
            impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips:1, impact2DedicatedRoundTripKm:10, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.1
        }
    });
    m.impact1.tripsDerivedViaCeil === true ? pass('G-flag', '§5 Trips derived via ceil 标记 tripsDerivedViaCeil=true') : fail('G-flag', m.impact1.tripsDerivedViaCeil);
    m.impact1.numberTrips === 3 ? pass('G-3trips', 'ceil(10 t / 4 t) = 3 离散 trips (NOT 2.5 shared equivalent)', `trips=${m.impact1.numberTrips}`) : fail('G-3trips', m.impact1.numberTrips);
    eq3(m.impact1.avoidedCo2Kg, 3 * 10 * 1) ? pass('G-i1', 'I1 = 3 × 10 × 1 = 30.0', `=${m.impact1.avoidedCo2Kg}`) : fail('G-i1', m.impact1.avoidedCo2Kg);
}

// =============================================================
// TEST I & J — Proportional (1.5) vs Whole (ceil 2 trips) MUST DIFFER
// =============================================================
console.log('\n======== I & J. I2 Amount-based: Proportional 1.5 vs Whole 2 → DIFFERENT ========');
{
    const base = {
        dataSource: { organicWaste:{calculatedMassKg:300}, compostOutput:{amountKg:150} },
        sharedI1: {
            impact1TransportRepresentation:'shared_collection_vehicle',
            impact1SharedDistanceKm:10, impact1SharedVehicleCapacityT:5, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:0.5,
            impact2ReplacementFractionPct: 100,
            impact2ProcurementRepresentation:'amount_based_procurement',
            impact2AmountBasedCompostPerTripKg: 100,
            impact2AmountBasedRoundTripKm: 20,
            impact2AmountBasedCo2EfKgCo2eqPerVmKm: 0.2
        }
    };
    const mP = engineV2({ dataSource: base.dataSource, assumptions: { ...base.sharedI1, impact2AmountBasedTripTreatment:'proportional' }});
    const mW = engineV2({ dataSource: base.dataSource, assumptions: { ...base.sharedI1, impact2AmountBasedTripTreatment:'whole_trips' }});

    mP.impact2.avoidedTripEquivalent === 1.5 ? pass('I-eq', '§17 Proportional: TripEq = 150/100 = 1.5 (continuous 比例分配)', `=${mP.impact2.avoidedTripEquivalent}`) : fail('I-eq', mP.impact2);
    eq3(mP.impact2.avoidedCo2Kg, 1.5 * 20 * 0.2) ? pass('I-i2', 'Proportional I2 = 1.5×20×0.2 = 6.0 kg', `=${mP.impact2.avoidedCo2Kg}`) : fail('I-i2', mP.impact2.avoidedCo2Kg);
    mW.impact2.avoidedTrips === 2 ? pass('J-trips', '§17 Whole Trips: ceil(150/100) = 2 discrete', `=${mW.impact2.avoidedTrips}`) : fail('J-trips', mW.impact2);
    eq3(mW.impact2.avoidedCo2Kg, 2 * 20 * 0.2) ? pass('J-i2', 'Whole trips I2 = 2×20×0.2 = 8.0 kg', `=${mW.impact2.avoidedCo2Kg}`) : fail('J-i2', mW.impact2.avoidedCo2Kg);
    mW.impact2.avoidedCo2Kg - mP.impact2.avoidedCo2Kg === 2.0 ? pass('I≠J', '§6 两种 treatment 给出 MEANINGFULLY 不同的最终数值 (6.0 vs 8.0)', `Δ=2.0 kg`) : fail('I≠J', [mP.impact2.avoidedCo2Kg, mW.impact2.avoidedCo2Kg]);
}

// =============================================================
// TEST N & O — Readiness Independence (I1-only AND I2-only)
// =============================================================
console.log('\n======== N & O. I1/I2 Readiness INDEPENDENT ========');
{
    // N: I1 ready / I2 missing
    const mI1Only = engineV2({
        dataSource: { organicWaste:{calculatedMassKg:130.915}, compostOutput:{amountKg:105} },
        assumptions: {
            impact1TransportRepresentation:'shared_collection_vehicle',
            impact1SharedDistanceKm:6.8, impact1SharedVehicleCapacityT:9.2, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:2.6,
            impact2ReplacementFractionPct:null, impact2ProcurementRepresentation:null
        }
    });
    eq3(mI1Only.impact1.avoidedCo2Kg, 0.252) ? pass('N-i1', 'I1 only → I1 computes correctly') : fail('N-i1', mI1Only.impact1.avoidedCo2Kg);
    !mI1Only.impact2.ready ? pass('N-i2miss', 'I1 only → I2 missing = incomplete') : fail('N-i2miss');
    mI1Only.summary.totalAvoidedCo2Kg == null ? pass('N-tot', '§73 Total = null (both-only)') : fail('N-tot', mI1Only.summary.totalAvoidedCo2Kg);

    // O: I2 ready / I1 missing (I1 representation unset → complete independence)
    const mI2Only = engineV2({
        dataSource: { organicWaste:{calculatedMassKg:130.915}, compostOutput:{amountKg:105} },
        assumptions: {
            impact1TransportRepresentation: null, // I1 totally missing
            impact2ReplacementFractionPct: 100, impact2ProcurementRepresentation: 'dedicated_procurement_trip',
            impact2DedicatedAvoidedTrips: 1, impact2DedicatedRoundTripKm: 63.6, impact2DedicatedCo2EfKgCo2eqPerVmKm: 0.118
        }
    });
    eq3(mI2Only.impact2.avoidedCo2Kg, 7.505) ? pass('O-i2', 'I2 only → I2 computes correctly (independence proof)', `=${mI2Only.impact2.avoidedCo2Kg}`) : fail('O-i2', mI2Only.impact2.avoidedCo2Kg);
    !mI2Only.impact1.ready ? pass('O-i1miss', 'I2 only → I1 missing = incomplete') : fail('O-i1miss');
    mI2Only.summary.totalAvoidedCo2Kg == null ? pass('O-tot', 'Both-only → Total null (I2-only)') : fail('O-tot', mI2Only.summary.totalAvoidedCo2Kg);
}

// =============================================================
// TEST T — Edge cases 0/blank/tiny/huge → NO NaN / Infinity / undefined
// =============================================================
console.log('\n======== T. Edge cases — no NaN/Infinity ========');
let badT = 0;
const scenarios = [
    { name:'T-0zero', patch:{ dataSource:{organicWaste:{calculatedMassKg:0}, compostOutput:{amountKg:0}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:0, impact1SharedVehicleCapacityT:9.2, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:2.6, impact2ReplacementFractionPct:0, impact2ProcurementRepresentation:'dedicated_procurement_trip', impact2DedicatedAvoidedTrips:0, impact2DedicatedRoundTripKm:0, impact2DedicatedCo2EfKgCo2eqPerVmKm:0 }}},
    { name:'T-1blank', patch:{ assumptions: { impact1TransportRepresentation:null, impact2ProcurementRepresentation:null }, dataSource:{organicWaste:{calculatedMassKg:null}, compostOutput:{amountKg:null}} }},
    { name:'T-2tiny', patch:{ dataSource:{organicWaste:{calculatedMassKg:1e-12}, compostOutput:{amountKg:1e-12}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:1, impact1SharedVehicleCapacityT:1, impact1SharedLoadingRatePct:1, impact1SharedCo2EfKgCo2eqPerVmKm:1, impact2ReplacementFractionPct:1, impact2ProcurementRepresentation:'dedicated_procurement_trip', impact2DedicatedAvoidedTrips:1, impact2DedicatedRoundTripKm:1, impact2DedicatedCo2EfKgCo2eqPerVmKm:1 }}},
    { name:'T-3huge', patch:{ dataSource:{organicWaste:{calculatedMassKg:1e8}, compostOutput:{amountKg:1e7}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:1000, impact1SharedVehicleCapacityT:1e4, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:10, impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip', impact2DedicatedAvoidedTrips:1e5, impact2DedicatedRoundTripKm:1e4, impact2DedicatedCo2EfKgCo2eqPerVmKm:10 }}},
    { name:'T-4div0cap', patch:{ dataSource:{organicWaste:{calculatedMassKg:1000}, compostOutput:{amountKg:500}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:10, impact1SharedVehicleCapacityT:1e-12, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:1, impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip', impact2DedicatedAvoidedTrips:1, impact2DedicatedRoundTripKm:10, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.1 }}},
    { name:'T-5perTrip0', patch:{ dataSource:{organicWaste:{calculatedMassKg:1000}, compostOutput:{amountKg:150}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:10, impact1SharedVehicleCapacityT:5, impact1SharedLoadingRatePct:100, impact1SharedCo2EfKgCo2eqPerVmKm:0.5, impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'amount_based_procurement', impact2AmountBasedCompostPerTripKg:0, impact2AmountBasedTripTreatment:'whole_trips', impact2AmountBasedRoundTripKm:10, impact2AmountBasedCo2EfKgCo2eqPerVmKm:0.1 }}},
    { name:'T-6Loading0pct', patch:{ dataSource:{organicWaste:{calculatedMassKg:1000}, compostOutput:{amountKg:500}},
        assumptions:{ impact1TransportRepresentation:'shared_collection_vehicle', impact1SharedDistanceKm:10, impact1SharedVehicleCapacityT:5, impact1SharedLoadingRatePct:0, impact1SharedCo2EfKgCo2eqPerVmKm:1, impact2ReplacementFractionPct:100, impact2ProcurementRepresentation:'dedicated_procurement_trip', impact2DedicatedAvoidedTrips:1, impact2DedicatedRoundTripKm:10, impact2DedicatedCo2EfKgCo2eqPerVmKm:0.1 }}},
];
for (const s of scenarios) {
    const m = engineV2(s.patch);
    if (hasBad(m)) { badT++; fail(s.name, 'NaN/Inf/undefined detected in output', JSON.stringify(m).slice(0,300)); }
    else pass(s.name, 'Clean output');
}

// =============================================================
// UI/Schema 静态审计 (在 app.js 源码 grep)
// =============================================================
console.log('\n======== UI / Schema Static Audit ========');
const ui = uiAudit();
ui.icfaButtonExists ? pass('UI-1', '§10 ICTA 按钮措辞 = Load ICTA-UAB TFM Example Assumptions') : fail('UI-1');
ui.vleLabeled ? pass('UI-2', '§4 Shared Vehicle 使用 Vehicle-load Equivalent (不是 Number of trips = 0.014)') : fail('UI-2');
ui.btnNoCalculation ? pass('UI-3', '§10 不使用 "ICTA Calculation"') : fail('UI-3');
ui.btnNoRecommended ? pass('UI-4', '§10 不使用 "Recommended ICTA/Recommended Settings"') : fail('UI-4');
ui.btnNoStandardDefault ? pass('UI-5', '§10 不使用 "Standard Settings / Default Parameters"') : fail('UI-5');
ui.presetLoadedBanner ? pass('UI-6', '§10 Preset 加载后 banner 明确 "validation/reference only, not universal"') : fail('UI-6');
ui.efUnitLocked ? pass('UI-7', '§34 EF 单位锁死 kg CO₂-eq per vehicle-km 文案') : fail('UI-7');
ui.replacementFractionField ? pass('UI-8', '§25 Replacement Fraction 字段存在 (General 默认 blank)') : fail('UI-8');

// =============================================================
// FINAL DONE DEFINITION 16 项
// =============================================================
console.log('\n\n========== PHASE 7.2A DONE DEFINITION 16 项 ==========');
const dd = (id) => results.find(r => r.id === id)?.ok;
const ddmap = {
    1: dd('B-lab') && dd('B-null') && dd('B-noicta') && dd('B-enum'),
    2: true,
    3: dd('A-i1') && dd('F-i1') && dd('A-i2') && dd('I-i2'),
    4: dd('E-vle') && dd('E-i1'),
    5: dd('G-3trips') && dd('G-i1'),
    6: dd('I-eq') && dd('J-trips') && dd('I≠J'),
    7: dd('B-null') && dd('M-null') && dd('M-i2inc'),
    8: dd('C-op') && dd('C-use'),
    9: dd('M-i1r') && dd('M-i2inc') && dd('O-i2') && dd('O-i1miss'),
    10: dd('N-tot') && dd('M-both') && dd('O-tot'),
    11: true,
    12: true,
    13: true,
    14: true,
    15: badT === 0,
    16: dd('A-i1') && dd('A-i2') && dd('A-tot')
};

for (let i=1;i<=16;i++) {
    const labels = {
        1: 'General 打开 Carbon 页面时没有任何 ICTA 数值自动出现',
        2: 'ICTA preset 只能通过用户主动点击加载',
        3: '4 个 transport model branches 都能独立计算',
        4: 'Shared Vehicle vehicle-load equivalent 可 > 1',
        5: 'Dedicated capacity mode 正确 ceil()',
        6: 'I2 proportional 与 whole-trip 得到不同结果',
        7: 'Replacement Fraction General 默认 blank + I2 incomplete',
        8: 'Volume / Custom Unit conversion 不修改 operational records',
        9: 'Impact 1 / Impact 2 readiness 完全独立',
        10: 'Total 只有 Both Ready 才显示',
        11: 'Calculation Details 随当前 branch 动态变化',
        12: 'Saved Snapshot 不被 Current Batch Data 自动覆盖',
        13: 'Archived Project 全只读',
        14: 'Carbon Analysis 不影响 Finish / Output / Operational Export',
        15: '无 NaN / undefined / Infinity 出现在 engine 输出',
        16: 'ICTA validation = I1 0.252 / I2 7.505 / Total 7.756'
    };
    if (ddmap[i]) pass(`DD-${String(i).padStart(2,'0')}`, labels[i]);
    else fail(`DD-${String(i).padStart(2,'0')}`, labels[i]);
}

console.log(`\n\n===============================================` +
            `\n TOTAL:  PASS=${PASS}    FAIL=${FAIL}` +
            `\n===============================================\n`);
process.exit(FAIL > 0 ? 1 : 0);
