import React, { useState, useEffect, useMemo } from 'react';
import { Package, TrendingUp, Clock, Truck, AlertCircle, BarChart3, Calendar, Plus, Trash2, Download, RefreshCw, Egg, Factory, Building2, Store, Settings, X, Cloud, CloudOff, Search, Shield, FileText, MapPin, Hash, Truck as TruckIcon, ClipboardCheck, CheckCircle2, Circle, Box, Boxes, Layers, Link2, Send, Zap } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, query, orderBy, where, limit 
} from 'firebase/firestore';
import { 
  getDatabase, ref as dbRef, get as dbGet, set as dbSet, push as dbPush, update as dbUpdate, onValue
} from 'firebase/database';

// ============ Firebase 설정 (선별포장) ============
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============ 🔗 자연 재고관리 Firebase (별도 프로젝트) ============
const inventoryFirebaseConfig = {
  apiKey: "AIzaSyCIxmWelX3kgI-axuJ3KOgI-iGDkyz0wno",
  databaseURL: "https://program-953e1-default-rtdb.firebaseio.com",
  projectId: "program-953e1"
};

// 두 번째 Firebase 앱 (자연재고관리) 초기화 - 이름 다르게
let inventoryDb = null;
try {
  const inventoryApp = getApps().find(a => a.name === 'inventory') 
    || initializeApp(inventoryFirebaseConfig, 'inventory');
  inventoryDb = getDatabase(inventoryApp);
} catch (e) {
  console.warn('자연재고관리 Firebase 초기화 실패:', e);
}

// ============ 본점 규격 ============
const HQ_GRADES = ['왕', '특', '대', '중'];
const HQ_PANS = ['5판', '4판', '3판', '2판', '1판'];

const PAN_PER_PALLET = {
  '왕': { '5판': 48, '4판': 60, '3판': 72, '2판': 108, '1판': 168 },
  '특': { '5판': 60, '4판': 72, '3판': 84, '2판': 120, '1판': 192 },
  '대': { '5판': 60, '4판': 72, '3판': 84, '2판': 120, '1판': 192 },
  '중': { '5판': 60, '4판': 72, '3판': 84, '2판': 120, '1판': 192 },
};

const buildDefaultHqSpecs = () => {
  const specs = [];
  HQ_GRADES.forEach(grade => {
    HQ_PANS.forEach(pan => {
      specs.push({
        id: `hq_${grade}_${pan}`,
        grade, pan, name: `${grade}${pan}`,
        panPerPallet: PAN_PER_PALLET[grade][pan]
      });
    });
  });
  return specs;
};

const DEFAULT_BR_PRODUCTS = [
  { id: 'br_cja_30', brand: '청정원', name: '동물복지 30구', packType: 'PT', perPack: 144, note: '코스트코' },
  { id: 'br_cja_25', brand: '청정원', name: '동물복지 25구', packType: 'BOX', perPack: 9 },
  { id: 'br_cja_20', brand: '청정원', name: '동물복지 20구', packType: 'BOX', perPack: 10 },
  { id: 'br_cja_15', brand: '청정원', name: '동물복지 15구', packType: 'BOX', perPack: 9 },
  { id: 'br_cj_25', brand: 'CJ', name: '깨끗한 계란 25구', packType: 'BOX', perPack: 6 },
  { id: 'br_cj_15', brand: 'CJ', name: '동물복지 15구', packType: 'BOX', perPack: 9 },
  { id: 'br_ha_25_no', brand: '하림', name: '무항생제 25구', packType: 'BOX', perPack: 8 },
  { id: 'br_ha_25_1', brand: '하림', name: '1등급 25구', packType: 'BOX', perPack: 8 },
];

// 🆕 부자재 카테고리
const MATERIAL_CATEGORIES = [
  { id: 'tray', name: '난좌', icon: '🥚' },
  { id: 'box', name: '박스', icon: '📦' },
  { id: 'label', name: '라벨/스티커', icon: '🏷️' },
  { id: 'tape', name: '테이프', icon: '📎' },
  { id: 'etc', name: '기타', icon: '🔧' },
];

// 부자재 단위
const MATERIAL_UNITS = ['개', '장', '롤', 'kg', 'm', 'EA'];

const DEFAULT_OUTBOUND_PARTNER_HQ = '모하지 (3PL)';

// 지점 출고처 (브랜드별)
const DEFAULT_BRANCH_PARTNERS = [
  '청정원', 'CJ', '하림', '코스트코', '직접 입력'
];

const pansToPallets = (pans, panPerPallet) => {
  if (!pans || !panPerPallet) return { pallets: 0, remainder: 0, decimal: 0 };
  const p = parseInt(pans);
  const pallets = Math.floor(p / panPerPallet);
  const remainder = p % panPerPallet;
  const decimal = +(p / panPerPallet).toFixed(2);
  return { pallets, remainder, decimal };
};

// ============ Lot 번호 생성 ============
// 형식: L-YYMMDD-001 (날짜별 순번)
const generateLotNo = (date, existingLots) => {
  const d = date.replace(/-/g, '').slice(2); // YYMMDD
  const todayLots = existingLots.filter(l => l.startsWith(`L-${d}-`));
  const seq = String(todayLots.length + 1).padStart(3, '0');
  return `L-${d}-${seq}`;
};

export default function EggProductionManager() {
  const [activeSite, setActiveSite] = useState('overview');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  
  const [records, setRecords] = useState([]);
  const [farms, setFarms] = useState([]); // 농장 마스터
  const [materials, setMaterials] = useState([]); // 🆕 부자재 마스터
  const [productMaterialMap, setProductMaterialMap] = useState({}); // 🆕 {productId/specId: [{materialId, quantity, perUnit: 'box'|'pan'|'pt'}]}
  const [hqSpecs, setHqSpecs] = useState(buildDefaultHqSpecs());
  const [brProducts, setBrProducts] = useState(DEFAULT_BR_PRODUCTS);
  const [showProductManager, setShowProductManager] = useState(false);
  const [showFarmManager, setShowFarmManager] = useState(false);
  const [showMaterialManager, setShowMaterialManager] = useState(false); // 🆕
  const [showTracer, setShowTracer] = useState(false);
  
  const [todayDate] = useState(new Date().toISOString().split('T')[0]);
  
  useEffect(() => {
    let unsubRecords;
    
    try {
      // 🚀 최적화: 최근 60일치 데이터만 로드 (역학조사 충분히 가능)
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      const cutoffDate = sixtyDaysAgo.toISOString().split('T')[0];
      
      unsubRecords = onSnapshot(
        query(
          collection(db, 'records'), 
          where('date', '>=', cutoffDate),
          orderBy('date', 'desc'),
          limit(2000)
        ),
        (snap) => {
          const loaded = [];
          snap.forEach(d => loaded.push({ id: d.id, ...d.data() }));
          setRecords(loaded);
          setOnline(true);
          setLoading(false);
        },
        (err) => { 
          console.error(err); 
          // 인덱스 에러나 호환성 문제 시 fallback (전체 로드)
          if (err.code === 'failed-precondition') {
            console.log('인덱스 없음 - 전체 로드로 fallback');
            unsubRecords = onSnapshot(
              query(collection(db, 'records'), orderBy('createdAt', 'desc'), limit(2000)),
              (snap) => {
                const loaded = [];
                snap.forEach(d => loaded.push({ id: d.id, ...d.data() }));
                setRecords(loaded);
                setOnline(true);
                setLoading(false);
              },
              (e) => { console.error(e); setOnline(false); setLoading(false); }
            );
          } else {
            setOnline(false); 
            setLoading(false);
          }
        }
      );
      
      // 🚀 최적화: 설정 데이터 병렬 로딩 (Promise.all)
      Promise.all([
        getDoc(doc(db, 'settings', 'hqSpecs')),
        getDoc(doc(db, 'settings', 'brProducts')),
        getDoc(doc(db, 'settings', 'farms')),
        getDoc(doc(db, 'settings', 'materials')),
        getDoc(doc(db, 'settings', 'productMaterialMap'))  // 🆕
      ]).then(([hqSnap, brSnap, farmSnap, matSnap, mapSnap]) => {
        if (hqSnap.exists() && hqSnap.data().specs) {
          setHqSpecs(hqSnap.data().specs);
        } else {
          setDoc(doc(db, 'settings', 'hqSpecs'), { specs: buildDefaultHqSpecs() });
        }
        
        if (brSnap.exists() && brSnap.data().products) {
          setBrProducts(brSnap.data().products);
        } else {
          setDoc(doc(db, 'settings', 'brProducts'), { products: DEFAULT_BR_PRODUCTS });
        }
        
        if (farmSnap.exists() && farmSnap.data().farms) {
          setFarms(farmSnap.data().farms);
        }
        
        if (matSnap.exists() && matSnap.data().materials) {
          setMaterials(matSnap.data().materials);
        }
        
        if (mapSnap.exists() && mapSnap.data().map) {
          setProductMaterialMap(mapSnap.data().map);
        }
        
        setSettingsLoaded(true);
      }).catch(e => {
        console.error('설정 로딩 오류:', e);
        setSettingsLoaded(true);
      });
      
    } catch (e) {
      console.error(e);
      setOnline(false);
      setLoading(false);
    }
    
    return () => { if (unsubRecords) unsubRecords(); };
  }, []);
  
  // 숫자 입력칸에서 휠 스크롤로 값이 변경되는 것 방지
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.target.type === 'number' && document.activeElement === e.target) {
        e.target.blur();
      }
    };
    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);
  
  // 🔗 자연재고관리 부자재 실시간 로딩
  const [inventoryItems, setInventoryItems] = useState({ main: { sub: [], commonSub: [] }, branch: { sub: [], commonSub: [] } });
  const [inventoryConnected, setInventoryConnected] = useState(false);
  
  useEffect(() => {
    if (!inventoryDb) return;
    
    try {
      const invRef = dbRef(inventoryDb, 'inventory');
      const unsub = onValue(invRef, (snap) => {
        const data = snap.val();
        if (data) {
          setInventoryItems({
            main: {
              sub: data.main?.sub || [],
              commonSub: data.main?.commonSub || []
            },
            branch: {
              sub: data.branch?.sub || [],
              commonSub: data.branch?.commonSub || []
            }
          });
          setInventoryConnected(true);
        }
      }, (err) => {
        console.warn('자연재고관리 연결 오류:', err);
        setInventoryConnected(false);
      });
      
      return () => unsub();
    } catch (e) {
      console.warn('자연재고관리 로딩 실패:', e);
    }
  }, []);
  
  const saveRecord = async (record) => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'records', record.id), record);
      return true;
    } catch (e) {
      alert('저장 오류: ' + e.message);
      return false;
    } finally { setSaving(false); }
  };
  
  const deleteRecord = async (record) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'records', record.id));
    } catch (e) { alert('삭제 오류: ' + e.message); }
  };
  
  // 🆕 출고 진행 상태 업데이트
  const updateShipmentStatus = async (record, statusKey, value, dateValue = '') => {
    const updated = {
      ...record,
      status: {
        ...(record.status || { shipped: true, shippedAt: record.createdAt }),
        [statusKey]: value,
        [`${statusKey === 'delivered' ? 'deliveredDate' 
            : statusKey === 'ecountEntered' ? 'ecountDate'
            : statusKey === 'reported' ? 'reportedDate' 
            : ''}`]: dateValue || (value ? todayDate : '')
      }
    };
    try {
      await setDoc(doc(db, 'records', record.id), updated);
    } catch (e) { alert('상태 업데이트 오류: ' + e.message); }
  };
  
  const saveHqSpecs = async (specs) => {
    try { await setDoc(doc(db, 'settings', 'hqSpecs'), { specs }); setHqSpecs(specs); }
    catch (e) { alert('저장 오류'); }
  };
  
  const saveBrProducts = async (products) => {
    try { await setDoc(doc(db, 'settings', 'brProducts'), { products }); setBrProducts(products); }
    catch (e) { alert('저장 오류'); }
  };
  
  const saveFarms = async (newFarms) => {
    try { await setDoc(doc(db, 'settings', 'farms'), { farms: newFarms }); setFarms(newFarms); }
    catch (e) { alert('저장 오류'); }
  };
  
  // 🆕 부자재 마스터 저장
  const saveMaterials = async (newMaterials) => {
    try { await setDoc(doc(db, 'settings', 'materials'), { materials: newMaterials }); setMaterials(newMaterials); }
    catch (e) { alert('저장 오류'); }
  };
  
  // 🆕 제품-부자재 매핑 저장
  const saveProductMaterialMap = async (newMap) => {
    try { 
      await setDoc(doc(db, 'settings', 'productMaterialMap'), { map: newMap }); 
      setProductMaterialMap(newMap); 
    } catch (e) { alert('저장 오류'); }
  };
  
  // 🆕 자연재고관리에 자동 출고
  // usageList: [{ inventoryItemId, branch (main|branch), cat (sub|commonSub), name, qty, unit }]
  // memo: 출고 메모 (예: "선별포장 자동 - 청정원 25구 9박스 생산")
  const sendToInventory = async (usageList, memo, productionDate) => {
    if (!inventoryDb) {
      throw new Error('자연재고관리 시스템에 연결할 수 없습니다.');
    }
    
    if (usageList.length === 0) {
      throw new Error('출고할 부자재가 없습니다.');
    }
    
    const today = productionDate || new Date().toISOString().split('T')[0];
    const errors = [];
    const successes = [];
    
    for (const item of usageList) {
      try {
        // 1. 현재 재고 조회
        const itemPath = `inventory/${item.branch}/${item.cat}`;
        const snap = await dbGet(dbRef(inventoryDb, itemPath));
        const currentArray = snap.val() || [];
        
        // 해당 ID 찾기
        const idx = currentArray.findIndex(x => x && x.id === item.inventoryItemId);
        if (idx === -1) {
          errors.push(`${item.name}: 자연재고관리에서 찾을 수 없음`);
          continue;
        }
        
        const before = parseFloat(currentArray[idx].stock) || 0;
        const after = before - item.qty;
        
        // 2. 재고 업데이트
        await dbUpdate(
          dbRef(inventoryDb, `${itemPath}/${idx}`),
          { stock: after }
        );
        
        // 3. logs에 기록 추가
        const logId = `${Date.now()}_${Math.random()}`;
        const logEntry = {
          after,
          before,
          branch: item.branch,
          cat: item.cat,
          date: today,
          id: logId,
          name: item.name,
          note: memo || '선별포장 시스템 자동 출고',
          qty: item.qty,
          type: '출고',
          unit: item.unit || 'EA',
          writer: '선별포장 자동'
        };
        
        // logs는 배열이므로 push로 추가
        await dbPush(dbRef(inventoryDb, 'logs'), logEntry);
        
        successes.push({ ...item, before, after });
      } catch (e) {
        errors.push(`${item.name}: ${e.message}`);
      }
    }
    
    return { successes, errors };
  };
  
  // ============ 폼 ============
  const [incomingForm, setIncomingForm] = useState({
    date: todayDate, farmId: '', supplier: '', eggMark: '', vehicle: '',
    layingDates: [todayDate], // 산란일 (여러 개 가능)
    grades: { '왕': '', '특': '', '대': '', '중': '' },
    note: '',
    specialNotes: '',  // 🆕 특이사항 (긴 메모)
    photos: []  // 🆕 사진 (base64 배열)
  });
  
  const [productionForm, setProductionForm] = useState({
    date: todayDate, startTime: '', endTime: '', worker: '',
    sourceLots: [], // 사용한 입고 Lot들
    items: [{ specId: '', pans: '', quantity: '', boxes: '' }],
    loss: '', note: ''
  });
  
  const [shipmentForm, setShipmentForm] = useState({
    date: todayDate,
    partner: DEFAULT_OUTBOUND_PARTNER_HQ,
    vehicle: '', driver: '',
    sourceProductions: [], // 출고된 생산 기록 ID들 (자동 또는 수동)
    items: [{ specId: '', pans: '', boxes: '', quantity: '' }],
    note: ''
  });
  
  // 본점/지점 전환 시 출고처 자동 변경
  useEffect(() => {
    setShipmentForm(prev => ({
      ...prev,
      partner: activeSite === 'hq' ? DEFAULT_OUTBOUND_PARTNER_HQ : ''
    }));
  }, [activeSite]);
  
  // ============ 입고 ============
  const handleIncomingSubmit = async () => {
    if (!incomingForm.supplier) {
      alert('공급처(농장명)를 입력해주세요.');
      return;
    }
    
    // 등급별 수량 정리 (값이 입력된 것만)
    const gradeQuantities = {};
    let totalQuantity = 0;
    HQ_GRADES.forEach(grade => {
      const q = parseInt(incomingForm.grades[grade]) || 0;
      if (q > 0) {
        gradeQuantities[grade] = q;
        totalQuantity += q;
      }
    });
    
    if (totalQuantity === 0) {
      alert('최소 1개 등급에 수량을 입력해주세요.');
      return;
    }
    
    // Lot 번호 자동 생성
    const existingLots = records.filter(r => r.type === 'incoming' && r.lotNo).map(r => r.lotNo);
    const lotNo = generateLotNo(incomingForm.date, existingLots);
    
    const farm = farms.find(f => f.id === incomingForm.farmId);
    
    const record = {
      id: `inc_${Date.now()}`, type: 'incoming', site: activeSite,
      date: incomingForm.date, 
      lotNo,
      farmId: incomingForm.farmId || null,
      farmName: farm?.name || incomingForm.supplier,
      farmRegNo: farm?.regNo || '',
      farmAddress: farm?.address || '',
      farmCode: farm?.farmCode || '',
      supplier: incomingForm.supplier,
      eggMark: incomingForm.eggMark,
      vehicle: incomingForm.vehicle,
      layingDates: (incomingForm.layingDates || []).filter(d => d),  // 🆕 산란일 배열
      quantity: totalQuantity,                // 총 수량 (호환성)
      gradeQuantities: gradeQuantities,       // 🆕 등급별 수량
      unit: '판',
      remainingPans: totalQuantity,
      note: incomingForm.note, 
      specialNotes: incomingForm.specialNotes || '',  // 🆕 특이사항
      photos: incomingForm.photos || [],              // 🆕 사진
      createdAt: new Date().toISOString()
    };
    if (await saveRecord(record)) {
      setIncomingForm({ 
        date: todayDate, farmId: '', supplier: '', eggMark: '', vehicle: '', 
        layingDates: [todayDate],
        grades: { '왕': '', '특': '', '대': '', '중': '' },
        note: '',
        specialNotes: '',
        photos: []
      });
      const gradeStr = Object.entries(gradeQuantities).map(([g, q]) => `${g}란 ${q.toLocaleString()}판`).join(', ');
      alert(`입고 저장 완료\nLot 번호: ${lotNo}\n농장: ${record.farmName}\n수량: ${gradeStr}\n합계: ${totalQuantity.toLocaleString()}판`);
    }
  };
  
  // 입고 시 농장 선택하면 자동 채우기
  const onSelectFarm = (farmId) => {
    const farm = farms.find(f => f.id === farmId);
    if (farm) {
      setIncomingForm(prev => ({
        ...prev,
        farmId,
        supplier: farm.name,
      }));
    } else {
      setIncomingForm(prev => ({ ...prev, farmId: '' }));
    }
  };
  
  // ============ 생산 ============
  const addProductionItem = () => {
    setProductionForm(prev => ({
      ...prev, items: [...prev.items, { specId: '', pans: '', quantity: '', boxes: '' }]
    }));
  };
  
  const updateProductionItem = (idx, field, value) => {
    setProductionForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    }));
  };
  
  const removeProductionItem = (idx) => {
    setProductionForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };
  
  const toggleSourceLot = (lotNo) => {
    setProductionForm(prev => ({
      ...prev,
      sourceLots: prev.sourceLots.includes(lotNo)
        ? prev.sourceLots.filter(l => l !== lotNo)
        : [...prev.sourceLots, lotNo]
    }));
  };
  
  const handleProductionSubmit = async () => {
    if (!productionForm.startTime || !productionForm.endTime) {
      alert('시작/종료 시간을 입력해주세요.');
      return;
    }
    
    if (productionForm.sourceLots.length === 0) {
      if (!confirm('⚠️ 사용한 원란 Lot이 선택되지 않았습니다.\n역학조사 시 추적이 어려울 수 있습니다.\n그래도 계속하시겠습니까?')) {
        return;
      }
    }
    
    const validItems = productionForm.items.filter(it => {
      if (!it.specId) return false;
      if (activeSite === 'hq') return it.pans;
      return it.boxes || it.quantity;
    });
    
    if (validItems.length === 0) {
      alert('최소 1개 이상의 규격과 수량을 입력해주세요.');
      return;
    }
    
    const start = new Date(`${productionForm.date}T${productionForm.startTime}`);
    const end = new Date(`${productionForm.date}T${productionForm.endTime}`);
    const minutes = Math.round((end - start) / 60000);
    if (minutes <= 0) { alert('종료시간이 시작시간보다 늦어야 합니다.'); return; }
    
    const processedItems = validItems.map(it => {
      if (activeSite === 'hq') {
        const spec = hqSpecs.find(s => s.id === it.specId);
        const pans = parseInt(it.pans) || 0;
        const { pallets, remainder, decimal } = pansToPallets(pans, spec?.panPerPallet);
        return {
          specId: it.specId, pans, pallets,
          palletDecimal: decimal, remainderPans: remainder,
          panPerPallet: spec?.panPerPallet || 0
        };
      } else {
        const product = brProducts.find(p => p.id === it.specId);
        const boxes = parseInt(it.boxes) || 0;
        let quantity = parseInt(it.quantity) || 0;
        if (boxes && !quantity && product?.perPack) quantity = boxes * product.perPack;
        return {
          specId: it.specId, boxes, quantity,
          packType: product?.packType || 'BOX', perPack: product?.perPack || 0
        };
      }
    });
    
    const totalPans = processedItems.reduce((s, it) => s + (it.pans || 0), 0);
    const totalPalletsDecimal = +processedItems.reduce((s, it) => s + (it.palletDecimal || 0), 0).toFixed(2);
    const totalQuantity = processedItems.reduce((s, it) => s + (it.quantity || 0), 0);
    const totalBoxes = processedItems.reduce((s, it) => s + (it.boxes || 0), 0);
    const loss = parseInt(productionForm.loss) || 0;
    const mainMetric = activeSite === 'hq' ? totalPans : totalQuantity;
    const perHour = minutes > 0 ? Math.round((mainMetric / minutes) * 60) : 0;
    
    const record = {
      id: `prod_${Date.now()}`, type: 'production', site: activeSite,
      date: productionForm.date, startTime: productionForm.startTime, endTime: productionForm.endTime,
      minutes,
      sourceLots: productionForm.sourceLots,  // 🆕 사용한 입고 Lot
      items: processedItems,
      totalPans: activeSite === 'hq' ? totalPans : 0,
      totalPalletsDecimal: activeSite === 'hq' ? totalPalletsDecimal : 0,
      totalQuantity: activeSite === 'branch' ? totalQuantity : 0,
      totalBoxes: activeSite === 'branch' ? totalBoxes : 0,
      loss, perHour,
      worker: productionForm.worker, note: productionForm.note,
      createdAt: new Date().toISOString()
    };
    
    if (await saveRecord(record)) {
      setProductionForm({
        date: todayDate, startTime: '', endTime: '', worker: '',
        sourceLots: [],
        items: [{ specId: '', pans: '', quantity: '', boxes: '' }], loss: '', note: ''
      });
      const msg = activeSite === 'hq' 
        ? `생산 완료\n총 ${totalPans}판 / ${totalPalletsDecimal} 파렛\n사용 Lot: ${productionForm.sourceLots.join(', ') || '없음'}`
        : `생산 완료\n총 ${totalQuantity.toLocaleString()}개 / ${totalBoxes}박스\n사용 Lot: ${productionForm.sourceLots.join(', ') || '없음'}`;
      alert(msg);
    }
  };
  
  // ============ 출고 ============
  const addShipmentItem = () => {
    setShipmentForm(prev => ({
      ...prev, items: [...prev.items, { specId: '', pans: '', boxes: '', quantity: '' }]
    }));
  };
  
  const updateShipmentItem = (idx, field, value) => {
    setShipmentForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === idx ? { ...item, [field]: value } : item)
    }));
  };
  
  const removeShipmentItem = (idx) => {
    setShipmentForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };
  
  const handleShipmentSubmit = async () => {
    const validItems = shipmentForm.items.filter(it => {
      if (!it.specId) return false;
      if (activeSite === 'hq') return it.pans;
      return it.boxes;
    });
    
    if (validItems.length === 0) { alert('최소 1개 이상의 출고 품목을 입력해주세요.'); return; }
    
    const processedItems = validItems.map(it => {
      if (activeSite === 'hq') {
        const spec = hqSpecs.find(s => s.id === it.specId);
        const pans = parseInt(it.pans) || 0;
        const { pallets, remainder, decimal } = pansToPallets(pans, spec?.panPerPallet);
        return {
          specId: it.specId, pans, pallets,
          palletDecimal: decimal, remainderPans: remainder,
          panPerPallet: spec?.panPerPallet || 0
        };
      } else {
        const product = brProducts.find(p => p.id === it.specId);
        const boxes = parseInt(it.boxes) || 0;
        const quantity = product?.perPack ? boxes * product.perPack : (parseInt(it.quantity) || 0);
        return {
          specId: it.specId, boxes, quantity,
          packType: product?.packType || 'BOX', perPack: product?.perPack || 0
        };
      }
    });
    
    const totalPans = processedItems.reduce((s, it) => s + (it.pans || 0), 0);
    const totalPalletsDecimal = +processedItems.reduce((s, it) => s + (it.palletDecimal || 0), 0).toFixed(2);
    const totalQuantity = processedItems.reduce((s, it) => s + (it.quantity || 0), 0);
    const totalBoxes = processedItems.reduce((s, it) => s + (it.boxes || 0), 0);
    
    const record = {
      id: `ship_${Date.now()}`, type: 'shipment', site: activeSite,
      date: shipmentForm.date, partner: shipmentForm.partner || (activeSite === 'hq' ? DEFAULT_OUTBOUND_PARTNER_HQ : ''),
      vehicle: shipmentForm.vehicle,
      driver: shipmentForm.driver,
      items: processedItems,
      totalPans: activeSite === 'hq' ? totalPans : 0,
      totalPalletsDecimal: activeSite === 'hq' ? totalPalletsDecimal : 0,
      totalQuantity, totalBoxes,
      note: shipmentForm.note,
      // 🆕 진행 상태 추적 (4단계)
      status: {
        shipped: true,                  // 1단계: 출고 완료 (자동)
        shippedAt: new Date().toISOString(),
        delivered: false,               // 2단계: 납품 확정
        deliveredDate: '',              // 납품 일자
        ecountEntered: false,           // 3단계: 이카운트 입력
        ecountDate: '',                 // 이카운트 입력 일자
        reported: false,                // 4단계: 신고 완료
        reportedDate: '',               // 신고 일자
      },
      createdAt: new Date().toISOString()
    };
    
    if (await saveRecord(record)) {
      setShipmentForm({
        date: todayDate, 
        partner: activeSite === 'hq' ? DEFAULT_OUTBOUND_PARTNER_HQ : '',
        vehicle: '', driver: '', sourceProductions: [],
        items: [{ specId: '', pans: '', boxes: '', quantity: '' }], note: ''
      });
      alert('출고 저장 완료');
    }
  };
  
  // ============ 통계 ============
  const getStatsForSite = (site) => {
    const siteRecords = site === 'all' ? records : records.filter(r => r.site === site);
    const today = siteRecords.filter(r => r.date === todayDate);
    
    const todayIncoming = today.filter(r => r.type === 'incoming').reduce((s, r) => s + r.quantity, 0);
    const todayProduction = today.filter(r => r.type === 'production');
    const todayShipments = today.filter(r => r.type === 'shipment');
    
    const todayPans = todayProduction.reduce((s, r) => s + (r.totalPans || 0), 0);
    const todayPallets = +todayProduction.reduce((s, r) => s + (r.totalPalletsDecimal || 0), 0).toFixed(2);
    const todayShipPans = todayShipments.reduce((s, r) => s + (r.totalPans || 0), 0);
    const todayShipPallets = +todayShipments.reduce((s, r) => s + (r.totalPalletsDecimal || 0), 0).toFixed(2);
    const todayProduced = todayProduction.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const todayBoxes = todayProduction.reduce((s, r) => s + (r.totalBoxes || 0), 0);
    const todayShipment = todayShipments.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const todayShipBoxes = todayShipments.reduce((s, r) => s + (r.totalBoxes || 0), 0);
    
    const todayLoss = todayProduction.reduce((s, r) => s + r.loss, 0);
    const todayMinutes = todayProduction.reduce((s, r) => s + r.minutes, 0);
    const todayPerHour = todayProduction.length > 0 
      ? Math.round(todayProduction.reduce((s, r) => s + r.perHour, 0) / todayProduction.length) : 0;
    
    const totalIncoming = siteRecords.filter(r => r.type === 'incoming').reduce((s, r) => s + r.quantity, 0);
    const totalProduced = siteRecords.filter(r => r.type === 'production').reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalPansAll = siteRecords.filter(r => r.type === 'production').reduce((s, r) => s + (r.totalPans || 0), 0);
    const totalPalletsAll = +siteRecords.filter(r => r.type === 'production').reduce((s, r) => s + (r.totalPalletsDecimal || 0), 0).toFixed(2);
    const totalLoss = siteRecords.filter(r => r.type === 'production').reduce((s, r) => s + r.loss, 0);
    const totalShipped = siteRecords.filter(r => r.type === 'shipment').reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalShipBoxes = siteRecords.filter(r => r.type === 'shipment').reduce((s, r) => s + (r.totalBoxes || 0), 0);
    const totalBoxesAll = siteRecords.filter(r => r.type === 'production').reduce((s, r) => s + (r.totalBoxes || 0), 0);
    
    const todayLossRate = todayPans + todayProduced + todayLoss > 0 
      ? ((todayLoss / (todayPans + todayProduced + todayLoss)) * 100).toFixed(2) : 0;
    const totalLossRate = totalPansAll + totalProduced + totalLoss > 0 
      ? ((totalLoss / (totalPansAll + totalProduced + totalLoss)) * 100).toFixed(2) : 0;
    
    return {
      todayIncoming, todayPans, todayPallets, todayShipPans, todayShipPallets,
      todayProduced, todayBoxes, todayShipment, todayShipBoxes,
      todayLoss, todayMinutes, todayPerHour, todayLossRate,
      todayProductionCount: todayProduction.length,
      totalIncoming, totalProduced, totalPansAll, totalPalletsAll,
      totalLoss, totalShipped, totalShipBoxes, totalBoxesAll, totalLossRate
    };
  };
  
  const hqStats = useMemo(() => getStatsForSite('hq'), [records, todayDate]);
  const brStats = useMemo(() => getStatsForSite('branch'), [records, todayDate]);
  const allStats = useMemo(() => {
    const base = getStatsForSite('all');
    
    // 이번 달 통계 추가
    const month = todayDate.slice(0, 7); // YYYY-MM
    const monthRecs = records.filter(r => r.date && r.date.startsWith(month));
    const monthIncoming = monthRecs.filter(r => r.type === 'incoming').reduce((s, r) => s + (r.quantity || 0), 0);
    const monthProductionCount = monthRecs.filter(r => r.type === 'production').length;
    const monthShipmentCount = monthRecs.filter(r => r.type === 'shipment').length;
    const monthProds = monthRecs.filter(r => r.type === 'production');
    const monthLoss = monthProds.reduce((s, r) => s + (r.loss || 0), 0);
    const monthProduced = monthProds.reduce((s, r) => s + (r.totalQuantity || r.totalPans * 30 || 0), 0);
    const avgLossRate = monthProduced > 0 ? ((monthLoss / monthProduced) * 100).toFixed(2) : '0';
    
    return {
      ...base,
      monthlyIncoming: monthIncoming,
      monthlyProduction: monthProductionCount,
      monthlyShipment: monthShipmentCount,
      avgLossRate: avgLossRate
    };
  }, [records, todayDate]);
  const currentStats = activeSite === 'hq' ? hqStats : activeSite === 'branch' ? brStats : allStats;
  
  const getWeeklyData = (site) => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayRecs = records.filter(r => r.date === dateStr && (site === 'all' || r.site === site));
      const prod = dayRecs.filter(r => r.type === 'production');
      const pans = prod.reduce((s, r) => s + (r.totalPans || 0), 0);
      const quantity = prod.reduce((s, r) => s + (r.totalQuantity || 0), 0);
      const loss = prod.reduce((s, r) => s + r.loss, 0);
      const minutes = prod.reduce((s, r) => s + r.minutes, 0);
      const mainValue = site === 'hq' ? pans : quantity;
      days.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        생산: mainValue, 로스: loss, 판수: pans, 개수: quantity,
        시간당: minutes > 0 ? Math.round((mainValue / minutes) * 60) : 0
      });
    }
    return days;
  };
  
  const getItemStats = (site) => {
    const siteRecs = records.filter(r => r.type === 'production' && r.site === site);
    const agg = {};
    siteRecs.forEach(r => {
      (r.items || []).forEach(item => {
        if (!agg[item.specId]) agg[item.specId] = { specId: item.specId, pans: 0, pallets: 0, quantity: 0, boxes: 0 };
        agg[item.specId].pans += item.pans || 0;
        agg[item.specId].pallets += item.palletDecimal || 0;
        agg[item.specId].quantity += item.quantity || 0;
        agg[item.specId].boxes += item.boxes || 0;
      });
    });
    Object.values(agg).forEach(v => v.pallets = +v.pallets.toFixed(2));
    return Object.values(agg);
  };
  
  const specMap = useMemo(() => {
    const m = {};
    [...hqSpecs, ...brProducts].forEach(s => { m[s.id] = s; });
    return m;
  }, [hqSpecs, brProducts]);
  
  const specLabel = (id) => {
    const s = specMap[id];
    if (!s) return '?';
    return s.brand ? `${s.brand} ${s.name}` : s.name;
  };
  
  // 입고 Lot 리스트 (최근 30일)
  const recentLots = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split('T')[0];
    return records
      .filter(r => r.type === 'incoming' && r.lotNo && r.date >= cutoff)
      .sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [records]);
  
  const exportCSV = () => {
    let csv = '\uFEFF날짜,사업장,구분,Lot번호,농장,난각표시,차량,상세,규격/제품,판수,파렛,개수,박스,로스,작업시간,비고\n';
    const sorted = [...records].sort((a,b) => a.date.localeCompare(b.date));
    sorted.forEach(r => {
      const siteName = r.site === 'hq' ? '본점' : '지점';
      if (r.type === 'incoming') {
        csv += `${r.date},${siteName},원란입고,${r.lotNo||''},${r.farmName||r.supplier},${r.eggMark||''},${r.vehicle||''},,,${r.quantity}판,,,,,,"${r.note||''}"\n`;
      } else if (r.type === 'production') {
        const lots = (r.sourceLots || []).join('|');
        (r.items || []).forEach(item => {
          csv += `${r.date},${siteName},생산,${lots},,,,${r.worker||''} ${r.startTime}~${r.endTime},${specLabel(item.specId)},${item.pans||0},${item.palletDecimal||0},${item.quantity||0},${item.boxes||0},,${r.minutes}분,"${r.note||''}"\n`;
        });
        if (r.loss > 0) csv += `${r.date},${siteName},로스,,,,,,,,,,,${r.loss},,\n`;
      } else if (r.type === 'shipment') {
        (r.items || []).forEach(item => {
          csv += `${r.date},${siteName},출고,,,,${r.vehicle||''},${r.partner||'모하지'} ${r.driver||''},${specLabel(item.specId)},${item.pans||0},${item.palletDecimal||0},${item.quantity||0},${item.boxes||0},,,"${r.note||''}"\n`;
        });
      }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `계란생산기록_${todayDate}.csv`; a.click();
  };
  
  const fmt = (n) => (n || 0).toLocaleString('ko-KR');
  const fmtD = (n) => (n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  
  const tabs = [
    { id: 'dashboard', label: '대시보드', icon: BarChart3 },
    { id: 'incoming', label: '원란 입고', icon: Package },
    { id: 'production', label: '생산 기록', icon: Factory },
    { id: 'shipment', label: activeSite === 'hq' ? '출고 (모하지)' : '출고 (브랜드별)', icon: Truck },
    { id: 'materials', label: '부자재', icon: Boxes },
    { id: 'reporting', label: '신고 관리', icon: ClipboardCheck },
    { id: 'history', label: '전체 기록', icon: Calendar },
  ];
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg mb-4 mx-auto">
            <Egg className="w-8 h-8 text-white animate-pulse" strokeWidth={2.5} />
          </div>
          <RefreshCw className="w-6 h-6 text-amber-600 animate-spin mx-auto mb-2" />
          <p className="text-stone-700 font-bold">계란 생산 관리 시스템</p>
          <p className="text-xs text-stone-500 mt-1">데이터 불러오는 중...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b-2 border-amber-600 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-2.5 md:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
              <Egg className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm md:text-lg font-bold text-stone-900 tracking-tight truncate">계란 생산 관리</h1>
              <p className="text-[10px] md:text-xs text-stone-500 flex items-center gap-1 md:gap-1.5">
                <span className="hidden md:inline">{todayDate} ({['일','월','화','수','목','금','토'][new Date().getDay()]})</span>
                <span className="md:hidden">{todayDate.slice(5)} ({['일','월','화','수','목','금','토'][new Date().getDay()]})</span>
                {online ? (
                  <span className="flex items-center gap-0.5 text-green-600"><Cloud className="w-3 h-3" />실시간</span>
                ) : (
                  <span className="flex items-center gap-0.5 text-red-500"><CloudOff className="w-3 h-3" />오프라인</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <button onClick={() => setShowTracer(true)} 
              className="flex items-center gap-1 px-2 md:px-3 py-2 bg-red-50 hover:bg-red-100 rounded-lg text-xs md:text-sm font-semibold text-red-700 transition border border-red-200" 
              title="역학조사 / Lot 추적">
              <Shield className="w-4 h-4" />
              <span className="hidden md:inline">역학조사</span>
            </button>
            {activeSite !== 'overview' && (
              <button onClick={() => setShowProductManager(true)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-600" title="제품/규격 관리">
                <Settings className="w-5 h-5" />
              </button>
            )}
            <button onClick={exportCSV} className="hidden md:flex items-center gap-2 px-3 py-2 bg-stone-100 hover:bg-stone-200 rounded-lg text-sm font-medium text-stone-700 transition">
              <Download className="w-4 h-4" />엑셀
            </button>
          </div>
        </div>
        
        {/* 사이트 선택 - 모바일 최적화 */}
        <div className="max-w-7xl mx-auto px-3 md:px-4 pb-2 flex gap-1.5 md:gap-2 overflow-x-auto">
          <SiteButton active={activeSite === 'overview'} onClick={() => setActiveSite('overview')} icon={BarChart3} label="종합" labelFull="전체 종합" />
          <SiteButton active={activeSite === 'hq'} onClick={() => { setActiveSite('hq'); setActiveTab('dashboard'); }} icon={Building2} label="본점" labelFull="본점 (식자재)" />
          <SiteButton active={activeSite === 'branch'} onClick={() => { setActiveSite('branch'); setActiveTab('dashboard'); }} icon={Store} label="지점" labelFull="지점 (제품)" />
        </div>
        
        {activeSite !== 'overview' && (
          <div className="max-w-7xl mx-auto px-3 md:px-4 flex gap-0.5 md:gap-1 overflow-x-auto border-t border-stone-100 scrollbar-hide">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 md:px-3 py-2 md:py-2.5 text-xs md:text-sm font-medium whitespace-nowrap border-b-2 transition ${
                    activeTab === tab.id ? 'border-amber-600 text-amber-700' : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>
      
      <main className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-5">
        {activeSite === 'overview' && (
          <OverviewDashboard 
            hqStats={hqStats} brStats={brStats} allStats={allStats}
            records={records} specMap={specMap}
            getWeeklyData={getWeeklyData} getItemStats={getItemStats} fmt={fmt} fmtD={fmtD}
            onOpenTracer={() => setShowTracer(true)}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'dashboard' && (
          <SiteDashboard 
            site={activeSite} stats={currentStats}
            weeklyData={getWeeklyData(activeSite)}
            itemStats={getItemStats(activeSite)}
            specMap={specMap} fmt={fmt} fmtD={fmtD}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'incoming' && (
          <IncomingForm 
            form={incomingForm} setForm={setIncomingForm}
            onSubmit={handleIncomingSubmit} saving={saving}
            farms={farms} onSelectFarm={onSelectFarm}
            onOpenFarmManager={() => setShowFarmManager(true)}
            todayRecords={records.filter(r => r.type === 'incoming' && r.date === todayDate && r.site === activeSite)}
            onDelete={deleteRecord} site={activeSite} fmt={fmt}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'production' && (
          <ProductionForm 
            form={productionForm} setForm={setProductionForm}
            items={productionForm.items}
            onAddItem={addProductionItem} onUpdateItem={updateProductionItem} onRemoveItem={removeProductionItem}
            onSubmit={handleProductionSubmit} saving={saving}
            site={activeSite}
            hqSpecs={hqSpecs} brProducts={brProducts} specMap={specMap}
            todayRecords={records.filter(r => r.type === 'production' && r.date === todayDate && r.site === activeSite)}
            onDelete={deleteRecord} specLabel={specLabel}
            onOpenManager={() => setShowProductManager(true)}
            recentLots={recentLots}
            onToggleLot={toggleSourceLot}
            materials={materials}
            productMaterialMap={productMaterialMap}
            inventoryItems={inventoryItems}
            inventoryConnected={inventoryConnected}
            onSendToInventory={sendToInventory}
            fmt={fmt} fmtD={fmtD}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'shipment' && (
          <ShipmentForm 
            form={shipmentForm} setForm={setShipmentForm}
            items={shipmentForm.items}
            onAddItem={addShipmentItem} onUpdateItem={updateShipmentItem} onRemoveItem={removeShipmentItem}
            onSubmit={handleShipmentSubmit} saving={saving}
            site={activeSite}
            hqSpecs={hqSpecs} brProducts={brProducts} specMap={specMap}
            todayRecords={records.filter(r => r.type === 'shipment' && r.date === todayDate && r.site === activeSite)}
            onDelete={deleteRecord} specLabel={specLabel}
            onOpenManager={() => setShowProductManager(true)}
            fmt={fmt} fmtD={fmtD}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'materials' && (
          <MaterialsView 
            materials={materials} records={records} site={activeSite}
            onSaveMaterials={saveMaterials}
            onSaveRecord={saveRecord}
            onDeleteRecord={deleteRecord}
            todayDate={todayDate}
            hqSpecs={hqSpecs} brProducts={brProducts}
            productMaterialMap={productMaterialMap}
            onSaveMap={saveProductMaterialMap}
            inventoryItems={inventoryItems}
            inventoryConnected={inventoryConnected}
            fmt={fmt}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'reporting' && (
          <ReportingView 
            records={records.filter(r => r.type === 'shipment' && r.site === activeSite)}
            site={activeSite} specLabel={specLabel}
            onUpdateStatus={updateShipmentStatus}
            todayDate={todayDate}
            fmt={fmt} fmtD={fmtD}
          />
        )}
        
        {activeSite !== 'overview' && activeTab === 'history' && (
          <HistoryView 
            records={records.filter(r => r.site === activeSite)}
            site={activeSite} specLabel={specLabel} onDelete={deleteRecord}
            onExport={exportCSV} fmt={fmt} fmtD={fmtD}
          />
        )}
      </main>
      
      {showProductManager && (
        <ProductManager 
          site={activeSite} hqSpecs={hqSpecs} brProducts={brProducts}
          onSaveHq={saveHqSpecs} onSaveBr={saveBrProducts}
          onClose={() => setShowProductManager(false)}
        />
      )}
      
      {showFarmManager && (
        <FarmManager 
          farms={farms} onSave={saveFarms}
          onClose={() => setShowFarmManager(false)}
        />
      )}
      
      {showTracer && (
        <TraceabilityModal 
          records={records} farms={farms} specLabel={specLabel}
          fmt={fmt} fmtD={fmtD}
          onClose={() => setShowTracer(false)}
          onOpenFarmManager={() => { setShowTracer(false); setShowFarmManager(true); }}
        />
      )}
      
      <style>{`
        .input-field {
          width: 100%; padding: 0.65rem 0.9rem;
          border: 1.5px solid #e7e5e4; border-radius: 0.6rem;
          font-size: 0.95rem; transition: all 0.2s; background: white;
        }
        .input-field:focus {
          outline: none; border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
        }
        select.input-field { cursor: pointer; }
        /* 숫자 입력칸 휠 스크롤로 값 변경 방지 */
        input[type="number"] {
          -moz-appearance: textfield;
        }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        /* 스크롤바 숨김 */
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        
        /* 모바일에서 input 더 크게 (터치 편의) */
        @media (max-width: 768px) {
          .input-field {
            padding: 0.75rem 0.85rem;
            font-size: 16px; /* iOS 자동 확대 방지 */
          }
        }
      `}</style>
    </div>
  );
}

// ============ 컴포넌트들 ============
function SiteButton({ active, onClick, icon: Icon, label, labelFull }) {
  return (
    <button onClick={onClick} className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-2 rounded-lg text-xs md:text-sm font-semibold transition whitespace-nowrap ${
      active ? 'bg-amber-500 text-white shadow-sm' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
    }`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="md:hidden">{label}</span>
      <span className="hidden md:inline">{labelFull || label}</span>
    </button>
  );
}

function OverviewDashboard({ hqStats, brStats, allStats, records, specMap, getWeeklyData, getItemStats, fmt, fmtD, onOpenTracer }) {
  const hqWeekly = useMemo(() => getWeeklyData('hq'), [records]);
  const brWeekly = useMemo(() => getWeeklyData('branch'), [records]);
  
  // 최근 7일 입고 농장 통계
  const recentFarms = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];
    const incomings = records.filter(r => r.type === 'incoming' && r.date >= cutoff);
    const agg = {};
    incomings.forEach(r => {
      const key = r.farmName || r.supplier || '미지정';
      if (!agg[key]) agg[key] = { name: key, count: 0, quantity: 0, lastDate: '', lots: [] };
      agg[key].count++;
      agg[key].quantity += r.quantity;
      if (r.date > agg[key].lastDate) agg[key].lastDate = r.date;
      if (r.lotNo) agg[key].lots.push(r.lotNo);
    });
    return Object.values(agg).sort((a,b) => b.quantity - a.quantity);
  }, [records]);
  
  return (
    <div className="space-y-4 md:space-y-5">
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4 md:p-6 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-1 opacity-90 text-xs md:text-sm">
          <BarChart3 className="w-4 h-4" />대표님 종합 대시보드
        </div>
        <h2 className="text-lg md:text-2xl font-bold mb-3 md:mb-4">전체 사업장 오늘의 현황</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <BigStat label="총 입고" value={fmt(allStats.todayIncoming)} unit="판" />
          <BigStat label="생산" value={`${fmt(hqStats.todayPans)}판 / ${fmt(brStats.todayProduced)}개`} unit={`본점 ${fmtD(hqStats.todayPallets)}PLT · 지점 ${fmt(brStats.todayBoxes)}박스`} />
          <BigStat label="총 로스" value={fmt(allStats.todayLoss)} unit={`개 (${allStats.todayLossRate}%)`} />
          <BigStat label="출고" value={`${fmtD(hqStats.todayShipPallets)}PLT / ${fmt(brStats.todayShipBoxes)}박스`} unit={`본점:모하지 · 지점:브랜드별`} />
        </div>
      </div>
      
      {/* 🆕 역학조사 빠른 접근 카드 */}
      <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-5 border-2 border-red-200">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-red-900">역학조사 추적 시스템</h3>
            </div>
            <p className="text-sm text-stone-700 mb-3">
              조류독감 등 의심 상황 발생 시, <b>농장명/Lot 번호/날짜</b>로 입고 → 생산 → 출고까지 즉시 추적할 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-white px-2.5 py-1 rounded-full border border-red-200 text-red-700">최근 7일 입고: <b>{recentFarms.length}개 농장</b></span>
              <span className="bg-white px-2.5 py-1 rounded-full border border-red-200 text-red-700">총 Lot 등록: <b>{records.filter(r => r.type === 'incoming' && r.lotNo).length}건</b></span>
            </div>
          </div>
          <button onClick={onOpenTracer} className="flex-shrink-0 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-md">
            <Search className="w-4 h-4" />추적 시작
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SiteCard icon={Building2} title="본점 (식자재)" color="emerald" stats={hqStats} fmt={fmt} fmtD={fmtD} siteType="hq" />
        <SiteCard icon={Store} title="지점 (제품)" color="indigo" stats={brStats} fmt={fmt} fmtD={fmtD} siteType="branch" />
      </div>
      
      {/* 🆕 빠른 통계 행 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <QuickStat 
          icon={Calendar} 
          label="이번 달 누적" 
          value={`${fmt(allStats.monthlyIncoming || 0)}판`} 
          sub="입고" 
          color="blue" 
        />
        <QuickStat 
          icon={Factory} 
          label="이번 달 생산" 
          value={`${fmt(allStats.monthlyProduction || 0)}`} 
          sub="회" 
          color="green" 
        />
        <QuickStat 
          icon={AlertCircle} 
          label="평균 로스율" 
          value={`${allStats.avgLossRate || '0'}%`} 
          sub="이번 달" 
          color="red" 
        />
        <QuickStat 
          icon={Truck} 
          label="이번 달 출고" 
          value={`${fmt(allStats.monthlyShipment || 0)}`} 
          sub="회" 
          color="amber" 
        />
      </div>
      
      {/* 🆕 최근 7일 입고 농장 현황 */}
      {recentFarms.length > 0 && (
        <div className="bg-white rounded-xl p-5 border border-stone-200">
          <h3 className="font-bold text-stone-900 mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-stone-600" />최근 7일 입고 농장 ({recentFarms.length}곳)
          </h3>
          <div className="space-y-2">
            {recentFarms.slice(0, 8).map((f, i) => (
              <div key={f.name} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium text-stone-800">{f.name}</div>
                  <div className="text-xs text-stone-500">최근 입고: {f.lastDate} · {f.count}건</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-stone-900">{fmt(f.quantity)}판</div>
                  <div className="text-xs text-stone-500">{f.lots.slice(-2).join(', ') || '-'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 border border-stone-200">
          <h3 className="font-bold text-stone-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-600" />본점 최근 7일 (판수)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hqWeekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" stroke="#78716c" fontSize={11} />
              <YAxis stroke="#78716c" fontSize={11} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e7e5e4', borderRadius: '8px', fontSize: '12px' }} formatter={(v) => `${fmt(v)}판`} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="판수" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl p-5 border border-stone-200">
          <h3 className="font-bold text-stone-900 mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-indigo-600" />지점 최근 7일 (개수)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={brWeekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" stroke="#78716c" fontSize={11} />
              <YAxis stroke="#78716c" fontSize={11} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e7e5e4', borderRadius: '8px', fontSize: '12px' }} formatter={(v) => `${fmt(v)}개`} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="개수" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      <div>
        <h3 className="text-lg font-bold text-stone-900 mb-3 flex items-center gap-2">
          <div className="w-1 h-5 bg-amber-500 rounded"></div>전체 누적 현황
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Package} label="총 입고" value={fmt(allStats.totalIncoming)} unit="판" color="blue" />
          <StatCard icon={Factory} label="본점 생산" value={`${fmt(hqStats.totalPansAll)}판`} unit={`${fmtD(hqStats.totalPalletsAll)} 파렛`} color="green" />
          <StatCard icon={Factory} label="지점 생산" value={`${fmt(brStats.totalProduced)}개`} unit={`${fmt(brStats.totalBoxesAll)} 박스`} color="green" />
          <StatCard icon={AlertCircle} label="총 로스" value={fmt(allStats.totalLoss)} unit={`개 (${allStats.totalLossRate}%)`} color="red" />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ItemRanking title="본점 규격별 생산량 TOP" icon={Building2} color="emerald" items={getItemStats('hq')} specMap={specMap} fmt={fmt} fmtD={fmtD} siteType="hq" />
        <ItemRanking title="지점 제품별 생산량 TOP" icon={Store} color="indigo" items={getItemStats('branch')} specMap={specMap} fmt={fmt} fmtD={fmtD} siteType="branch" />
      </div>
    </div>
  );
}

function SiteDashboard({ site, stats, weeklyData, itemStats, specMap, fmt, fmtD }) {
  const siteLabel = site === 'hq' ? '본점 (식자재)' : '지점 (제품)';
  const ItemIcon = site === 'hq' ? Building2 : Store;
  const isHq = site === 'hq';
  
  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex items-center gap-2 text-stone-700">
        <ItemIcon className="w-5 h-5 text-amber-600" />
        <h2 className="font-bold text-base md:text-lg">{siteLabel} 대시보드</h2>
      </div>
      
      <div>
        <h3 className="text-xs md:text-sm font-bold text-stone-600 mb-2 md:mb-3 uppercase tracking-wide">오늘의 현황</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <StatCard icon={Package} label="입고" value={fmt(stats.todayIncoming)} unit="판" color="blue" />
          {isHq ? (
            <StatCard icon={Factory} label="생산" value={`${fmt(stats.todayPans)}판`} unit={`${fmtD(stats.todayPallets)} 파렛`} color="green" />
          ) : (
            <StatCard icon={Factory} label="생산" value={fmt(stats.todayProduced)} unit={`개 / ${fmt(stats.todayBoxes)}박스`} color="green" />
          )}
          <StatCard icon={AlertCircle} label="로스" value={fmt(stats.todayLoss)} unit={`개 (${stats.todayLossRate}%)`} color="red" />
          {isHq ? (
            <StatCard icon={Truck} label="출고 (모하지)" value={`${fmtD(stats.todayShipPallets)} PLT`} unit={`${fmt(stats.todayShipPans)}판`} color="amber" />
          ) : (
            <StatCard icon={Truck} label="출고 (브랜드별)" value={fmt(stats.todayShipBoxes)} unit={`박스 / ${fmt(stats.todayShipment)}개`} color="amber" />
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
        <InfoCard icon={Clock} label="오늘 작업시간" value={`${Math.floor(stats.todayMinutes / 60)}시간 ${stats.todayMinutes % 60}분`} sub={`작업 ${stats.todayProductionCount}회`} />
        <InfoCard icon={TrendingUp} label="시간당 평균" value={fmt(stats.todayPerHour)} sub={isHq ? '판 / 시간' : '개 / 시간'} />
        {isHq ? (
          <InfoCard icon={Egg} label="누적 생산" value={`${fmt(stats.totalPansAll)}판`} sub={`${fmtD(stats.totalPalletsAll)} 파렛`} />
        ) : (
          <InfoCard icon={Egg} label="누적 생산" value={fmt(stats.totalProduced)} sub={`개 / ${fmt(stats.totalBoxesAll)}박스`} />
        )}
      </div>
      
      <div className="bg-white rounded-xl p-5 border border-stone-200">
        <h3 className="font-bold text-stone-900 mb-4">최근 7일 생산 현황 {isHq ? '(판수)' : '(개수)'}</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={weeklyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis dataKey="date" stroke="#78716c" fontSize={12} />
            <YAxis stroke="#78716c" fontSize={12} />
            <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e7e5e4', borderRadius: '8px' }} formatter={v => isHq ? `${fmt(v)}판` : `${fmt(v)}개`} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="생산" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="로스" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {itemStats.length > 0 && (
        <ItemRanking title={`누적 ${isHq ? '규격' : '제품'}별 생산량`} icon={ItemIcon} color={isHq ? 'emerald' : 'indigo'} items={itemStats} specMap={specMap} fmt={fmt} fmtD={fmtD} siteType={site} />
      )}
    </div>
  );
}

function ItemRanking({ title, icon: Icon, color, items, specMap, fmt, fmtD, siteType }) {
  const isHq = siteType === 'hq';
  const sorted = [...items].sort((a, b) => (isHq ? b.pans - a.pans : b.quantity - a.quantity));
  const max = isHq ? (sorted[0]?.pans || 1) : (sorted[0]?.quantity || 1);
  const colorMap = { emerald: 'bg-emerald-500', indigo: 'bg-indigo-500' };
  
  return (
    <div className="bg-white rounded-xl p-5 border border-stone-200">
      <h3 className="font-bold text-stone-900 mb-4 flex items-center gap-2">
        <Icon className="w-5 h-5 text-stone-600" />{title}
      </h3>
      {sorted.length === 0 ? (
        <div className="text-center py-8 text-stone-400 text-sm">아직 데이터가 없습니다</div>
      ) : (
        <div className="space-y-2.5">
          {sorted.slice(0, 10).map((item, i) => {
            const spec = specMap[item.specId];
            const label = spec ? (spec.brand ? `${spec.brand} - ${spec.name}` : spec.name) : item.specId;
            const value = isHq ? item.pans : item.quantity;
            const pct = (value / max) * 100;
            return (
              <div key={item.specId}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-stone-700">{i + 1}. {label}</span>
                  <span className="text-sm font-bold text-stone-900">
                    {isHq ? <>{fmt(item.pans)}판 <span className="text-xs text-stone-500 font-normal">/ {fmtD(item.pallets)}PLT</span></> : <>{fmt(item.quantity)}개 <span className="text-xs text-stone-500 font-normal">/ {item.boxes}박스</span></>}
                  </span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className={`h-full ${colorMap[color]} rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SiteCard({ icon: Icon, title, color, stats, fmt, fmtD, siteType }) {
  const colors = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'bg-emerald-500' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', icon: 'bg-indigo-500' },
  };
  const c = colors[color];
  const isHq = siteType === 'hq';
  
  return (
    <div className="bg-white rounded-xl p-5 border border-stone-200">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 ${c.icon} rounded-lg flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <h3 className="font-bold text-stone-900">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`${c.bg} rounded-lg p-3`}>
          <div className="text-xs text-stone-600 mb-0.5">오늘 생산</div>
          {isHq ? (
            <>
              <div className={`text-lg font-bold ${c.text}`}>{fmt(stats.todayPans)}판</div>
              <div className="text-xs text-stone-500">{fmtD(stats.todayPallets)} 파렛</div>
            </>
          ) : (
            <>
              <div className={`text-lg font-bold ${c.text}`}>{fmt(stats.todayProduced)}개</div>
              <div className="text-xs text-stone-500">{fmt(stats.todayBoxes)}박스</div>
            </>
          )}
        </div>
        <div className="bg-stone-50 rounded-lg p-3">
          <div className="text-xs text-stone-600 mb-0.5">오늘 로스</div>
          <div className="text-lg font-bold text-red-600">{fmt(stats.todayLoss)}</div>
          <div className="text-xs text-stone-500">{stats.todayLossRate}%</div>
        </div>
      </div>
      <div className="pt-3 border-t border-stone-100 grid grid-cols-3 gap-2 text-center text-xs">
        <div><div className="text-stone-500">시간당</div><div className="font-bold text-stone-800">{fmt(stats.todayPerHour)}</div></div>
        <div><div className="text-stone-500">작업시간</div><div className="font-bold text-stone-800">{Math.floor(stats.todayMinutes/60)}h {stats.todayMinutes%60}m</div></div>
        <div>
          <div className="text-stone-500">{isHq ? '출고 파렛' : '출고 박스'}</div>
          <div className="font-bold text-stone-800">{isHq ? `${fmtD(stats.todayShipPallets)} PLT` : fmt(stats.todayShipBoxes)}</div>
        </div>
      </div>
    </div>
  );
}

function BigStat({ label, value, unit }) {
  return (
    <div className="bg-white/15 backdrop-blur rounded-xl p-2 md:p-3">
      <div className="text-[10px] md:text-xs opacity-90 mb-0.5 md:mb-1">{label}</div>
      <div className="text-xs md:text-lg font-bold leading-tight break-words">{value}</div>
      <div className="text-[10px] md:text-xs opacity-75 mt-0.5">{unit}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, unit, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white rounded-xl p-3 md:p-4 border border-stone-200 hover:shadow-md transition">
      <div className="flex items-start justify-between mb-1.5 md:mb-2">
        <span className="text-[10px] md:text-xs text-stone-500 font-medium">{label}</span>
        <div className={`w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="text-base md:text-xl font-bold text-stone-900 leading-tight break-words">{value}</div>
      <div className="text-[10px] md:text-xs text-stone-500 mt-0.5">{unit}</div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white rounded-xl p-3 md:p-4 border border-stone-200">
      <div className="flex items-center gap-2 text-stone-500 text-xs md:text-sm mb-1.5 md:mb-2">
        <Icon className="w-4 h-4" />{label}
      </div>
      <div className="text-base md:text-xl font-bold text-stone-900 break-words">{value}</div>
      <div className="text-[10px] md:text-xs text-stone-500 mt-0.5">{sub}</div>
    </div>
  );
}

function QuickStat({ icon: Icon, label, value, sub, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <div className={`p-2.5 md:p-3 rounded-xl border ${colors[color]}`}>
      <div className="flex items-center gap-1.5 mb-1 opacity-80 text-[10px] md:text-xs">
        <Icon className="w-3.5 h-3.5" />{label}
      </div>
      <div className="text-base md:text-xl font-bold leading-tight">{value}</div>
      <div className="text-[10px] md:text-xs opacity-70 mt-0.5">{sub}</div>
    </div>
  );
}

function FormCard({ title, icon: Icon, color, children }) {
  const colors = { blue: 'bg-blue-500', green: 'bg-green-500', amber: 'bg-amber-500' };
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 md:p-5">
      <h2 className="text-sm md:text-base font-bold text-stone-900 mb-3 md:mb-4 flex items-center gap-2 md:gap-3">
        <div className={`w-8 h-8 md:w-9 md:h-9 ${colors[color]} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-4 h-4 text-white" />
        </div>{title}
      </h2>
      {children}
    </div>
  );
}

function Field({ label, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs md:text-sm font-semibold text-stone-700 mb-1 md:mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

// 🆕 입고 폼 (역학조사 정보 포함)
function IncomingForm({ form, setForm, onSubmit, saving, farms, onSelectFarm, onOpenFarmManager, todayRecords, onDelete, site, fmt }) {
  const totalPans = HQ_GRADES.reduce((sum, g) => sum + (parseInt(form.grades?.[g]) || 0), 0);
  
  const updateGrade = (grade, value) => {
    setForm({ ...form, grades: { ...form.grades, [grade]: value } });
  };
  
  // 산란일 다중
  const layingDates = form.layingDates || [form.date];
  const addLayingDate = () => setForm({ ...form, layingDates: [...layingDates, form.date] });
  const updateLayingDate = (idx, value) => {
    const newDates = [...layingDates];
    newDates[idx] = value;
    setForm({ ...form, layingDates: newDates });
  };
  const removeLayingDate = (idx) => {
    if (layingDates.length <= 1) return;
    setForm({ ...form, layingDates: layingDates.filter((_, i) => i !== idx) });
  };
  
  // 사진 업로드
  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const photos = form.photos || [];
    if (photos.length + files.length > 5) {
      alert('사진은 최대 5장까지 가능합니다.');
      return;
    }
    
    files.forEach(file => {
      // 1MB 제한
      if (file.size > 1024 * 1024) {
        alert(`${file.name}\n파일 크기가 1MB를 초과합니다. 더 작은 사진을 선택해주세요.`);
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (ev) => {
        // 이미지 압축
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxWidth = 1200;
          const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          
          setForm(prev => ({
            ...prev,
            photos: [...(prev.photos || []), { 
              data: compressed, 
              name: file.name,
              uploadedAt: new Date().toISOString()
            }]
          }));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    
    e.target.value = ''; // 같은 파일 다시 선택 가능
  };
  
  const removePhoto = (idx) => {
    setForm({ ...form, photos: form.photos.filter((_, i) => i !== idx) });
  };
  
  const photos = form.photos || [];
  
  return (
    <FormCard title={`원란 입고 - ${site === 'hq' ? '본점' : '지점'}`} icon={Package} color="blue">
      
      {/* 안내 박스 - 더 깔끔하게 */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2">
        <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800">
          <b>역학조사 추적</b> · 농장명, 난각표시는 정확하게 기록해주세요. 차량번호는 모를 때 비워두셔도 됩니다.
        </div>
      </div>
      
      {/* 1. 기본 정보 (날짜 + 농장) */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">1</span>
          기본 정보
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="입고 날짜">
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field" />
          </Field>
          
          <Field label="등록 농장 선택 (선택)">
            <div className="flex gap-2">
              <select value={form.farmId} onChange={e => onSelectFarm(e.target.value)} className="input-field flex-1">
                <option value="">직접 입력</option>
                {farms.map(f => (
                  <option key={f.id} value={f.id}>{f.name} {f.farmCode ? `(${f.farmCode})` : ''}</option>
                ))}
              </select>
              <button type="button" onClick={onOpenFarmManager} className="px-3 py-2 bg-stone-100 hover:bg-stone-200 rounded-lg text-stone-600" title="농장 관리">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </Field>
          
          <Field label="농장명 / 공급처" required>
            <input type="text" value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} placeholder="예: 00농장" className="input-field" />
          </Field>
          
          <Field label="난각 표시" required>
            <input type="text" value={form.eggMark} onChange={e => setForm({...form, eggMark: e.target.value})} placeholder="예: 1206 M3FDS 2" className="input-field font-mono" />
          </Field>
          
          <Field label="운반 차량번호 (선택)">
            <input type="text" value={form.vehicle} onChange={e => setForm({...form, vehicle: e.target.value})} placeholder="모르면 빈칸" className="input-field" />
          </Field>
        </div>
      </div>
      
      {/* 2. 산란일 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">2</span>
          산란일 <span className="text-xs font-normal text-stone-500">(여러 날짜 가능)</span>
        </h3>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="space-y-2">
            {layingDates.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-amber-700 font-bold w-8 flex-shrink-0">#{idx + 1}</span>
                <input type="date" value={d} onChange={e => updateLayingDate(idx, e.target.value)} className="input-field flex-1" />
                {layingDates.length > 1 && (
                  <button type="button" onClick={() => removeLayingDate(idx)} className="p-2 text-stone-400 hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addLayingDate} 
            className="w-full mt-2 py-2 border-2 border-dashed border-amber-400 hover:border-amber-500 hover:bg-white text-amber-700 rounded-lg text-sm font-semibold flex items-center justify-center gap-1 transition">
            <Plus className="w-4 h-4" />산란일 추가 (혼합 입고시)
          </button>
        </div>
      </div>
      
      {/* 3. 등급별 수량 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">3</span>
          등급별 입고 수량 <span className="text-red-500">*</span>
          <span className="ml-auto text-xs font-normal text-stone-500">합계: <b className="text-base text-blue-700">{fmt(totalPans)}판</b></span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          {HQ_GRADES.map(grade => {
            const colorMap = {
              '왕': 'bg-purple-50 border-purple-300 text-purple-900',
              '특': 'bg-amber-50 border-amber-300 text-amber-900',
              '대': 'bg-emerald-50 border-emerald-300 text-emerald-900',
              '중': 'bg-sky-50 border-sky-300 text-sky-900',
            };
            return (
              <div key={grade} className={`p-3 rounded-lg border-2 ${colorMap[grade]}`}>
                <label className="block text-xs font-bold mb-1 opacity-80">{grade}란</label>
                <input type="number" value={form.grades?.[grade] || ''} onChange={e => updateGrade(grade, e.target.value)}
                  placeholder="0" className="w-full px-2 py-1.5 bg-white border border-current/30 rounded text-base md:text-lg font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-current/20"
                  inputMode="numeric" />
                <div className="text-[10px] mt-1 opacity-60">판</div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 4. 특이사항 + 사진 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full text-xs flex items-center justify-center font-bold">4</span>
          특이사항 / 사진 <span className="text-xs font-normal text-stone-500">(선택)</span>
        </h3>
        <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl space-y-3">
          <Field label="간단 비고">
            <input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="짧은 메모" className="input-field" />
          </Field>
          
          <Field label="특이사항 상세">
            <textarea 
              value={form.specialNotes || ''} 
              onChange={e => setForm({...form, specialNotes: e.target.value})}
              placeholder="예: 일부 파각란 발견, 운송 중 깨짐, 농장에서 별도 표시 등 자세한 내용을 작성하세요"
              rows={3}
              className="input-field resize-none"
            />
          </Field>
          
          {/* 사진 업로드 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs md:text-sm font-semibold text-stone-700">
                사진 첨부 <span className="text-xs font-normal text-stone-500">({photos.length}/5)</span>
              </label>
              {photos.length < 5 && (
                <label className="cursor-pointer px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-lg text-xs font-semibold text-blue-700 flex items-center gap-1">
                  📷 사진 추가
                  <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                </label>
              )}
            </div>
            
            {photos.length === 0 ? (
              <label className="cursor-pointer block p-6 border-2 border-dashed border-stone-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-lg text-center transition">
                <div className="text-3xl mb-1">📷</div>
                <div className="text-sm font-semibold text-stone-600">사진 첨부하기</div>
                <div className="text-xs text-stone-500 mt-0.5">최대 5장 · 1MB 이하</div>
                <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
              </label>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {photos.map((p, idx) => (
                  <div key={idx} className="relative group aspect-square">
                    <img src={p.data} alt="" className="w-full h-full object-cover rounded-lg border border-stone-200" />
                    <button 
                      type="button" 
                      onClick={() => removePhoto(idx)}
                      className="absolute top-1 right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 md:opacity-100 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 안내 */}
      <div className="mb-4 p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-600">
        💡 저장하면 <b>Lot 번호가 자동 생성</b>됩니다 (예: L-260425-001)
      </div>
      
      {/* 등록 버튼 */}
      <button onClick={onSubmit} disabled={saving || totalPans === 0} 
        className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-stone-300 disabled:to-stone-300 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-md text-base">
        <Plus className="w-5 h-5" />{saving ? '저장 중...' : `입고 등록 ${totalPans > 0 ? `(총 ${fmt(totalPans)}판)` : ''}`}
      </button>
      
      <TodayList 
        records={todayRecords} title="오늘 입고 내역" onDelete={onDelete}
        columns={[
          { header: 'Lot', render: r => <span className="font-mono text-xs text-blue-600 font-bold">{r.lotNo || '-'}</span> },
          { header: '농장', render: r => (
            <div>
              <div className="font-medium text-stone-800">{r.farmName || r.supplier}</div>
              {r.layingDates && r.layingDates.length > 0 && (
                <div className="text-xs text-amber-700 mt-0.5">
                  🥚 산란: {r.layingDates.map(d => d.slice(5).replace('-', '/')).join(', ')}
                </div>
              )}
              {r.specialNotes && (
                <div className="text-xs text-orange-700 mt-0.5 line-clamp-1" title={r.specialNotes}>
                  📌 {r.specialNotes}
                </div>
              )}
              {r.photos && r.photos.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {r.photos.slice(0, 3).map((p, i) => (
                    <img 
                      key={i} 
                      src={p.data} 
                      alt="" 
                      className="w-8 h-8 object-cover rounded border border-stone-200 cursor-pointer"
                      onClick={() => {
                        const w = window.open();
                        if (w) w.document.write(`<img src="${p.data}" style="max-width:100%;height:auto;" />`);
                      }}
                    />
                  ))}
                  {r.photos.length > 3 && (
                    <div className="w-8 h-8 bg-stone-100 rounded border border-stone-200 flex items-center justify-center text-xs text-stone-600 font-bold">
                      +{r.photos.length - 3}
                    </div>
                  )}
                </div>
              )}
            </div>
          )},
          { header: '난각', render: r => <span className="font-mono text-xs text-stone-600">{r.eggMark || '-'}</span> },
          { header: '차량', render: r => <span className="text-xs text-stone-600">{r.vehicle || '-'}</span> },
          { header: '등급별 수량', render: r => (
            <div className="text-xs space-y-0.5">
              {r.gradeQuantities ? (
                Object.entries(r.gradeQuantities).map(([g, q]) => (
                  <div key={g}><span className="font-medium">{g}란</span> <span className="text-stone-600">{fmt(q)}판</span></div>
                ))
              ) : (
                <span className="text-stone-500">{fmt(r.quantity)}판</span>
              )}
            </div>
          )},
          { header: '합계', align: 'right', render: r => <span className="font-bold text-blue-600">{fmt(r.quantity)}판</span> },
        ]}
      />
    </FormCard>
  );
}

function ProductionForm({ form, setForm, items, onAddItem, onUpdateItem, onRemoveItem, onSubmit, saving, site, hqSpecs, brProducts, specMap, todayRecords, onDelete, specLabel, onOpenManager, recentLots, onToggleLot, materials, productMaterialMap, inventoryItems, inventoryConnected, onSendToInventory, fmt, fmtD }) {
  const isHq = site === 'hq';
  const [sendingToInventory, setSendingToInventory] = useState(false);
  
  // 🆕 부자재 사용량 자동 계산 (자연재고관리 부자재 기반)
  const materialUsage = useMemo(() => {
    const usage = {}; // { inventoryItemId: { ...info, total } }
    
    items.forEach(item => {
      if (!item.specId) return;
      const mappings = productMaterialMap?.[item.specId] || [];
      
      mappings.forEach(map => {
        if (!map.inventoryItemId) return;
        
        // 본점은 판수, 지점은 박스 기준
        const productionQty = isHq 
          ? (parseInt(item.pans) || 0)
          : (parseInt(item.boxes) || 0);
        
        const totalUsage = productionQty * (parseFloat(map.quantity) || 0);
        
        if (totalUsage > 0) {
          if (!usage[map.inventoryItemId]) {
            usage[map.inventoryItemId] = {
              inventoryItemId: map.inventoryItemId,
              name: map.name || '',
              unit: map.unit || 'EA',
              branch: map.branch || 'main',
              cat: map.cat || 'sub',
              total: 0
            };
          }
          usage[map.inventoryItemId].total += totalUsage;
        }
      });
    });
    
    return Object.values(usage);
  }, [items, productMaterialMap, isHq]);
  
  // 자연재고관리에서 현재 재고 조회
  const getInventoryStock = (branch, cat, itemId) => {
    const list = inventoryItems?.[branch]?.[cat] || [];
    const item = list.find(x => x && x.id === itemId);
    return item ? (parseFloat(item.stock) || 0) : 0;
  };
  
  // 클립보드에 복사
  const copyToClipboard = () => {
    const text = materialUsage.map(u => 
      `${u.name}: ${fmt(u.total)}${u.unit}`
    ).join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
      alert('클립보드에 복사되었습니다!\n자연 재고관리 사이트에 붙여넣어 사용하세요.');
    }).catch(() => {
      alert('복사 실패. 직접 메모해주세요.');
    });
  };
  
  // 자동 출고 모달 상태
  const [showShipModal, setShowShipModal] = useState(false);
  const [shipDate, setShipDate] = useState(form.date);
  
  // form.date 변경 시 shipDate도 동기화
  useEffect(() => {
    setShipDate(form.date);
  }, [form.date]);
  
  // 🚀 자연재고관리에 자동 출고 (모달 열기)
  const handleAutoShipToInventory = () => {
    if (materialUsage.length === 0) return;
    setShipDate(form.date);
    setShowShipModal(true);
  };
  
  // 실제 출고 실행
  const executeAutoShip = async () => {
    setShowShipModal(false);
    setSendingToInventory(true);
    try {
      const productSummary = items
        .filter(it => it.specId && (it.pans || it.boxes))
        .map(it => `${specLabel(it.specId)} ${isHq ? `${it.pans}판` : `${it.boxes}박스`}`)
        .join(', ');
      
      const memo = `선별포장 자동출고 - ${productSummary}`;
      
      const result = await onSendToInventory(materialUsage, memo, shipDate);
      
      let msg = `✅ 자동 출고 완료!\n\n`;
      msg += `📅 출고일: ${shipDate}\n`;
      msg += `성공: ${result.successes.length}건\n`;
      result.successes.forEach(s => {
        msg += `  • ${s.name}: ${fmt(s.qty)}${s.unit} (${fmt(s.before)} → ${fmt(s.after)})\n`;
      });
      
      if (result.errors.length > 0) {
        msg += `\n⚠️ 실패: ${result.errors.length}건\n`;
        result.errors.forEach(e => { msg += `  • ${e}\n`; });
      }
      
      alert(msg);
    } catch (e) {
      alert('자동 출고 실패: ' + e.message);
    } finally {
      setSendingToInventory(false);
    }
  };
  
  return (
    <FormCard title={`생산 기록 - ${isHq ? '본점' : '지점'}`} icon={Factory} color="green">
      
      {/* 1. 작업 정보 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs flex items-center justify-center font-bold">1</span>
          작업 정보
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <Field label="날짜">
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field" />
          </Field>
          <Field label="작업자">
            <input type="text" value={form.worker} onChange={e => setForm({...form, worker: e.target.value})} placeholder="선택" className="input-field" />
          </Field>
          <Field label="시작" required>
            <input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="input-field" />
          </Field>
          <Field label="종료" required>
            <input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="input-field" />
          </Field>
        </div>
      </div>
      
      {/* 2. 사용 Lot 선택 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs flex items-center justify-center font-bold">2</span>
          사용 원란 Lot 
          <span className="text-xs font-normal text-stone-500">(역학조사용)</span>
          <span className="ml-auto">
            {form.sourceLots.length > 0 ? (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">{form.sourceLots.length}개 선택됨</span>
            ) : (
              <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold">⚠️ 미선택</span>
            )}
          </span>
        </h3>
        
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
          {recentLots.length === 0 ? (
            <div className="text-center py-6 text-stone-500 text-sm">
              📭 최근 30일 입고 내역이 없습니다
            </div>
          ) : (
            <>
              <div className="text-xs text-amber-800 mb-2">
                💡 이 작업에 사용한 원란 Lot을 모두 선택하세요. 정확한 역학조사를 위해 중요해요!
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {recentLots.map(lot => {
                  const selected = form.sourceLots.includes(lot.lotNo);
                  return (
                    <label key={lot.id} className={`block p-3 rounded-lg cursor-pointer transition ${
                      selected 
                        ? 'bg-green-100 border-2 border-green-500 shadow-sm' 
                        : 'bg-white border border-stone-200 hover:border-amber-400 hover:bg-amber-50/50'
                    }`}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={selected} onChange={() => onToggleLot(lot.lotNo)} 
                          className="w-5 h-5 mt-0.5 flex-shrink-0 cursor-pointer" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono font-bold text-sm text-amber-700">{lot.lotNo}</span>
                            <span className="text-xs text-stone-500">{lot.date}</span>
                            <span className="font-medium text-stone-800 text-sm">{lot.farmName || lot.supplier}</span>
                            {lot.eggMark && (
                              <span className="text-xs font-mono text-stone-600 px-1.5 py-0.5 bg-stone-100 rounded">{lot.eggMark}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex flex-wrap gap-1 text-xs">
                              {lot.gradeQuantities && Object.entries(lot.gradeQuantities).map(([g, q]) => (
                                <span key={g} className="px-1.5 py-0.5 bg-stone-100 text-stone-700 rounded">
                                  <b>{g}란</b> {fmt(q)}판
                                </span>
                              ))}
                            </div>
                            <span className="text-sm font-bold text-stone-900">{fmt(lot.quantity)}판</span>
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* 3. 생산 항목 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs flex items-center justify-center font-bold">3</span>
          {isHq ? '규격별 생산량' : '제품별 생산량'} 
          <span className="text-red-500">*</span>
          <button onClick={onOpenManager} className="ml-auto text-xs text-amber-700 hover:text-amber-800 font-medium flex items-center gap-1">
            <Settings className="w-3 h-3" />목록 관리
          </button>
        </h3>
        
        <div className="space-y-2">
          {items.map((item, idx) => {
            const spec = specMap[item.specId];
            const palletCalc = isHq && spec && item.pans ? pansToPallets(parseInt(item.pans), spec.panPerPallet) : null;
            const qtyCalc = !isHq && spec && spec.perPack && item.boxes ? parseInt(item.boxes) * spec.perPack : null;
            
            return (
              <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-5">
                    <label className="text-xs text-stone-500 mb-1 block">{isHq ? '규격' : '제품'}</label>
                    <select value={item.specId} onChange={e => onUpdateItem(idx, 'specId', e.target.value)} className="input-field">
                      <option value="">선택</option>
                      {isHq ? HQ_GRADES.map(g => (
                        <optgroup key={g} label={`${g}란`}>
                          {hqSpecs.filter(s => s.grade === g).map(s => (
                            <option key={s.id} value={s.id}>{s.name} (1PLT={s.panPerPallet}판)</option>
                          ))}
                        </optgroup>
                      )) : [...new Set(brProducts.map(p => p.brand))].map(brand => (
                        <optgroup key={brand} label={brand}>
                          {brProducts.filter(p => p.brand === brand).map(p => (
                            <option key={p.id} value={p.id}>{p.name} (1{p.packType}={p.perPack}개)</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  
                  {isHq ? (
                    <>
                      <div className="col-span-6 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">판수</label>
                        <input type="number" value={item.pans} onChange={e => onUpdateItem(idx, 'pans', e.target.value)} placeholder="0" className="input-field text-base font-semibold" inputMode="numeric" />
                      </div>
                      <div className="col-span-5 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">파렛 <span className="text-amber-600">자동</span></label>
                        <div className="input-field bg-amber-50 font-bold text-amber-900 flex items-center text-sm">
                          {palletCalc ? <span>{fmtD(palletCalc.decimal)} PLT</span> : <span className="text-stone-400">-</span>}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-6 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">박스/PT</label>
                        <input type="number" value={item.boxes} onChange={e => onUpdateItem(idx, 'boxes', e.target.value)} placeholder="0" className="input-field font-semibold" inputMode="numeric" />
                      </div>
                      <div className="col-span-5 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">개수 <span className="text-amber-600">자동</span></label>
                        <div className="input-field bg-amber-50 font-bold text-amber-900 flex items-center text-sm">
                          {qtyCalc ? <span>{fmt(qtyCalc)}개</span> : <span className="text-stone-400">-</span>}
                        </div>
                      </div>
                    </>
                  )}
                  
                  <div className="col-span-1 flex justify-end">
                    {items.length > 1 && (
                      <button onClick={() => onRemoveItem(idx)} className="p-2 text-stone-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        <button onClick={onAddItem} className="w-full mt-2 py-2 border-2 border-dashed border-stone-300 hover:border-green-500 hover:bg-green-50/50 text-stone-600 hover:text-green-700 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition">
          <Plus className="w-4 h-4" />{isHq ? '규격' : '제품'} 추가
        </button>
      </div>
      
      {/* 4. 로스 / 비고 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs flex items-center justify-center font-bold">4</span>
          로스 / 비고 <span className="text-xs font-normal text-stone-500">(선택)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="로스 수량 (개)">
            <input type="number" value={form.loss} onChange={e => setForm({...form, loss: e.target.value})} placeholder="0" className="input-field text-base font-semibold" inputMode="numeric" />
          </Field>
          <Field label="비고">
            <input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="선택" className="input-field" />
          </Field>
        </div>
      </div>
      
      {/* 부자재 사용량 자동 계산 표시 */}
      {materialUsage.length > 0 && (
        <div className="mb-4 p-4 bg-purple-50 border-2 border-purple-300 rounded-xl">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Boxes className="w-5 h-5 text-purple-700" />
              <h3 className="font-bold text-purple-900 text-sm md:text-base">필요 부자재</h3>
              {inventoryConnected && (
                <span className="text-[10px] md:text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                  <Link2 className="w-3 h-3" />연결됨
                </span>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={copyToClipboard} className="px-2.5 py-1.5 bg-white hover:bg-purple-100 border border-purple-300 rounded-lg text-xs font-semibold text-purple-700 flex items-center gap-1">
                📋 복사
              </button>
              <a href="https://jayeon-inventory3.netlify.app/" target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 bg-white hover:bg-purple-100 border border-purple-300 rounded-lg text-xs font-semibold text-purple-700 flex items-center gap-1">
                사이트 열기 →
              </a>
              {inventoryConnected && (
                <button onClick={handleAutoShipToInventory} disabled={sendingToInventory}
                  className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md">
                  {sendingToInventory ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" />출고 중...</>
                  ) : (
                    <><Zap className="w-3 h-3" />🚀 자동 출고</>
                  )}
                </button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {materialUsage.map(u => {
              const stock = getInventoryStock(u.branch, u.cat, u.inventoryItemId);
              const isInsufficient = stock < u.total;
              const willBe = stock - u.total;
              return (
                <div key={u.inventoryItemId} className={`bg-white rounded-lg p-2.5 border ${
                  isInsufficient ? 'border-red-300 bg-red-50' : 'border-purple-200'
                }`}>
                  <div className="text-[10px] md:text-xs text-stone-500 mb-0.5">
                    {u.branch === 'main' ? '🏢 본점' : '🏪 지점'} · {u.cat === 'sub' ? '부자재' : '공통'}
                  </div>
                  <div className="text-sm font-bold text-stone-900 truncate">{u.name}</div>
                  <div className={`text-lg md:text-xl font-bold mt-1 ${isInsufficient ? 'text-red-700' : 'text-purple-700'}`}>
                    -{fmt(u.total)} <span className="text-xs md:text-sm font-normal">{u.unit}</span>
                  </div>
                  {inventoryConnected && (
                    <div className="text-[10px] md:text-xs text-stone-500 mt-1">
                      재고: {fmt(stock)} → <b className={isInsufficient ? 'text-red-600' : 'text-stone-700'}>{fmt(willBe)}</b>
                      {isInsufficient && <span className="ml-1 text-red-600">⚠️</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* 부자재 매핑 안내 */}
      {items.some(it => it.specId) && materialUsage.length === 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs md:text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>이 제품은 부자재 매핑이 등록되지 않았습니다. <b>부자재 탭 → 매핑 설정</b>에서 등록해주세요.</span>
        </div>
      )}
      
      {/* 등록 버튼 */}
      <button onClick={onSubmit} disabled={saving} 
        className="w-full py-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-stone-300 disabled:to-stone-300 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-md text-base">
        <Plus className="w-5 h-5" />{saving ? '저장 중...' : '생산 기록 등록'}
      </button>
      <TodayList 
        records={todayRecords} title="오늘 생산 내역" onDelete={onDelete}
        columns={[
          { header: '시간', render: r => <span className="text-sm text-stone-700">{r.startTime}~{r.endTime}</span> },
          { header: 'Lot', render: r => (
            <div className="text-xs">
              {(r.sourceLots || []).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {r.sourceLots.map(l => <span key={l} className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{l}</span>)}
                </div>
              ) : <span className="text-red-500">⚠️ 미선택</span>}
            </div>
          )},
          { header: '품목', render: r => (
            <div className="text-xs space-y-0.5">
              {(r.items || []).map((it, i) => (
                <div key={i}>
                  <span className="font-medium">{specLabel(it.specId)}</span>
                  <span className="text-stone-500">{isHq ? ` ${fmt(it.pans)}판` : ` ${fmt(it.quantity)}개`}</span>
                </div>
              ))}
            </div>
          )},
          { header: '총 생산', align: 'right', render: r => (
            <div>
              {isHq ? <><div className="font-bold text-green-600">{fmt(r.totalPans)}판</div><div className="text-xs text-stone-500">{fmtD(r.totalPalletsDecimal)} PLT</div></> 
                    : <><div className="font-bold text-green-600">{fmt(r.totalQuantity)}개</div><div className="text-xs text-stone-500">{r.totalBoxes}박스</div></>}
            </div>
          )},
        ]}
      />
      
      {/* 🚀 자동 출고 확인 모달 */}
      {showShipModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3" onClick={() => setShowShipModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 md:p-5 bg-gradient-to-r from-purple-600 to-pink-600 text-white">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Zap className="w-5 h-5" />자연 재고관리 자동 출고
                </h3>
                <button onClick={() => setShowShipModal(false)} className="p-1 hover:bg-white/20 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs opacity-90">출고 날짜를 확인하고 진행해주세요</p>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              {/* 날짜 선택 */}
              <div className="mb-4 p-3 bg-purple-50 border-2 border-purple-200 rounded-xl">
                <label className="block text-sm font-bold text-purple-900 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />출고 날짜
                </label>
                <input 
                  type="date" 
                  value={shipDate} 
                  onChange={e => setShipDate(e.target.value)} 
                  className="input-field text-base font-semibold" 
                />
                <div className="text-xs text-purple-700 mt-2">
                  💡 자연 재고관리에 이 날짜로 출고가 기록됩니다
                </div>
              </div>
              
              {/* 출고 내역 */}
              <div className="mb-4">
                <h4 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4" />출고 부자재 ({materialUsage.length}건)
                </h4>
                <div className="space-y-1.5">
                  {materialUsage.map(u => {
                    const stock = getInventoryStock(u.branch, u.cat, u.inventoryItemId);
                    const willBe = stock - u.total;
                    const isInsufficient = stock < u.total;
                    return (
                      <div key={u.inventoryItemId} className={`p-2.5 rounded-lg border ${
                        isInsufficient ? 'bg-red-50 border-red-300' : 'bg-stone-50 border-stone-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-stone-500">
                              {u.branch === 'main' ? '🏢 본점' : '🏪 지점'} · {u.cat === 'sub' ? '부자재' : '공통'}
                            </div>
                            <div className="font-bold text-stone-900 text-sm truncate">{u.name}</div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            <div className={`text-base font-bold ${isInsufficient ? 'text-red-700' : 'text-purple-700'}`}>
                              -{fmt(u.total)} {u.unit}
                            </div>
                            <div className="text-xs text-stone-500">
                              {fmt(stock)} → <b>{fmt(willBe)}</b>
                            </div>
                          </div>
                        </div>
                        {isInsufficient && (
                          <div className="mt-1 text-xs text-red-700 font-semibold">⚠️ 재고 부족</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            <div className="p-4 md:p-5 bg-stone-50 border-t border-stone-200 flex gap-2">
              <button 
                onClick={() => setShowShipModal(false)} 
                className="flex-1 py-3 bg-white hover:bg-stone-100 border border-stone-300 rounded-xl font-semibold text-stone-700"
              >
                취소
              </button>
              <button 
                onClick={executeAutoShip}
                className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />출고 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </FormCard>
  );
}

function ShipmentForm({ form, setForm, items, onAddItem, onUpdateItem, onRemoveItem, onSubmit, saving, site, hqSpecs, brProducts, specMap, todayRecords, onDelete, specLabel, onOpenManager, fmt, fmtD }) {
  const isHq = site === 'hq';
  
  // 지점에서 브랜드 자동 추출 (제품 마스터에서)
  const brandList = useMemo(() => {
    return [...new Set(brProducts.map(p => p.brand))];
  }, [brProducts]);
  
  return (
    <FormCard 
      title={isHq ? '출고 - 본점 (모하지)' : '출고 - 지점 (브랜드별)'} 
      icon={Truck} color="amber"
    >
      {/* 안내 */}
      <div className={`mb-4 p-3 rounded-xl flex items-start gap-2 ${
        isHq ? 'bg-amber-50 border border-amber-200' : 'bg-indigo-50 border border-indigo-200'
      }`}>
        <Truck className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isHq ? 'text-amber-600' : 'text-indigo-600'}`} />
        <div className={`text-xs ${isHq ? 'text-amber-800' : 'text-indigo-800'}`}>
          {isHq ? (
            <><b>본점은 모하지(3PL)로 일괄 출고</b>됩니다. 출고처가 자동으로 설정됩니다.</>
          ) : (
            <><b>지점은 브랜드별로 직접 출고</b>됩니다. 출고처(브랜드)를 선택해주세요.</>
          )}
        </div>
      </div>
      
      {/* 1. 출고 정보 */}
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
          <span className="w-5 h-5 bg-amber-100 text-amber-700 rounded-full text-xs flex items-center justify-center font-bold">1</span>
          출고 정보
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="출고 날짜">
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="input-field" />
          </Field>
          
          {isHq ? (
            <Field label="출고처">
              <input type="text" value={form.partner} onChange={e => setForm({...form, partner: e.target.value})} className="input-field bg-amber-50 font-semibold" />
            </Field>
          ) : (
            <Field label="출고처 (브랜드)" required>
              <select 
                value={brandList.includes(form.partner) ? form.partner : (form.partner ? '__custom' : '')} 
                onChange={e => setForm({...form, partner: e.target.value === '__custom' ? '' : e.target.value})} 
                className="input-field bg-indigo-50 font-semibold"
              >
                <option value="">브랜드 선택</option>
                {brandList.map(b => <option key={b} value={b}>{b}</option>)}
                <option value="__custom">✏️ 직접 입력</option>
              </select>
              {!brandList.includes(form.partner) && (
                <input 
                  type="text" 
                  value={form.partner} 
                  onChange={e => setForm({...form, partner: e.target.value})} 
                  placeholder="예: 코스트코, 이마트 등" 
                  className="input-field mt-2" 
                />
              )}
            </Field>
          )}
          
          <Field label="출고 차량번호 (선택)">
            <input type="text" value={form.vehicle} onChange={e => setForm({...form, vehicle: e.target.value})} placeholder="모르면 빈칸" className="input-field" />
          </Field>
          <Field label="운전자/담당자 (선택)">
            <input type="text" value={form.driver} onChange={e => setForm({...form, driver: e.target.value})} placeholder="선택" className="input-field" />
          </Field>
        </div>
      </div>
      
      {/* 2. 출고 품목 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-stone-700 flex items-center gap-2">
            <span className="w-5 h-5 bg-amber-100 text-amber-700 rounded-full text-xs flex items-center justify-center font-bold">2</span>
            {isHq ? '출고 규격 (판수→파렛 자동)' : '출고 제품 (박스→개수 자동)'}
            <span className="text-red-500">*</span>
          </h3>
          <button onClick={onOpenManager} className="text-xs text-amber-700 hover:text-amber-800 font-medium flex items-center gap-1">
            <Settings className="w-3 h-3" />관리
          </button>
        </div>
        
        <div className="space-y-2">
          {items.map((item, idx) => {
            const spec = specMap[item.specId];
            const palletCalc = isHq && spec && item.pans ? pansToPallets(parseInt(item.pans), spec.panPerPallet) : null;
            const qtyCalc = !isHq && spec && spec.perPack && item.boxes ? parseInt(item.boxes) * spec.perPack : null;
            
            return (
              <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-5">
                    <label className="text-xs text-stone-500 mb-1 block">{isHq ? '규격' : '제품'}</label>
                    <select value={item.specId} onChange={e => onUpdateItem(idx, 'specId', e.target.value)} className="input-field">
                      <option value="">선택</option>
                      {isHq ? HQ_GRADES.map(g => (
                        <optgroup key={g} label={`${g}란`}>
                          {hqSpecs.filter(s => s.grade === g).map(s => <option key={s.id} value={s.id}>{s.name} (1PLT={s.panPerPallet}판)</option>)}
                        </optgroup>
                      )) : [...new Set(brProducts.map(p => p.brand))].map(brand => (
                        <optgroup key={brand} label={brand}>
                          {brProducts.filter(p => p.brand === brand).map(p => <option key={p.id} value={p.id}>{p.name} (1{p.packType}={p.perPack}개)</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  
                  {isHq ? (
                    <>
                      <div className="col-span-6 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">판수</label>
                        <input type="number" value={item.pans} onChange={e => onUpdateItem(idx, 'pans', e.target.value)} placeholder="0" className="input-field text-lg font-semibold" inputMode="numeric" />
                      </div>
                      <div className="col-span-5 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">파렛 <span className="text-amber-600">(자동)</span></label>
                        <div className="input-field bg-amber-50 font-bold text-amber-900 flex items-center">
                          {palletCalc ? <span>{fmtD(palletCalc.decimal)} PLT</span> : <span className="text-stone-400">-</span>}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-6 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">{spec ? `${spec.packType} 수량` : '박스/PT'}</label>
                        <input type="number" value={item.boxes} onChange={e => onUpdateItem(idx, 'boxes', e.target.value)} placeholder="0" className="input-field text-lg font-semibold" inputMode="numeric" />
                      </div>
                      <div className="col-span-5 md:col-span-3">
                        <label className="text-xs text-stone-500 mb-1 block">개수 <span className="text-amber-600">(자동)</span></label>
                        <div className="input-field bg-amber-50 font-bold text-amber-900 flex items-center">
                          {qtyCalc !== null ? <span>{fmt(qtyCalc)}개</span> : <span className="text-stone-400">-</span>}
                        </div>
                      </div>
                    </>
                  )}
                  
                  <div className="col-span-1">
                    {items.length > 1 && (
                      <button onClick={() => onRemoveItem(idx)} className="w-full p-2.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                        <X className="w-4 h-4 mx-auto" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        <button onClick={onAddItem} className="mt-2 w-full py-2.5 border-2 border-dashed border-stone-300 hover:border-amber-400 hover:bg-amber-50 rounded-xl text-sm font-medium text-stone-500 hover:text-amber-700 transition flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />{isHq ? '규격' : '제품'} 추가
        </button>
      </div>
      
      <Field label="비고" className="mt-5">
        <input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="선택" className="input-field mt-1.5" />
      </Field>
      
      <button onClick={onSubmit} disabled={saving} className="w-full mt-5 py-3.5 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 text-white font-bold rounded-xl transition flex items-center justify-center gap-2">
        <Plus className="w-5 h-5" />{saving ? '저장 중...' : '출고 등록'}
      </button>
      
      <TodayList 
        records={todayRecords} title={isHq ? '오늘 출고 내역 (모하지)' : '오늘 출고 내역 (브랜드별)'} onDelete={onDelete}
        columns={[
          { header: '거래처', render: r => <span className="font-medium text-stone-800">{r.partner || '-'}</span> },
          { header: '차량', render: r => <span className="text-xs text-stone-600">{r.vehicle || '-'}</span> },
          { header: '품목', render: r => (
            <div className="text-xs space-y-0.5">
              {(r.items || []).map((it, i) => (
                <div key={i}>
                  <span className="font-medium">{specLabel(it.specId)}</span>
                  <span className="text-stone-500">{isHq ? ` ${fmt(it.pans)}판` : ` ${it.boxes}박스`}</span>
                </div>
              ))}
            </div>
          )},
          { header: '진행', render: r => {
            const s = r.status || { shipped: true };
            const stage = s.reported ? 4 : s.ecountEntered ? 3 : s.delivered ? 2 : 1;
            return (
              <div className="flex items-center gap-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`w-2 h-2 rounded-full ${
                    i <= stage ? (stage === 4 ? 'bg-green-500' : 'bg-amber-500') : 'bg-stone-200'
                  }`} title={['출고','납품','이카운트','신고'][i-1]}></div>
                ))}
                <span className="text-xs text-stone-500 ml-1">
                  {stage === 4 ? '✓' : `${stage}/4`}
                </span>
              </div>
            );
          }},
          { header: '합계', align: 'right', render: r => (
            <div>
              {isHq ? <><div className="font-bold text-amber-600">{fmtD(r.totalPalletsDecimal)} 파렛</div><div className="text-xs text-stone-500">{fmt(r.totalPans)}판</div></> 
                    : <><div className="font-bold text-amber-600">{fmt(r.totalBoxes)}박스</div><div className="text-xs text-stone-500">{fmt(r.totalQuantity)}개</div></>}
            </div>
          )},
        ]}
      />
    </FormCard>
  );
}

function HistoryView({ records, site, specLabel, onDelete, onExport, fmt, fmtD }) {
  const isHq = site === 'hq';
  const [filter, setFilter] = useState('all'); // all, incoming, production, shipment
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  const filtered = useMemo(() => {
    let result = [...records];
    
    // 타입 필터
    if (filter !== 'all') result = result.filter(r => r.type === filter);
    
    // 검색
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r => {
        const text = [
          r.farmName, r.supplier, r.lotNo, r.eggMark, r.vehicle,
          r.partner, r.driver, r.note, r.specialNotes,
          ...(r.items || []).map(it => specLabel(it.specId))
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes(q);
      });
    }
    
    // 날짜 필터
    if (dateFrom) result = result.filter(r => r.date >= dateFrom);
    if (dateTo) result = result.filter(r => r.date <= dateTo);
    
    return result.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [records, filter, search, dateFrom, dateTo]);
  
  const counts = useMemo(() => ({
    all: records.length,
    incoming: records.filter(r => r.type === 'incoming').length,
    production: records.filter(r => r.type === 'production').length,
    shipment: records.filter(r => r.type === 'shipment').length,
  }), [records]);
  
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="p-3 md:p-4 border-b border-stone-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-stone-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-600" />{isHq ? '본점' : '지점'} 전체 기록
            <span className="text-xs font-normal text-stone-500">({fmt(filtered.length)}건)</span>
          </h2>
          <button onClick={onExport} className="flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs md:text-sm font-medium text-amber-700">
            <Download className="w-4 h-4" />엑셀
          </button>
        </div>
        
        {/* 검색 */}
        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input 
            type="text" 
            value={search} 
            onChange={e => setSearch(e.target.value)}
            placeholder="농장명, Lot, 거래처, 차량번호, 메모 검색..." 
            className="w-full pl-10 pr-3 py-2.5 border-1.5 border-stone-200 rounded-lg text-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" 
          />
        </div>
        
        {/* 타입 필터 */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition ${
            filter === 'all' ? 'bg-stone-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          }`}>전체 ({counts.all})</button>
          <button onClick={() => setFilter('incoming')} className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition ${
            filter === 'incoming' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}>📦 입고 ({counts.incoming})</button>
          <button onClick={() => setFilter('production')} className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition ${
            filter === 'production' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'
          }`}>🏭 생산 ({counts.production})</button>
          <button onClick={() => setFilter('shipment')} className={`px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition ${
            filter === 'shipment' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
          }`}>🚛 출고 ({counts.shipment})</button>
        </div>
        
        {/* 날짜 필터 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-500 font-medium">기간:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1 border border-stone-200 rounded text-xs" />
          <span className="text-stone-400">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1 border border-stone-200 rounded text-xs" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="px-2 py-1 text-stone-500 hover:text-stone-700">
              초기화
            </button>
          )}
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-stone-50 text-xs text-stone-600 uppercase">
            <tr>
              <th className="py-3 px-3 text-left">날짜</th>
              <th className="py-3 px-3 text-left">구분</th>
              <th className="py-3 px-3 text-left">상세</th>
              <th className="py-3 px-3 text-right">수량</th>
              <th className="py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-stone-400">
                  {records.length === 0 ? '아직 기록이 없습니다' : '검색 조건에 맞는 기록이 없습니다'}
                </td>
              </tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="py-3 px-3 text-sm text-stone-700 whitespace-nowrap">{r.date}</td>
                <td className="py-3 px-3">
                  {r.type === 'incoming' && <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded whitespace-nowrap">📦 입고</span>}
                  {r.type === 'production' && <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded whitespace-nowrap">🏭 생산</span>}
                  {r.type === 'shipment' && <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded whitespace-nowrap">🚛 출고</span>}
                </td>
                <td className="py-3 px-3 text-sm text-stone-800">
                  {r.type === 'incoming' && (
                    <div>
                      <div className="font-medium">{r.farmName || r.supplier} <span className="text-stone-500 font-normal">({r.quantity}판)</span></div>
                      <div className="text-xs text-stone-500 mt-0.5 font-mono flex flex-wrap gap-x-2">
                        {r.lotNo && <span className="text-blue-600 font-bold">{r.lotNo}</span>}
                        {r.eggMark && <span>난각:{r.eggMark}</span>}
                        {r.vehicle && <span>{r.vehicle}</span>}
                      </div>
                      {r.layingDates && r.layingDates.length > 0 && (
                        <div className="text-xs text-amber-700 mt-0.5">
                          🥚 산란: {r.layingDates.map(d => d.slice(5).replace('-', '/')).join(', ')}
                        </div>
                      )}
                      {r.specialNotes && (
                        <div className="text-xs text-orange-700 mt-0.5">
                          📌 {r.specialNotes}
                        </div>
                      )}
                    </div>
                  )}
                  {r.type === 'production' && (
                    <div>
                      <div>{r.startTime}~{r.endTime} {r.worker && `(${r.worker})`}</div>
                      <div className="text-xs text-stone-500 mt-0.5">
                        {(r.sourceLots || []).length > 0 && <span className="text-blue-600 font-mono">Lot: {r.sourceLots.join(', ')} · </span>}
                        {(r.items || []).map((it, i) => (
                          <span key={i}>{i > 0 && ', '}{specLabel(it.specId)} {isHq ? `${fmt(it.pans)}판` : `${fmt(it.quantity)}개`}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {r.type === 'shipment' && (
                    <div>
                      <div>{r.partner || '모하지'} {r.vehicle && `· ${r.vehicle}`}</div>
                      <div className="text-xs text-stone-500 mt-0.5">
                        {(r.items || []).map((it, i) => (
                          <span key={i}>{i > 0 && ', '}{specLabel(it.specId)} {isHq ? `${fmt(it.pans)}판` : `${it.boxes}박스`}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </td>
                <td className="py-3 px-3 text-right font-semibold text-stone-900">
                  {r.type === 'incoming' && `${fmt(r.quantity)}판`}
                  {r.type === 'production' && (
                    <div>
                      {isHq ? <><div>{fmt(r.totalPans)}판</div><div className="text-xs text-stone-500">{fmtD(r.totalPalletsDecimal)}PLT</div></> 
                            : <><div>{fmt(r.totalQuantity)}개</div><div className="text-xs text-stone-500">{r.totalBoxes}박스</div></>}
                      <div className="text-xs text-red-500">로스 {fmt(r.loss)}</div>
                    </div>
                  )}
                  {r.type === 'shipment' && (
                    <div>
                      {isHq ? <><div>{fmtD(r.totalPalletsDecimal)}파렛</div><div className="text-xs text-stone-500">{fmt(r.totalPans)}판</div></> 
                            : <><div>{fmt(r.totalBoxes)}박스</div><div className="text-xs text-stone-500">{fmt(r.totalQuantity)}개</div></>}
                    </div>
                  )}
                </td>
                <td className="py-3 px-3">
                  <button onClick={() => onDelete(r)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TodayList({ records, title, onDelete, columns }) {
  if (records.length === 0) return null;
  return (
    <div className="mt-6 pt-5 border-t border-stone-200">
      <h3 className="font-bold text-stone-800 mb-3 text-sm">{title} ({records.length}건)</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-stone-50 text-xs text-stone-600 uppercase">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={`py-2 px-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id} className="border-t border-stone-100">
                {columns.map((c, i) => (
                  <td key={i} className={`py-3 px-3 ${c.align === 'right' ? 'text-right' : ''}`}>{c.render(r)}</td>
                ))}
                <td className="py-3 px-3">
                  <button onClick={() => onDelete(r)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 🆕 부자재 관리 뷰 ============
function MaterialsView({ materials, records, site, onSaveMaterials, onSaveRecord, onDeleteRecord, todayDate, hqSpecs, brProducts, productMaterialMap, onSaveMap, inventoryItems, inventoryConnected, fmt }) {
  const [tab, setTab] = useState('stock'); // stock | in | out | mapping | history
  const [showManager, setShowManager] = useState(false);
  
  const isHq = site === 'hq';
  
  // 사이트별 부자재 (siteScope: 'hq' | 'branch' | 'both')
  const filteredMaterials = useMemo(() => {
    return materials.filter(m => 
      !m.siteScope || m.siteScope === 'both' || m.siteScope === site
    );
  }, [materials, site]);
  
  // 부자재별 재고 계산 (입고 - 사용)
  const getStock = (materialId) => {
    const incoming = records.filter(r => r.type === 'material_in' && r.materialId === materialId)
      .reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
    const used = records.filter(r => r.type === 'material_out' && r.materialId === materialId)
      .reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
    return incoming - used;
  };
  
  // 카테고리별 그룹화
  const groupedMaterials = useMemo(() => {
    const groups = {};
    MATERIAL_CATEGORIES.forEach(cat => { groups[cat.id] = []; });
    filteredMaterials.forEach(m => {
      const catId = m.category || 'etc';
      if (!groups[catId]) groups[catId] = [];
      groups[catId].push(m);
    });
    return groups;
  }, [filteredMaterials]);
  
  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 opacity-90 text-sm">
              <Boxes className="w-4 h-4" />부자재 관리 - {isHq ? '본점' : '지점'}
            </div>
            <h2 className="text-xl font-bold">자연 재고관리 시스템 연동</h2>
            <div className="flex items-center gap-2 mt-2 text-xs">
              {inventoryConnected ? (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/30 rounded-full">
                  <Link2 className="w-3 h-3" />자연 재고관리 연결됨 ✓
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/30 rounded-full">
                  <CloudOff className="w-3 h-3" />연결 안 됨
                </span>
              )}
              {inventoryConnected && (
                <span className="opacity-90">
                  본점 {(inventoryItems?.main?.sub?.length || 0) + (inventoryItems?.main?.commonSub?.length || 0)}개, 
                  지점 {(inventoryItems?.branch?.sub?.length || 0) + (inventoryItems?.branch?.commonSub?.length || 0)}개 부자재 동기화
                </span>
              )}
            </div>
          </div>
          <a 
            href="https://jayeon-inventory3.netlify.app/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold flex items-center gap-2"
          >
            <Link2 className="w-4 h-4" />자연 재고관리 열기 →
          </a>
        </div>
      </div>
      
      {/* 탭 */}
      <div className="flex gap-1 bg-white p-1 rounded-xl border border-stone-200 overflow-x-auto">
        <TabBtn active={tab === 'mapping'} onClick={() => setTab('mapping')} icon={Hash} label="매핑 설정" />
        <TabBtn active={tab === 'stock'} onClick={() => setTab('stock')} icon={Layers} label="자연 재고관리 재고" />
      </div>
      
      {tab === 'mapping' && (
        <MappingView 
          site={site} hqSpecs={hqSpecs} brProducts={brProducts}
          inventoryItems={inventoryItems}
          inventoryConnected={inventoryConnected}
          productMaterialMap={productMaterialMap || {}}
          onSaveMap={onSaveMap}
          fmt={fmt}
        />
      )}
      
      {tab === 'stock' && (
        <InventoryStockView 
          inventoryItems={inventoryItems}
          inventoryConnected={inventoryConnected}
          fmt={fmt}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
      active ? 'bg-purple-600 text-white' : 'text-stone-600 hover:bg-stone-100'
    }`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  );
}

// 🆕 자연재고관리 재고 현황 표시
function InventoryStockView({ inventoryItems, inventoryConnected, fmt }) {
  if (!inventoryConnected) {
    return (
      <div className="bg-white rounded-xl border-2 border-dashed border-stone-300 p-12 text-center">
        <CloudOff className="w-12 h-12 text-stone-300 mx-auto mb-3" />
        <h3 className="font-bold text-stone-700 mb-1">자연 재고관리에 연결되지 않았습니다</h3>
        <p className="text-sm text-stone-500">잠시 후 다시 시도해주세요</p>
      </div>
    );
  }
  
  const sections = [
    { title: '본점 - 부자재 (sub)', items: inventoryItems?.main?.sub || [], branch: 'main', cat: 'sub' },
    { title: '본점 - 공통 부자재 (commonSub)', items: inventoryItems?.main?.commonSub || [], branch: 'main', cat: 'commonSub' },
    { title: '지점 - 부자재 (sub)', items: inventoryItems?.branch?.sub || [], branch: 'branch', cat: 'sub' },
    { title: '지점 - 공통 부자재 (commonSub)', items: inventoryItems?.branch?.commonSub || [], branch: 'branch', cat: 'commonSub' },
  ];
  
  return (
    <div className="space-y-4">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        💡 자연 재고관리 사이트의 실시간 재고입니다. 변경 사항은 자연 재고관리에서 직접 입력하세요.
      </div>
      
      {sections.map((sec, sIdx) => {
        if (sec.items.length === 0) return null;
        return (
          <div key={sIdx} className="bg-white rounded-xl border border-stone-200 p-4">
            <h3 className="font-bold text-stone-900 mb-3">{sec.title}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {sec.items.filter(it => it).map((it, idx) => {
                const stock = parseFloat(it.stock) || 0;
                const isOut = stock <= 0;
                const isLow = stock > 0 && stock < 10;
                return (
                  <div key={`${sec.branch}_${sec.cat}_${idx}`} className={`p-3 rounded-lg border-2 ${
                    isOut ? 'bg-red-50 border-red-300' :
                    isLow ? 'bg-amber-50 border-amber-300' :
                    'bg-stone-50 border-stone-200'
                  }`}>
                    <div className="text-xs text-stone-500 mb-0.5 font-mono">{it.id}</div>
                    <div className="font-bold text-stone-900 text-sm">{it.name}</div>
                    <div className={`text-xl font-bold mt-1 ${
                      isOut ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-stone-900'
                    }`}>
                      {fmt(stock)} <span className="text-xs font-normal">{it.unit || 'EA'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 🆕 제품 ↔ 자연재고관리 부자재 매핑
function MappingView({ site, hqSpecs, brProducts, inventoryItems, inventoryConnected, productMaterialMap, onSaveMap, fmt }) {
  const isHq = site === 'hq';
  const products = isHq ? hqSpecs : brProducts;
  
  // 자연재고관리 부자재 평탄화 (선택용)
  // [{ id, name, unit, branch (main|branch), cat (sub|commonSub) }]
  const allInventoryItems = useMemo(() => {
    const items = [];
    ['main', 'branch'].forEach(br => {
      ['sub', 'commonSub'].forEach(cat => {
        const list = inventoryItems?.[br]?.[cat] || [];
        list.filter(x => x).forEach(it => {
          items.push({
            id: it.id,
            name: it.name,
            unit: it.unit || 'EA',
            branch: br,
            cat: cat,
            stock: it.stock || 0
          });
        });
      });
    });
    return items;
  }, [inventoryItems]);
  
  const [selectedProductId, setSelectedProductId] = useState('');
  const [editing, setEditing] = useState([]);
  
  useEffect(() => {
    if (selectedProductId) {
      setEditing(productMaterialMap[selectedProductId] || []);
    } else {
      setEditing([]);
    }
  }, [selectedProductId, productMaterialMap]);
  
  const addMapping = () => {
    setEditing([...editing, { inventoryItemId: '', quantity: '' }]);
  };
  
  const updateMapping = (idx, field, value) => {
    setEditing(editing.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };
  
  const removeMapping = (idx) => {
    setEditing(editing.filter((_, i) => i !== idx));
  };
  
  const saveMapping = async () => {
    const validMappings = editing
      .filter(m => m.inventoryItemId && m.quantity)
      .map(m => {
        const item = allInventoryItems.find(x => x.id === m.inventoryItemId);
        return {
          inventoryItemId: m.inventoryItemId,
          name: item?.name || '',
          unit: item?.unit || 'EA',
          branch: item?.branch || 'main',
          cat: item?.cat || 'sub',
          quantity: parseFloat(m.quantity)
        };
      });
    
    const newMap = { ...productMaterialMap };
    if (validMappings.length === 0) {
      delete newMap[selectedProductId];
    } else {
      newMap[selectedProductId] = validMappings;
    }
    
    await onSaveMap(newMap);
    alert('매핑이 저장되었습니다!');
  };
  
  const selectedProduct = products.find(p => p.id === selectedProductId);
  
  if (!inventoryConnected) {
    return (
      <div className="bg-white rounded-xl border-2 border-dashed border-stone-300 p-12 text-center">
        <CloudOff className="w-12 h-12 text-stone-300 mx-auto mb-3" />
        <h3 className="font-bold text-stone-700 mb-1">자연 재고관리에 연결되지 않았습니다</h3>
        <p className="text-sm text-stone-500">잠시 후 다시 시도해주세요</p>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5">
      <div className="mb-4">
        <h3 className="font-bold text-stone-900 flex items-center gap-2 mb-1">
          <Hash className="w-5 h-5 text-purple-600" />제품 ↔ 자연 재고관리 부자재 매핑
        </h3>
        <p className="text-sm text-stone-600">
          각 제품을 1{isHq ? '판' : '박스'} 만들 때 사용되는 부자재를 자연 재고관리에서 직접 선택하세요.
          생산 입력 시 <b>자동 계산 + 자동 출고</b>됩니다.
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 좌측: 제품 목록 */}
        <div className="md:col-span-1">
          <div className="text-xs font-bold text-stone-500 mb-2 uppercase">제품 선택</div>
          <div className="bg-stone-50 rounded-lg p-2 max-h-[600px] overflow-y-auto">
            {isHq ? (
              ['왕', '특', '대', '중'].map(grade => {
                const items = products.filter(p => p.grade === grade);
                if (items.length === 0) return null;
                return (
                  <div key={grade} className="mb-2">
                    <div className="text-xs font-bold text-stone-600 px-2 py-1">{grade}란</div>
                    {items.map(p => {
                      const hasMapping = (productMaterialMap[p.id] || []).length > 0;
                      return (
                        <button key={p.id} onClick={() => setSelectedProductId(p.id)}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm transition flex items-center justify-between ${
                            selectedProductId === p.id ? 'bg-purple-600 text-white' : 'hover:bg-white'
                          }`}>
                          <span>{p.name}</span>
                          {hasMapping && <span className={`text-xs px-1 rounded ${
                            selectedProductId === p.id ? 'bg-white/30' : 'bg-purple-100 text-purple-700'
                          }`}>{(productMaterialMap[p.id] || []).length}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              [...new Set(products.map(p => p.brand))].map(brand => {
                const items = products.filter(p => p.brand === brand);
                return (
                  <div key={brand} className="mb-2">
                    <div className="text-xs font-bold text-stone-600 px-2 py-1">{brand}</div>
                    {items.map(p => {
                      const hasMapping = (productMaterialMap[p.id] || []).length > 0;
                      return (
                        <button key={p.id} onClick={() => setSelectedProductId(p.id)}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm transition flex items-center justify-between ${
                            selectedProductId === p.id ? 'bg-purple-600 text-white' : 'hover:bg-white'
                          }`}>
                          <span className="text-xs truncate">{p.name}</span>
                          {hasMapping && <span className={`text-xs px-1 rounded ml-1 flex-shrink-0 ${
                            selectedProductId === p.id ? 'bg-white/30' : 'bg-purple-100 text-purple-700'
                          }`}>{(productMaterialMap[p.id] || []).length}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
        
        {/* 우측: 매핑 편집 */}
        <div className="md:col-span-2">
          {!selectedProductId ? (
            <div className="bg-stone-50 rounded-lg p-12 text-center">
              <p className="text-stone-500">← 좌측에서 제품을 선택하세요</p>
            </div>
          ) : (
            <div>
              <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="text-xs text-purple-600 mb-1">선택된 제품</div>
                <div className="font-bold text-purple-900">
                  {selectedProduct?.brand ? `${selectedProduct.brand} - ` : ''}{selectedProduct?.name}
                </div>
                <div className="text-xs text-stone-600 mt-1">
                  아래 매핑은 <b>1{isHq ? '판' : '박스'} 생산 시</b> 사용되는 부자재 양입니다.
                </div>
              </div>
              
              {editing.length === 0 ? (
                <div className="text-center py-6 text-stone-400 text-sm">
                  아직 매핑이 없습니다. 아래 버튼을 클릭해서 추가하세요.
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  {editing.map((m, idx) => {
                    const selectedItem = allInventoryItems.find(x => x.id === m.inventoryItemId);
                    return (
                      <div key={idx} className="flex gap-2 items-center bg-stone-50 p-2 rounded-lg">
                        <select 
                          value={m.inventoryItemId} 
                          onChange={e => updateMapping(idx, 'inventoryItemId', e.target.value)}
                          className="input-field flex-1"
                        >
                          <option value="">자연 재고관리에서 부자재 선택</option>
                          <optgroup label="📦 본점 - 부자재 (sub)">
                            {allInventoryItems.filter(x => x.branch === 'main' && x.cat === 'sub').map(x => 
                              <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>
                            )}
                          </optgroup>
                          <optgroup label="🔧 본점 - 공통 부자재 (commonSub)">
                            {allInventoryItems.filter(x => x.branch === 'main' && x.cat === 'commonSub').map(x => 
                              <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>
                            )}
                          </optgroup>
                          <optgroup label="📦 지점 - 부자재 (sub)">
                            {allInventoryItems.filter(x => x.branch === 'branch' && x.cat === 'sub').map(x => 
                              <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>
                            )}
                          </optgroup>
                          <optgroup label="🔧 지점 - 공통 부자재 (commonSub)">
                            {allInventoryItems.filter(x => x.branch === 'branch' && x.cat === 'commonSub').map(x => 
                              <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>
                            )}
                          </optgroup>
                        </select>
                        <input 
                          type="number" 
                          value={m.quantity}
                          onChange={e => updateMapping(idx, 'quantity', e.target.value)}
                          placeholder="개수"
                          className="input-field w-24 text-center font-bold"
                          step="0.01"
                          inputMode="decimal"
                        />
                        <span className="text-xs text-stone-500 whitespace-nowrap">
                          {selectedItem?.unit || 'EA'}/{isHq ? '판' : '박스'}
                        </span>
                        <button onClick={() => removeMapping(idx)} className="text-stone-400 hover:text-red-500 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              
              <button onClick={addMapping} className="w-full py-2 border-2 border-dashed border-purple-300 hover:border-purple-500 hover:bg-purple-50 rounded-lg text-sm font-medium text-purple-600 transition flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />부자재 추가
              </button>
              
              <button onClick={saveMapping} className="w-full mt-3 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                💾 매핑 저장
              </button>
              
              {/* 미리보기 */}
              {editing.filter(m => m.inventoryItemId && m.quantity).length > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-xs font-bold text-green-700 mb-2">예시: 10{isHq ? '판' : '박스'} 생산 시</div>
                  <div className="space-y-1 text-sm">
                    {editing.filter(m => m.inventoryItemId && m.quantity).map((m, i) => {
                      const item = allInventoryItems.find(x => x.id === m.inventoryItemId);
                      return (
                        <div key={i} className="flex justify-between">
                          <span>{item?.name}</span>
                          <span className="font-bold">{fmt(parseFloat(m.quantity) * 10)}{item?.unit || 'EA'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



// 부자재 마스터 등록 모달
function MaterialMasterManager({ materials, onSave, onClose }) {
  const [newMat, setNewMat] = useState({
    name: '', category: 'tray', unit: '개', spec: '',
    siteScope: 'both', supplier: '', minStock: ''
  });
  
  const add = () => {
    if (!newMat.name) { alert('부자재 이름을 입력하세요.'); return; }
    onSave([...materials, { 
      id: `mat_${Date.now()}`, 
      ...newMat,
      minStock: parseInt(newMat.minStock) || 0
    }]);
    setNewMat({ name: '', category: 'tray', unit: '개', spec: '', siteScope: 'both', supplier: '', minStock: '' });
  };
  
  const update = (id, field, value) => {
    onSave(materials.map(m => m.id === id ? { ...m, [field]: value } : m));
  };
  
  const remove = (id) => {
    if (!confirm('삭제? (기존 입출고 기록은 유지됩니다)')) return;
    onSave(materials.filter(m => m.id !== id));
  };
  
  const grouped = useMemo(() => {
    const g = {};
    MATERIAL_CATEGORIES.forEach(cat => { g[cat.id] = []; });
    materials.forEach(m => {
      const c = m.category || 'etc';
      if (!g[c]) g[c] = [];
      g[c].push(m);
    });
    return g;
  }, [materials]);
  
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Boxes className="w-5 h-5 text-purple-600" />부자재 등록 / 관리
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5">
          {/* 새 부자재 추가 */}
          <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-sm font-bold text-purple-900 mb-3">새 부자재 추가</div>
            <div className="grid grid-cols-12 gap-2">
              <select value={newMat.category} onChange={e => setNewMat({...newMat, category: e.target.value})} className="input-field col-span-3">
                {MATERIAL_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
              <input type="text" value={newMat.name} onChange={e => setNewMat({...newMat, name: e.target.value})} placeholder="이름 (예: 25구 난좌)" className="input-field col-span-5" />
              <input type="text" value={newMat.spec} onChange={e => setNewMat({...newMat, spec: e.target.value})} placeholder="규격 (예: 25구)" className="input-field col-span-2" />
              <select value={newMat.unit} onChange={e => setNewMat({...newMat, unit: e.target.value})} className="input-field col-span-2">
                {MATERIAL_UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
              
              <select value={newMat.siteScope} onChange={e => setNewMat({...newMat, siteScope: e.target.value})} className="input-field col-span-3">
                <option value="both">본점+지점 공통</option>
                <option value="hq">본점만</option>
                <option value="branch">지점만</option>
              </select>
              <input type="text" value={newMat.supplier} onChange={e => setNewMat({...newMat, supplier: e.target.value})} placeholder="공급처" className="input-field col-span-4" />
              <input type="number" value={newMat.minStock} onChange={e => setNewMat({...newMat, minStock: e.target.value})} placeholder="최소재고 (알림용)" className="input-field col-span-3" />
              <button onClick={add} className="col-span-2 px-2 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1">
                <Plus className="w-4 h-4" />추가
              </button>
            </div>
            <div className="text-xs text-stone-500 mt-2">💡 최소재고를 설정하면 그 이하로 떨어질 때 알림 표시됩니다</div>
          </div>
          
          {/* 카테고리별 목록 */}
          {MATERIAL_CATEGORIES.map(cat => {
            const items = grouped[cat.id] || [];
            if (items.length === 0) return null;
            return (
              <div key={cat.id} className="mb-4">
                <div className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                  <span className="text-lg">{cat.icon}</span>{cat.name} ({items.length})
                </div>
                <div className="space-y-1.5">
                  {items.map(m => (
                    <div key={m.id} className="flex items-center gap-2 p-2.5 bg-stone-50 rounded-lg">
                      <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={m.name} onChange={e => update(m.id, 'name', e.target.value)} 
                          className="input-field col-span-4 font-medium" />
                        <input type="text" value={m.spec || ''} onChange={e => update(m.id, 'spec', e.target.value)} 
                          placeholder="규격" className="input-field col-span-2 text-xs" />
                        <select value={m.unit || '개'} onChange={e => update(m.id, 'unit', e.target.value)} className="input-field col-span-1 text-xs">
                          {MATERIAL_UNITS.map(u => <option key={u}>{u}</option>)}
                        </select>
                        <select value={m.siteScope || 'both'} onChange={e => update(m.id, 'siteScope', e.target.value)} className="input-field col-span-2 text-xs">
                          <option value="both">공통</option>
                          <option value="hq">본점</option>
                          <option value="branch">지점</option>
                        </select>
                        <input type="text" value={m.supplier || ''} onChange={e => update(m.id, 'supplier', e.target.value)} 
                          placeholder="공급처" className="input-field col-span-2 text-xs" />
                        <input type="number" value={m.minStock || ''} onChange={e => update(m.id, 'minStock', parseInt(e.target.value) || 0)} 
                          placeholder="최소재고" className="input-field col-span-1 text-xs" />
                      </div>
                      <button onClick={() => remove(m.id)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          
          {materials.length === 0 && (
            <div className="text-center py-8 text-stone-400">
              위에서 새 부자재를 추가해보세요!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 🆕 신고 관리 뷰 ============
function ReportingView({ records, site, specLabel, onUpdateStatus, todayDate, fmt, fmtD }) {
  const [filter, setFilter] = useState('all'); // all | shipped | delivered | ecount | reported
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  const isHq = site === 'hq';
  
  // 상태별 분류 (status 필드 없으면 모두 출고완료 단계로 간주)
  const getStage = (r) => {
    const s = r.status || { shipped: true };
    if (s.reported) return 4;        // 신고 완료
    if (s.ecountEntered) return 3;   // 이카운트 입력
    if (s.delivered) return 2;       // 납품 확정
    return 1;                        // 출고만 완료
  };
  
  const filtered = useMemo(() => {
    let result = [...records];
    
    // 필터링
    if (filter === 'pending_delivery') result = result.filter(r => getStage(r) === 1);
    else if (filter === 'pending_ecount') result = result.filter(r => getStage(r) === 2);
    else if (filter === 'pending_report') result = result.filter(r => getStage(r) === 3);
    else if (filter === 'completed') result = result.filter(r => getStage(r) === 4);
    
    // 날짜 필터
    if (dateFrom) result = result.filter(r => r.date >= dateFrom);
    if (dateTo) result = result.filter(r => r.date <= dateTo);
    
    // 최신순
    return result.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [records, filter, dateFrom, dateTo]);
  
  // 단계별 카운트
  const counts = useMemo(() => {
    const c = { all: records.length, stage1: 0, stage2: 0, stage3: 0, stage4: 0 };
    records.forEach(r => {
      const s = getStage(r);
      if (s === 1) c.stage1++;
      else if (s === 2) c.stage2++;
      else if (s === 3) c.stage3++;
      else if (s === 4) c.stage4++;
    });
    return c;
  }, [records]);
  
  const exportFilteredCSV = () => {
    let csv = '\uFEFF출고일,거래처,차량,운전자,수량,납품확정,납품일,이카운트,이카운트일,신고완료,신고일,비고\n';
    filtered.forEach(r => {
      const s = r.status || {};
      const itemsStr = (r.items || []).map(it => `${specLabel(it.specId)} ${isHq ? `${it.pans||0}판` : `${it.boxes||0}박스`}`).join(' / ');
      const totalStr = isHq ? `${fmt(r.totalPans)}판/${fmtD(r.totalPalletsDecimal)}PLT` : `${fmt(r.totalBoxes)}박스/${fmt(r.totalQuantity)}개`;
      csv += `${r.date},${r.partner||''},${r.vehicle||''},${r.driver||''},${totalStr} (${itemsStr}),${s.delivered?'O':'X'},${s.deliveredDate||''},${s.ecountEntered?'O':'X'},${s.ecountDate||''},${s.reported?'O':'X'},${s.reportedDate||''},"${r.note||''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `신고관리_${todayDate}.csv`;
    a.click();
  };
  
  return (
    <div className="space-y-4">
      {/* 단계별 안내 */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl p-5 border-2 border-purple-200">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardCheck className="w-5 h-5 text-purple-700" />
          <h2 className="font-bold text-purple-900">신고 관리 - {isHq ? '본점' : '지점'}</h2>
        </div>
        <p className="text-xs text-stone-700 mb-3">
          출고 후 <b>4단계</b>로 진행 상태를 추적합니다. 각 단계 완료 시 체크하세요.
        </p>
        <div className="grid grid-cols-4 gap-2">
          <StageCounter num={1} label="출고만 완료" count={counts.stage1} color="blue" desc="납품 대기" />
          <StageCounter num={2} label="납품 확정" count={counts.stage2} color="cyan" desc="이카운트 대기" />
          <StageCounter num={3} label="이카운트 입력" count={counts.stage3} color="amber" desc="신고 대기" />
          <StageCounter num={4} label="신고 완료" count={counts.stage4} color="green" desc="끝" />
        </div>
      </div>
      
      {/* 필터 */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} label={`전체 (${counts.all})`} />
          <FilterBtn active={filter === 'pending_delivery'} onClick={() => setFilter('pending_delivery')} label={`납품 대기 (${counts.stage1})`} color="blue" />
          <FilterBtn active={filter === 'pending_ecount'} onClick={() => setFilter('pending_ecount')} label={`이카운트 대기 (${counts.stage2})`} color="cyan" />
          <FilterBtn active={filter === 'pending_report'} onClick={() => setFilter('pending_report')} label={`신고 대기 (${counts.stage3})`} color="amber" />
          <FilterBtn active={filter === 'completed'} onClick={() => setFilter('completed')} label={`완료 (${counts.stage4})`} color="green" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-600">기간:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-field w-auto" />
          <span className="text-stone-400">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-field w-auto" />
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="px-2 py-1 text-xs text-stone-500 hover:text-stone-700">초기화</button>
          <button onClick={exportFilteredCSV} className="ml-auto flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 rounded-lg text-sm font-medium text-purple-700">
            <Download className="w-4 h-4" />필터된 결과 엑셀
          </button>
        </div>
      </div>
      
      {/* 출고 목록 */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center text-stone-400">
            해당하는 출고 기록이 없습니다
          </div>
        ) : filtered.map(r => {
          const s = r.status || { shipped: true };
          const stage = getStage(r);
          
          return (
            <div key={r.id} className="bg-white rounded-xl border border-stone-200 p-4">
              {/* 출고 정보 */}
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm text-stone-500">{r.date}</span>
                    <span className="font-bold text-stone-900">{r.partner || '-'}</span>
                    {r.vehicle && <span className="text-xs px-2 py-0.5 bg-stone-100 rounded text-stone-600">{r.vehicle}</span>}
                    {r.driver && <span className="text-xs text-stone-500">{r.driver}</span>}
                  </div>
                  <div className="text-xs text-stone-600">
                    {(r.items || []).map((it, i) => (
                      <span key={i} className="inline-block mr-3">
                        {specLabel(it.specId)} <b>{isHq ? `${fmt(it.pans)}판` : `${it.boxes}박스`}</b>
                      </span>
                    ))}
                  </div>
                  {r.note && <div className="text-xs text-stone-500 mt-1">📝 {r.note}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${
                    stage === 4 ? 'bg-green-100 text-green-800' :
                    stage === 3 ? 'bg-amber-100 text-amber-800' :
                    stage === 2 ? 'bg-cyan-100 text-cyan-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {stage === 4 ? '✓ 완료' :
                     stage === 3 ? '신고 대기' :
                     stage === 2 ? '이카운트 대기' :
                     '납품 대기'}
                  </div>
                  <div className="text-sm font-bold text-stone-900 mt-1">
                    {isHq ? <>{fmtD(r.totalPalletsDecimal)} PLT</> : <>{fmt(r.totalBoxes)} 박스</>}
                  </div>
                </div>
              </div>
              
              {/* 4단계 진행 표시 */}
              <div className="flex items-stretch gap-1 bg-stone-50 rounded-lg p-2">
                <StageItem 
                  num={1} label="출고" 
                  done={true} date={r.date}
                  disabled
                />
                <StageItem 
                  num={2} label="납품 확정" 
                  done={s.delivered} date={s.deliveredDate}
                  onClick={() => onUpdateStatus(r, 'delivered', !s.delivered)}
                  onDateChange={(d) => onUpdateStatus(r, 'delivered', s.delivered, d)}
                />
                <StageItem 
                  num={3} label="이카운트" 
                  done={s.ecountEntered} date={s.ecountDate}
                  onClick={() => onUpdateStatus(r, 'ecountEntered', !s.ecountEntered)}
                  onDateChange={(d) => onUpdateStatus(r, 'ecountEntered', s.ecountEntered, d)}
                  disabled={!s.delivered}
                />
                <StageItem 
                  num={4} label="신고" 
                  done={s.reported} date={s.reportedDate}
                  onClick={() => onUpdateStatus(r, 'reported', !s.reported)}
                  onDateChange={(d) => onUpdateStatus(r, 'reported', s.reported, d)}
                  disabled={!s.ecountEntered}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageCounter({ num, label, count, color, desc }) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-800 border-blue-300',
    cyan: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    amber: 'bg-amber-100 text-amber-800 border-amber-300',
    green: 'bg-green-100 text-green-800 border-green-300',
  };
  return (
    <div className={`p-3 rounded-lg border-2 ${colorMap[color]}`}>
      <div className="text-xs opacity-70 mb-0.5">{num}단계 - {label}</div>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs opacity-60">건 · {desc}</div>
    </div>
  );
}

function FilterBtn({ active, onClick, label, color = 'stone' }) {
  const colors = {
    stone: active ? 'bg-stone-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
    blue: active ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    cyan: active ? 'bg-cyan-600 text-white' : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100',
    amber: active ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100',
    green: active ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100',
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${colors[color]}`}>
      {label}
    </button>
  );
}

function StageItem({ num, label, done, date, onClick, onDateChange, disabled }) {
  return (
    <div className={`flex-1 rounded-md p-2 transition ${
      done ? 'bg-green-50 border border-green-200' : 
      disabled ? 'bg-stone-100 opacity-50' :
      'bg-white border border-stone-200 hover:border-amber-400'
    }`}>
      <div className="flex items-center gap-1 mb-1">
        {disabled && !done ? (
          <Circle className="w-4 h-4 text-stone-300" />
        ) : (
          <button onClick={onClick} disabled={disabled} className={`${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-110 transition'}`}>
            {done ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-stone-400" />}
          </button>
        )}
        <span className={`text-xs font-bold ${done ? 'text-green-800' : 'text-stone-700'}`}>{num}. {label}</span>
      </div>
      {done && (
        <input 
          type="date" 
          value={date || ''} 
          onChange={e => onDateChange && onDateChange(e.target.value)}
          className="w-full text-xs px-1 py-0.5 bg-white border border-stone-200 rounded"
        />
      )}
      {!done && !disabled && (
        <div className="text-xs text-stone-400">대기 중</div>
      )}
      {disabled && !done && (
        <div className="text-xs text-stone-400">이전 단계 후</div>
      )}
    </div>
  );
}

// ============ 농장 관리 모달 ============
function FarmManager({ farms, onSave, onClose }) {
  const [newFarm, setNewFarm] = useState({ name: '', regNo: '', farmCode: '', owner: '', phone: '', address: '' });
  
  const addFarm = () => {
    if (!newFarm.name) { alert('농장명을 입력해주세요.'); return; }
    onSave([...farms, { id: `farm_${Date.now()}`, ...newFarm }]);
    setNewFarm({ name: '', regNo: '', farmCode: '', owner: '', phone: '', address: '' });
  };
  
  const removeFarm = (id) => {
    if (!confirm('삭제하시겠습니까?')) return;
    onSave(farms.filter(f => f.id !== id));
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-600" />농장 등록 (역학조사용)
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded-lg"><X className="w-5 h-5 text-stone-500" /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-xs font-semibold text-amber-800 mb-2">새 농장 등록</div>
            <div className="grid grid-cols-12 gap-2">
              <input type="text" value={newFarm.name} onChange={e => setNewFarm({...newFarm, name: e.target.value})} placeholder="농장명 *" className="input-field col-span-6" />
              <input type="text" value={newFarm.farmCode} onChange={e => setNewFarm({...newFarm, farmCode: e.target.value})} placeholder="농장번호 (난각용)" className="input-field col-span-3 font-mono" />
              <input type="text" value={newFarm.regNo} onChange={e => setNewFarm({...newFarm, regNo: e.target.value})} placeholder="등록번호" className="input-field col-span-3" />
              <input type="text" value={newFarm.owner} onChange={e => setNewFarm({...newFarm, owner: e.target.value})} placeholder="농장주" className="input-field col-span-3" />
              <input type="text" value={newFarm.phone} onChange={e => setNewFarm({...newFarm, phone: e.target.value})} placeholder="연락처" className="input-field col-span-3" />
              <input type="text" value={newFarm.address} onChange={e => setNewFarm({...newFarm, address: e.target.value})} placeholder="주소" className="input-field col-span-4" />
              <button onClick={addFarm} className="col-span-2 px-2 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1">
                <Plus className="w-4 h-4" />추가
              </button>
            </div>
            <div className="text-xs text-stone-500 mt-2">💡 농장번호는 난각에 찍히는 코드 (예: M3FDS)</div>
          </div>
          
          {farms.length === 0 ? (
            <div className="text-center py-8 text-stone-400 text-sm">등록된 농장이 없습니다</div>
          ) : (
            <div className="space-y-2">
              {farms.map(f => (
                <div key={f.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-bold text-stone-800 flex items-center gap-2">
                      {f.name}
                      {f.farmCode && <span className="text-xs font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{f.farmCode}</span>}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {[f.owner, f.phone, f.regNo, f.address].filter(Boolean).join(' · ') || '추가 정보 없음'}
                    </div>
                  </div>
                  <button onClick={() => removeFarm(f.id)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 🆕 역학조사 추적 모달 ============
function TraceabilityModal({ records, farms, specLabel, fmt, fmtD, onClose, onOpenFarmManager }) {
  const [searchType, setSearchType] = useState('lot'); // lot | farm | date
  const [searchValue, setSearchValue] = useState('');
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [results, setResults] = useState(null);
  
  const handleSearch = () => {
    let matchedIncomings = [];
    
    if (searchType === 'lot') {
      if (!searchValue) { alert('Lot 번호를 입력하세요.'); return; }
      matchedIncomings = records.filter(r => 
        r.type === 'incoming' && 
        (r.lotNo || '').toLowerCase().includes(searchValue.toLowerCase())
      );
    } else if (searchType === 'farm') {
      if (!searchValue) { alert('농장명을 입력하세요.'); return; }
      matchedIncomings = records.filter(r => 
        r.type === 'incoming' && 
        ((r.farmName || '').toLowerCase().includes(searchValue.toLowerCase()) ||
         (r.supplier || '').toLowerCase().includes(searchValue.toLowerCase()))
      );
    } else if (searchType === 'date') {
      if (!searchDateFrom) { alert('시작 날짜를 선택하세요.'); return; }
      const to = searchDateTo || searchDateFrom;
      matchedIncomings = records.filter(r => 
        r.type === 'incoming' && r.date >= searchDateFrom && r.date <= to
      );
    }
    
    if (matchedIncomings.length === 0) {
      setResults({ incomings: [], productions: [], shipments: [] });
      return;
    }
    
    const matchedLots = matchedIncomings.map(r => r.lotNo).filter(Boolean);
    
    // 해당 Lot을 사용한 생산 기록
    const matchedProductions = records.filter(r => 
      r.type === 'production' && 
      (r.sourceLots || []).some(l => matchedLots.includes(l))
    );
    
    // 해당 생산일과 비슷한 시점의 출고 (Lot 추적이 안 된 경우의 보완)
    const productionDates = [...new Set(matchedProductions.map(p => p.date))];
    const matchedShipments = records.filter(r => 
      r.type === 'shipment' && 
      productionDates.some(pd => {
        const shipDate = new Date(r.date);
        const prodDate = new Date(pd);
        const diffDays = Math.abs((shipDate - prodDate) / (1000 * 60 * 60 * 24));
        return diffDays <= 7; // 7일 이내 출고
      })
    );
    
    setResults({ 
      incomings: matchedIncomings, 
      productions: matchedProductions, 
      shipments: matchedShipments 
    });
  };
  
  const exportReport = () => {
    if (!results) return;
    
    let csv = '\uFEFF[역학조사 보고서]\n';
    csv += `검색일시,${new Date().toLocaleString('ko-KR')}\n`;
    csv += `검색조건,${searchType === 'lot' ? `Lot번호: ${searchValue}` : searchType === 'farm' ? `농장명: ${searchValue}` : `기간: ${searchDateFrom} ~ ${searchDateTo || searchDateFrom}`}\n\n`;
    
    csv += '== 1. 입고 기록 ==\n';
    csv += '날짜,Lot번호,농장명,난각표시,차량번호,수량(판),비고\n';
    results.incomings.forEach(r => {
      csv += `${r.date},${r.lotNo||''},${r.farmName||r.supplier||''},${r.eggMark||''},${r.vehicle||''},${r.quantity},"${r.note||''}"\n`;
    });
    
    csv += '\n== 2. 해당 원란 사용 생산 기록 ==\n';
    csv += '날짜,시간,사용Lot,작업자,품목,수량\n';
    results.productions.forEach(r => {
      const itemsStr = (r.items || []).map(it => `${specLabel(it.specId)} ${it.pans||0}판/${it.quantity||0}개`).join(' | ');
      csv += `${r.date},${r.startTime}~${r.endTime},${(r.sourceLots||[]).join('+')},${r.worker||''},"${itemsStr}",${r.totalPans||0}판/${r.totalQuantity||0}개\n`;
    });
    
    csv += '\n== 3. 관련 출고 기록 (생산일±7일 이내) ==\n';
    csv += '날짜,출고처,차량번호,운전자,품목,수량\n';
    results.shipments.forEach(r => {
      const itemsStr = (r.items || []).map(it => `${specLabel(it.specId)} ${it.pans||0}판/${it.boxes||0}박스`).join(' | ');
      csv += `${r.date},${r.partner||''},${r.vehicle||''},${r.driver||''},"${itemsStr}",${r.totalPans||0}판/${r.totalBoxes||0}박스\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `역학조사보고서_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between bg-gradient-to-r from-red-50 to-orange-50">
          <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />역학조사 추적 시스템
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={onOpenFarmManager} className="px-3 py-2 bg-white hover:bg-stone-100 rounded-lg text-sm font-medium text-stone-700 border border-stone-200 flex items-center gap-1">
              <MapPin className="w-4 h-4" />농장 관리
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-stone-100 rounded-lg"><X className="w-5 h-5 text-stone-500" /></button>
          </div>
        </div>
        
        <div className="p-5 border-b border-stone-200 bg-stone-50">
          <div className="flex gap-2 mb-3">
            {[
              { id: 'lot', label: 'Lot 번호로', icon: Hash },
              { id: 'farm', label: '농장명으로', icon: MapPin },
              { id: 'date', label: '날짜 기간으로', icon: Calendar },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} onClick={() => setSearchType(tab.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition ${
                  searchType === tab.id ? 'bg-red-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
                }`}>
                  <Icon className="w-4 h-4" />{tab.label}
                </button>
              );
            })}
          </div>
          
          <div className="flex gap-2">
            {searchType === 'date' ? (
              <>
                <input type="date" value={searchDateFrom} onChange={e => setSearchDateFrom(e.target.value)} className="input-field flex-1" />
                <span className="self-center text-stone-500">~</span>
                <input type="date" value={searchDateTo} onChange={e => setSearchDateTo(e.target.value)} className="input-field flex-1" />
              </>
            ) : (
              <input 
                type="text" 
                value={searchValue} 
                onChange={e => setSearchValue(e.target.value)}
                placeholder={searchType === 'lot' ? '예: L-260425-001 또는 일부만 (260425)' : '예: 00농장'}
                className="input-field flex-1"
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            )}
            <button onClick={handleSearch} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold flex items-center gap-2">
              <Search className="w-4 h-4" />검색
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5">
          {!results ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 text-stone-300 mx-auto mb-4" />
              <h3 className="font-bold text-stone-700 mb-2">역학조사 추적 시작</h3>
              <p className="text-sm text-stone-500 max-w-md mx-auto">
                의심 농장명, Lot 번호, 또는 기간을 입력하면<br />
                <b>해당 원란이 어떤 작업에 쓰였고, 어디로 출고되었는지</b> 즉시 추적합니다.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* 검색 결과 요약 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <Package className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-blue-900">{results.incomings.length}</div>
                  <div className="text-xs text-blue-700">건 입고 기록</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <Factory className="w-6 h-6 text-green-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-green-900">{results.productions.length}</div>
                  <div className="text-xs text-green-700">건 생산 기록</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <Truck className="w-6 h-6 text-amber-600 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-amber-900">{results.shipments.length}</div>
                  <div className="text-xs text-amber-700">건 출고 기록</div>
                </div>
              </div>
              
              {/* PDF/CSV 내보내기 */}
              <button onClick={exportReport} className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" />역학조사 보고서 내려받기 (CSV)
              </button>
              
              {/* 1. 입고 */}
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 font-bold text-blue-900 flex items-center gap-2">
                  <Package className="w-4 h-4" />1. 입고 기록 ({results.incomings.length}건)
                </div>
                {results.incomings.length === 0 ? (
                  <div className="p-6 text-center text-stone-400 text-sm">매칭된 입고 기록이 없습니다</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 text-xs text-stone-600">
                        <tr>
                          <th className="py-2 px-3 text-left">날짜</th>
                          <th className="py-2 px-3 text-left">Lot</th>
                          <th className="py-2 px-3 text-left">농장</th>
                          <th className="py-2 px-3 text-left">난각</th>
                          <th className="py-2 px-3 text-left">차량</th>
                          <th className="py-2 px-3 text-right">수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.incomings.map(r => (
                          <tr key={r.id} className="border-t border-stone-100">
                            <td className="py-2 px-3">{r.date}</td>
                            <td className="py-2 px-3 font-mono font-bold text-blue-600">{r.lotNo || '-'}</td>
                            <td className="py-2 px-3 font-medium">{r.farmName || r.supplier}</td>
                            <td className="py-2 px-3 font-mono text-xs">{r.eggMark || '-'}</td>
                            <td className="py-2 px-3 text-xs">{r.vehicle || '-'}</td>
                            <td className="py-2 px-3 text-right font-bold">{fmt(r.quantity)}판</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              
              {/* 2. 생산 */}
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-green-50 border-b border-green-200 font-bold text-green-900 flex items-center gap-2">
                  <Factory className="w-4 h-4" />2. 해당 원란 사용 생산 기록 ({results.productions.length}건)
                </div>
                {results.productions.length === 0 ? (
                  <div className="p-6 text-center text-stone-400 text-sm">
                    매칭된 생산 기록이 없습니다 (생산 시 Lot 선택을 안 했을 수 있습니다)
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 text-xs text-stone-600">
                        <tr>
                          <th className="py-2 px-3 text-left">날짜</th>
                          <th className="py-2 px-3 text-left">시간</th>
                          <th className="py-2 px-3 text-left">사용 Lot</th>
                          <th className="py-2 px-3 text-left">작업자</th>
                          <th className="py-2 px-3 text-left">품목</th>
                          <th className="py-2 px-3 text-right">수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.productions.map(r => (
                          <tr key={r.id} className="border-t border-stone-100">
                            <td className="py-2 px-3">{r.date}</td>
                            <td className="py-2 px-3 text-xs">{r.startTime}~{r.endTime}</td>
                            <td className="py-2 px-3 font-mono text-xs text-blue-600">{(r.sourceLots||[]).join(', ')}</td>
                            <td className="py-2 px-3 text-xs">{r.worker || '-'}</td>
                            <td className="py-2 px-3 text-xs">
                              {(r.items||[]).map((it, i) => (
                                <div key={i}>{specLabel(it.specId)} {it.pans||0}판/{fmt(it.quantity||0)}개</div>
                              ))}
                            </td>
                            <td className="py-2 px-3 text-right font-bold">
                              {r.site === 'hq' ? `${fmt(r.totalPans)}판` : `${fmt(r.totalQuantity)}개`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              
              {/* 3. 출고 */}
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 font-bold text-amber-900 flex items-center gap-2">
                  <Truck className="w-4 h-4" />3. 관련 출고 기록 (생산일 ±7일, {results.shipments.length}건)
                </div>
                {results.shipments.length === 0 ? (
                  <div className="p-6 text-center text-stone-400 text-sm">관련 출고 기록이 없습니다</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 text-xs text-stone-600">
                        <tr>
                          <th className="py-2 px-3 text-left">날짜</th>
                          <th className="py-2 px-3 text-left">출고처</th>
                          <th className="py-2 px-3 text-left">차량</th>
                          <th className="py-2 px-3 text-left">품목</th>
                          <th className="py-2 px-3 text-right">수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.shipments.map(r => (
                          <tr key={r.id} className="border-t border-stone-100">
                            <td className="py-2 px-3">{r.date}</td>
                            <td className="py-2 px-3 font-medium">{r.partner || '-'}</td>
                            <td className="py-2 px-3 text-xs">{r.vehicle || '-'} {r.driver && `(${r.driver})`}</td>
                            <td className="py-2 px-3 text-xs">
                              {(r.items||[]).map((it, i) => (
                                <div key={i}>{specLabel(it.specId)} {it.pans||0}판/{it.boxes||0}박스</div>
                              ))}
                            </td>
                            <td className="py-2 px-3 text-right font-bold">
                              {r.site === 'hq' ? `${fmtD(r.totalPalletsDecimal)}PLT` : `${fmt(r.totalBoxes)}박스`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 제품/규격 관리 ============
function ProductManager({ site, hqSpecs, brProducts, onSaveHq, onSaveBr, onClose }) {
  const [tab, setTab] = useState(site === 'branch' ? 'branch' : 'hq');
  const [newHq, setNewHq] = useState({ grade: '왕', pan: '5판', panPerPallet: '' });
  const [newBr, setNewBr] = useState({ brand: '', name: '', packType: 'BOX', perPack: '', note: '' });
  
  const addHq = () => {
    if (!newHq.panPerPallet) { alert('파렛당 판수를 입력해주세요.'); return; }
    const name = `${newHq.grade}${newHq.pan}`;
    if (hqSpecs.some(s => s.name === name)) { alert(`${name}은(는) 이미 존재합니다.`); return; }
    onSaveHq([...hqSpecs, { id: `hq_${Date.now()}`, grade: newHq.grade, pan: newHq.pan, name, panPerPallet: parseInt(newHq.panPerPallet) }]);
    setNewHq({ ...newHq, panPerPallet: '' });
  };
  
  const updateHqPallet = (id, value) => {
    onSaveHq(hqSpecs.map(s => s.id === id ? { ...s, panPerPallet: parseInt(value) || 0 } : s));
  };
  
  const removeHq = (id) => {
    if (!confirm('삭제하시겠습니까?')) return;
    onSaveHq(hqSpecs.filter(s => s.id !== id));
  };
  
  const addBr = () => {
    if (!newBr.brand || !newBr.name || !newBr.perPack) { alert('브랜드, 제품명, 개수 모두 입력'); return; }
    onSaveBr([...brProducts, { id: `br_${Date.now()}`, brand: newBr.brand, name: newBr.name, packType: newBr.packType, perPack: parseInt(newBr.perPack), note: newBr.note }]);
    setNewBr({ brand: '', name: '', packType: 'BOX', perPack: '', note: '' });
  };
  
  const removeBr = (id) => {
    if (!confirm('삭제?')) return;
    onSaveBr(brProducts.filter(p => p.id !== id));
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-600" />제품/규격 관리
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded-lg"><X className="w-5 h-5 text-stone-500" /></button>
        </div>
        
        <div className="flex gap-1 px-5 pt-3 border-b border-stone-100">
          <button onClick={() => setTab('hq')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'hq' ? 'border-amber-600 text-amber-700' : 'border-transparent text-stone-500'}`}>본점 규격</button>
          <button onClick={() => setTab('branch')} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'branch' ? 'border-amber-600 text-amber-700' : 'border-transparent text-stone-500'}`}>지점 제품</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'hq' && (
            <div>
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-xs font-semibold text-amber-800 mb-2">새 규격 추가</div>
                <div className="grid grid-cols-12 gap-2">
                  <select value={newHq.grade} onChange={e => setNewHq({...newHq, grade: e.target.value})} className="input-field col-span-2">
                    {HQ_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select value={newHq.pan} onChange={e => setNewHq({...newHq, pan: e.target.value})} className="input-field col-span-2">
                    {HQ_PANS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="col-span-2 px-3 py-2 bg-white rounded-lg border border-stone-200 text-stone-700 text-sm flex items-center font-medium">= {newHq.grade}{newHq.pan}</div>
                  <input type="number" value={newHq.panPerPallet} onChange={e => setNewHq({...newHq, panPerPallet: e.target.value})} placeholder="파렛당 판수" className="input-field col-span-4 font-semibold" />
                  <button onClick={addHq} className="col-span-2 px-2 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1">
                    <Plus className="w-4 h-4" />추가
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {HQ_GRADES.map(grade => {
                  const groupItems = hqSpecs.filter(s => s.grade === grade);
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={grade}>
                      <div className="text-xs font-bold text-stone-500 uppercase mt-3 mb-2">{grade}란</div>
                      <div className="space-y-1">
                        {groupItems.map(s => (
                          <div key={s.id} className="flex items-center justify-between p-2.5 bg-stone-50 rounded-lg gap-2">
                            <span className="font-medium text-stone-800 text-sm w-16">{s.name}</span>
                            <div className="flex items-center gap-1 flex-1">
                              <span className="text-xs text-stone-500">1PLT =</span>
                              <input type="number" value={s.panPerPallet || ''} onChange={e => updateHqPallet(s.id, e.target.value)} className="input-field w-20 text-center font-bold" />
                              <span className="text-xs text-stone-500">판</span>
                            </div>
                            <button onClick={() => removeHq(s.id)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {tab === 'branch' && (
            <div>
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-xs font-semibold text-amber-800 mb-2">새 제품 추가</div>
                <div className="grid grid-cols-12 gap-2">
                  <input type="text" value={newBr.brand} onChange={e => setNewBr({...newBr, brand: e.target.value})} placeholder="브랜드" className="input-field col-span-4" />
                  <input type="text" value={newBr.name} onChange={e => setNewBr({...newBr, name: e.target.value})} placeholder="제품명" className="input-field col-span-8" />
                  <select value={newBr.packType} onChange={e => setNewBr({...newBr, packType: e.target.value})} className="input-field col-span-3">
                    <option value="BOX">BOX</option><option value="PT">PT</option>
                  </select>
                  <input type="number" value={newBr.perPack} onChange={e => setNewBr({...newBr, perPack: e.target.value})} placeholder={`1${newBr.packType}당 개수`} className="input-field col-span-3 font-semibold" />
                  <input type="text" value={newBr.note} onChange={e => setNewBr({...newBr, note: e.target.value})} placeholder="비고" className="input-field col-span-4" />
                  <button onClick={addBr} className="col-span-2 px-2 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold flex items-center justify-center gap-1">
                    <Plus className="w-4 h-4" />추가
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {[...new Set(brProducts.map(p => p.brand))].map(brand => (
                  <div key={brand}>
                    <div className="text-xs font-bold text-stone-500 uppercase mt-3 mb-2">{brand}</div>
                    {brProducts.filter(p => p.brand === brand).map(p => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg">
                        <div>
                          <div className="font-medium text-stone-800">
                            {p.name}{p.note && <span className="ml-2 text-xs text-stone-500">({p.note})</span>}
                          </div>
                          <div className="text-xs text-amber-700 font-semibold mt-0.5">1{p.packType} = {p.perPack}개</div>
                        </div>
                        <button onClick={() => removeBr(p.id)} className="text-stone-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
