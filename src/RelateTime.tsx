import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Settings, Search, X, Plus, ChevronDown, ChevronRight, Calendar, ZoomIn, ZoomOut, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import { Notice, requestUrl } from 'obsidian';
import * as d3 from 'd3';

// ---------------- 接口定义 ----------------
interface NodeData extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  realName: string;
  gender: '男' | '女' | '未知';
  isIsolated?: boolean;
}

interface SemanticCacheEntry {
  category: string;
  reverseLabel: string;
  conflictReason: string;
}

interface GlobalInferredRecord {
  sourceId: string;
  targetId: string;
  label: string;
  category: string;
  scope: 'partial' | 'all';
  timeStr: string;
}

interface RawRelationEdge {
  key: string;
  sourceId: string;
  targetId: string;
  label: string;
  isInferred: boolean;
  inferScope: 'explicit' | 'partial' | 'all';
  timeStr: string;
  pairGroupId: string;
  conflictReason: string;
}

interface LinkData extends d3.SimulationLinkDatum<NodeData> {
  id: string;
  source: any; // 改为 any 绕过复杂的 D3 初始化类型检查
  target: any; // 改为 any 绕过复杂的 D3 初始化类型检查
  sourceId: string;
  targetId: string;
  label: string;
  isInferred: boolean;
  isSymmetricSingleLine: boolean;
  pairGroupId: string;
  conflictReason: string;
  totalBetweenNodes: number;
  isExactlyTwoOpposite: boolean;
  canonOffsetPx: number;
  canonLabelOffsetPx: number;
  canonAlongOffsetPx: number;
}

interface YMDState {
  year: number;
  month: number;
  day: number;
  isBC: boolean;
}

// 模块级持久化节点坐标缓存
const GLOBAL_NODE_CACHE: Record<string, { x: number; y: number; vx: number; vy: number }> = {};

// ---------------- 错误边界守护 ----------------
export default class RelateTime extends React.Component<
  { plugin: any },
  { hasError: boolean; error: any; errorInfo: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('RelateTime Error:', error, errorInfo);
    this.setState({ hasError: true, error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', color: 'var(--text-error)', background: 'var(--background-primary)', height: '100%', overflowY: 'auto' }}>
          <h3 style={{ marginBottom: '12px' }}>⚠️ 视图运行异常</h3>
          <pre style={{ padding: '12px', background: 'var(--background-secondary)', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
            {this.state.error?.stack || this.state.error?.toString()}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{ marginTop: '12px', padding: '6px 14px', background: 'var(--interactive-accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return <RelateTimeWorkspace plugin={this.props.plugin} />;
  }
}

// ---------------- 折叠面板组件 ----------------
const Accordion = ({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '12px', borderBottom: '1px solid var(--background-modifier-border)', paddingBottom: '12px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text-normal)', userSelect: 'none' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span style={{ marginLeft: '4px' }}>{title}</span>
      </div>
      {isOpen && <div style={{ marginTop: '10px', paddingLeft: '4px' }}>{children}</div>}
    </div>
  );
};

// ---------------- 日期、性别與強制語義歸一化工具函數 ----------------
const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEK_NAMES_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const cleanName = (name: any): string => {
  if (name === null || name === undefined) return '';
  return String(name).replace(/^\d+\s*/, '').trim();
};

const normalizeGender = (raw: any): '男' | '女' | '未知' => {
  if (!raw) return '未知';
  const s = String(raw).trim().toLowerCase();
  if (s === '男' || s === 'male' || s === 'm' || s === '男性' || s === '男人' || s === '男孩') return '男';
  if (s === '女' || s === 'female' || s === 'f' || s === '女性' || s === '女人' || s === '女孩') return '女';
  return '未知';
};

// 关键修复：强制归一化语义类别，彻底防止大模型返回非标分类名导致「同门、丈夫、弟弟」重复生成两条线！
const canonicalizeCategory = (label: string, rawCategory?: string): string => {
  const t = String(label || '').trim();
  if (/妻子|老婆|夫人|娘子|内人|爱人|伴侣|丈夫|老公|夫君|官人|相公|夫妻|配偶/.test(t)) return 'spouse';
  if (/男朋友|男友|未婚夫|女朋友|女友|未婚妻|情侣|恋人/.test(t)) return 'lover';
  if (/师兄|师姐|师弟|师妹/.test(t)) return 'martial_sibling';
  if (/同门|同窗|室友|同僚|战友/.test(t)) return 'sect_peer';
  if (/大哥|二哥|三哥|哥哥|兄长|长兄|表哥|堂哥|姐姐|大姐|二姐|阿姐|表姐|堂姐|弟弟|小弟|二弟|表弟|堂弟|妹妹|小妹|表妹|堂妹|兄弟|姐妹|手足/.test(t)) return 'sibling';
  if (/祖父|爷爷|祖母|奶奶|外公|姥爷|外婆|姥姥|孙子|孙女|外孙|外孙女|祖父母|孙辈/.test(t)) return 'grandparent';
  if (/师祖|太师父|徒孙/.test(t)) return 'grandmaster';
  if (/师叔|师伯|师姑|师侄/.test(t)) return 'martial_uncle';
  if (/师父|师傅|老师|恩师|师尊|徒弟|弟子|爱徒|学生/.test(t)) return 'master_disciple';
  if (/岳父|岳母|丈人|丈母娘|公公|婆婆|女婿|儿媳|婿媳|大舅哥|小舅子|大姨子|小姨子|大伯哥|小叔子|大姑姐|小姑子|嫂子|大嫂|弟妹|姐夫|妹夫|姻亲/.test(t)) return 'in_law';
  if (/伯父|大伯|叔父|叔叔|姑姑|姑母|舅舅|姨母|阿姨|侄子|侄女|外甥|外甥女|伯叔|舅姨|侄辈/.test(t)) return 'uncle_aunt';
  if (/父亲|爸爸|爹|老爹|继父|义父|干爹|养父|母亲|妈妈|娘|继母|义母|干妈|养母|父母|儿子|长子|次子|幼子|义子|养子|女儿|长女|次女|义女|养女|子女|孩儿/.test(t)) return 'parent_child';
  if (/朋友|好友|挚友|闺蜜|死党|知己/.test(t)) return 'friend';
  if (/仇人|死敌|敌人|宿敌|情敌|对手/.test(t)) return 'enemy';

  const rc = String(rawCategory || '').trim();
  const validStandard = new Set([
    'spouse',
    'lover',
    'martial_sibling',
    'sect_peer',
    'sibling',
    'grandparent',
    'grandmaster',
    'martial_uncle',
    'master_disciple',
    'in_law',
    'uncle_aunt',
    'parent_child',
    'friend',
    'enemy',
  ]);
  if (validStandard.has(rc)) return rc;
  return `custom_${t}`;
};

const ymdToDecimal = (ymd: YMDState): number => {
  const y = Math.max(1, Math.abs(Math.floor(ymd.year || 1)));
  const m = Math.min(12, Math.max(1, Math.floor(ymd.month || 1)));
  const maxD = MONTH_DAYS[m - 1] || 31;
  const d = Math.min(maxD, Math.max(1, Math.floor(ymd.day || 1)));

  let dayOfYear = d - 1;
  for (let i = 0; i < m - 1; i++) {
    dayOfYear += (MONTH_DAYS[i] || 0);
  }
  const fraction = dayOfYear / 365;
  return (ymd.isBC ? -y : y) + fraction;
};

const getTodayDecimalYear = (): number => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const hr = now.getHours();
  const min = now.getMinutes();
  let dayOfYear = d - 1;
  for (let i = 0; i < m; i++) {
    dayOfYear += (MONTH_DAYS[i] || 0);
  }
  const fraction = (dayOfYear + (hr + min / 60) / 24) / 365;
  return y + fraction;
};

const parseDateToDecimal = (dateStr: string): number => {
  if (!dateStr) return 0;
  const str = String(dateStr).trim();
  const isBC = /(BC|BCE|公元前)/i.test(str) || str.startsWith('-');
  const cleanStr = str.replace(/(BC|BCE|AD|CE|公元前|公元)/gi, '').trim();
  const nums = cleanStr.match(/\d+/g) || [];
  if (nums.length === 0) return 0;

  // 使用三元表达式和非空断言，确保传入的是字符串
  const y = parseInt(nums[0] || '0', 10) || 0;
  const m = nums.length > 1 ? Math.min(12, Math.max(1, parseInt(nums[1] || '1', 10))) : 1;
  const d = nums.length > 2 ? Math.min(31, Math.max(1, parseInt(nums[2] || '1', 10))) : 1;
  const hr = nums.length > 3 ? Math.min(24, Math.max(0, parseInt(nums[3] || '0', 10))) : 0;
  const min = nums.length > 4 ? Math.min(59, Math.max(0, parseInt(nums[4] || '0', 10))) : 0;

  let dayOfYear = d - 1;
  for (let i = 0; i < m - 1; i++) {
    dayOfYear += (MONTH_DAYS[i] || 0);
  }
  const fraction = (dayOfYear + (hr + min / 60) / 24) / 365;

  return (isBC ? -y : y) + fraction;
};

const isTimeStrActive = (timeStr: string, currentYear: number): boolean => {
  if (!timeStr) return true;
  const trimmed = timeStr.trim();
  if (!trimmed || trimmed.includes('固定')) return true;
  const rangeParts = trimmed.split(/[～~]/);
  if (rangeParts.length >= 2) {
    // 确保有值
    const startPart = rangeParts[0] || '';
    const endPart = rangeParts[1] || '';
    const startDec = parseDateToDecimal(startPart);
    const endDec = parseDateToDecimal(endPart);
    const minDec = Math.min(startDec, endDec);
    const maxDec = Math.max(startDec, endDec);
    return currentYear >= minDec && currentYear <= maxDec;
  }
  return true;
};

const decomposeDecimalYear = (dec: number) => {
  const yearFloor = Math.floor(dec);
  let rem = dec - yearFloor;
  if (rem < 0) rem += 1;

  const totalDays = rem * 365;
  let dayOfYear = Math.floor(totalDays);
  const dayFraction = totalDays - dayOfYear;

  let m = 0;
  while (m < 11 && dayOfYear >= (MONTH_DAYS[m] || 0)) {
    dayOfYear -= (MONTH_DAYS[m] || 0);
    m++;
  }
  const day = dayOfYear + 1;
  const totalHours = dayFraction * 24;
  const hour = Math.floor(totalHours);
  const minute = Math.floor((totalHours - hour) * 60);
  const dow = (((yearFloor * 365 + Math.floor(totalDays)) % 7) + 7) % 7;

  const isBC = yearFloor <= 0;
  const displayYear = isBC ? Math.abs(yearFloor) + (yearFloor === 0 ? 1 : 0) : yearFloor;

  return {
    rawYear: yearFloor,
    isBC,
    displayYear,
    monthIndex: m,
    monthNameZh: MONTH_NAMES_ZH[m],
    day,
    hour,
    minute,
    weekNameZh: WEEK_NAMES_ZH[dow],
  };
};

const formatCurrentTimeBadge = (dec: number, span: number): string => {
  const info = decomposeDecimalYear(dec);
  const yearLabel = info.isBC ? `${info.displayYear} BC` : `${info.displayYear}年`;
  if (span > 20) return `${yearLabel} ${info.monthIndex + 1}月`;
  if (span > 0.5) return `${yearLabel} ${info.monthIndex + 1}月 ${info.day}日`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${yearLabel} ${info.monthIndex + 1}月 ${info.day}日 ${pad(info.hour)}:${pad(info.minute)}`;
};

// ---------------- 本地确定性性别冲突检测 + 语义归类与反向推算引擎 ----------------
const analyzeRelationLocally = (
  relType: string,
  sourceName: string,
  sourceGender: '男' | '女' | '未知',
  targetName: string,
  targetGender: '男' | '女' | '未知'
): SemanticCacheEntry => {
  const t = relType.trim();
  let conflictReason = '';

  const femaleOnlyRoles = ['妻子', '老婆', '夫人', '娘子', '内人', '妾', '未婚妻', '女友', '女朋友', '母亲', '妈妈', '娘', '老娘', '继母', '义母', '干妈', '养母', '姐姐', '大姐', '二姐', '三姐', '阿姐', '表姐', '堂姐', '师姐', '妹妹', '小妹', '表妹', '堂妹', '师妹', '女儿', '长女', '次女', '小女', '养女', '义女', '干女儿', '孙女', '外孙女', '祖母', '奶奶', '外婆', '姥姥', '姑姑', '姑母', '阿姨', '姨母', '舅妈', '婶婶', '伯母', '嫂子', '大嫂', '弟妹', '儿媳', '女主人', '小姐'];
  const maleOnlyRoles = ['丈夫', '老公', '夫君', '官人', '相公', '未婚夫', '男友', '男朋友', '父亲', '爸爸', '爹', '老爹', '继父', '义父', '干爹', '养父', '大哥', '二哥', '三哥', '哥哥', '兄长', '长兄', '表哥', '堂哥', '师兄', '弟弟', '小弟', '二弟', '三弟', '表弟', '堂弟', '师弟', '儿子', '长子', '次子', '幼子', '养子', '义子', '干儿子', '孙子', '外孙', '祖父', '爷爷', '外公', '老爷', '叔叔', '叔父', '伯父', '大伯', '舅舅', '姑父', '姨父', '姐夫', '妹夫', '女婿', '大舅哥', '小舅子', '小叔子'];

  if (sourceGender === '男' && femaleOnlyRoles.some((role) => t === role || t.endsWith(role))) {
    conflictReason = `性别与关系冲突：【${sourceName}】的性别属性为「男」，但在此处被填写为【${targetName}】的「${t}」（女性称谓）。`;
  } else if (sourceGender === '女' && maleOnlyRoles.some((role) => t === role || t.endsWith(role))) {
    conflictReason = `性别与关系冲突：【${sourceName}】的性别属性为「女」，但在此处被填写为【${targetName}】的「${t}」（男性称谓）。`;
  }

  const cat = canonicalizeCategory(t);

  if (cat === 'spouse') {
    if (t.includes('夫妻') || t.includes('配偶')) return { category: 'spouse', reverseLabel: '夫妻', conflictReason };
    if (t.includes('妻') || t.includes('老婆') || t.includes('夫人') || t.includes('娘子')) {
      return { category: 'spouse', reverseLabel: targetGender === '女' ? '妻子' : '丈夫', conflictReason };
    }
    return { category: 'spouse', reverseLabel: targetGender === '男' ? '丈夫' : '妻子', conflictReason };
  }

  if (cat === 'lover') {
    const isFiance = t.includes('未婚');
    if (t.includes('男') || t.includes('夫')) {
      return {
        category: 'lover',
        reverseLabel: targetGender === '男' ? (isFiance ? '未婚夫' : '男友') : isFiance ? '未婚妻' : '女友',
        conflictReason,
      };
    }
    return {
      category: 'lover',
      reverseLabel: targetGender === '女' ? (isFiance ? '未婚妻' : '女友') : isFiance ? '未婚夫' : '男友',
      conflictReason,
    };
  }

  if (cat === 'martial_sibling') {
    if (t.includes('兄') || t.includes('姐')) {
      const rev = targetGender === '男' ? '师弟' : targetGender === '女' ? '师妹' : '师弟/师妹';
      return { category: 'martial_sibling', reverseLabel: rev, conflictReason };
    }
    const rev = targetGender === '男' ? '师兄' : targetGender === '女' ? '师姐' : '师兄/师姐';
    return { category: 'martial_sibling', reverseLabel: rev, conflictReason };
  }

  if (cat === 'sibling') {
    if (t.includes('哥') || t.includes('兄') || t.includes('姐')) {
      const rev = targetGender === '男' ? '弟弟' : targetGender === '女' ? '妹妹' : '弟弟/妹妹';
      return { category: 'sibling', reverseLabel: rev, conflictReason };
    }
    const rev = targetGender === '男' ? '哥哥' : targetGender === '女' ? '姐姐' : '哥哥/姐姐';
    return { category: 'sibling', reverseLabel: rev, conflictReason };
  }

  if (cat === 'parent_child') {
    const isAdoptive = t.includes('义') || t.includes('干');
    if (t.includes('父') || t.includes('爸') || t.includes('爹') || t.includes('母') || t.includes('妈') || t.includes('娘')) {
      const rev =
        targetGender === '男'
          ? isAdoptive
            ? '义子'
            : '儿子'
          : targetGender === '女'
          ? isAdoptive
            ? '义女'
            : '女儿'
          : isAdoptive
          ? '义子/义女'
          : '子女';
      return { category: 'parent_child', reverseLabel: rev, conflictReason };
    }
    const rev =
      targetGender === '男'
        ? isAdoptive
          ? '义父'
          : '父亲'
        : targetGender === '女'
        ? isAdoptive
          ? '义母'
          : '母亲'
        : isAdoptive
        ? '义父/义母'
        : '父母';
    return { category: 'parent_child', reverseLabel: rev, conflictReason };
  }

  if (cat === 'master_disciple') {
    if (t.includes('师') || t.includes('老')) {
      return { category: 'master_disciple', reverseLabel: '徒弟', conflictReason };
    }
    return { category: 'master_disciple', reverseLabel: '师父', conflictReason };
  }

  if (cat === 'friend' || cat === 'sect_peer' || cat === 'enemy') {
    return { category: cat, reverseLabel: t, conflictReason };
  }

  return { category: cat, reverseLabel: '', conflictReason };
};

// ---------------- 主工作区组件 ----------------
function RelateTimeWorkspace({ plugin }: { plugin: any }) {
  // 读取上次保存的持久化 UI 设置（若存在则自动恢复）
  const savedUi = useMemo(() => plugin?.settings?.uiState || {}, [plugin]);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<SVGGElement>(null);
  const timelineWrapRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<NodeData, LinkData> | null>(null);
  const simNodesRef = useRef<NodeData[]>([]);
  const simLinksRef = useRef<LinkData[]>([]);

  const [rawFiles, setRawFiles] = useState<any[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(() => savedUi.isPanelOpen ?? false);

  const [llmSemanticMap, setLlmSemanticMap] = useState<Record<string, SemanticCacheEntry>>(() => {
    return plugin?.settings?.llmCache?.semanticMap || {};
  });
  const [llmGlobalInferred, setLlmGlobalInferred] = useState<GlobalInferredRecord[]>(() => {
    return Array.isArray(plugin?.settings?.llmCache?.globalInferred) ? plugin.settings.llmCache.globalInferred : [];
  });
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmStepText, setLlmStepText] = useState('');

  const [conflictTooltip, setConflictTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    title: string;
    reason: string;
  }>({ visible: false, x: 0, y: 0, title: '', reason: '' });

  // 1. 筛选设置（全部从 savedUi 恢复）
  const [searchQuery, setSearchQuery] = useState<string>(() => savedUi.searchQuery ?? '');
  const [showIsolated, setShowIsolated] = useState<boolean>(() => savedUi.showIsolated ?? true);
  const [enableInferred, setEnableInferred] = useState<boolean>(() => savedUi.enableInferred ?? true);
  const [inferDisplayMode, setInferDisplayMode] = useState<'partial' | 'all'>(() => savedUi.inferDisplayMode ?? 'partial');

  // 2. 颜色组设置
  const [colorGroups, setColorGroups] = useState<{ keyword: string; color: string }[]>(() =>
    Array.isArray(savedUi.colorGroups) ? savedUi.colorGroups : [{ keyword: '主角', color: '#e03131' }]
  );

  // 3. 外观设置
  const [showArrow, setShowArrow] = useState<boolean>(() => savedUi.showArrow ?? true);
  const [nodeSize, setNodeSize] = useState<number>(() => savedUi.nodeSize ?? 7);
  const [nodeFontSize, setNodeFontSize] = useState<number>(() => savedUi.nodeFontSize ?? 12);
  const [linkThickness, setLinkThickness] = useState<number>(() => savedUi.linkThickness ?? 1.5);
  const [nodeOpacity, setNodeOpacity] = useState<number>(() => savedUi.nodeOpacity ?? 1.0);
  const [nodeTextOpacity, setNodeTextOpacity] = useState<number>(() => savedUi.nodeTextOpacity ?? 1.0);
  const [linkOpacity, setLinkOpacity] = useState<number>(() => savedUi.linkOpacity ?? 0.85);
  const [linkTextOpacity, setLinkTextOpacity] = useState<number>(() => savedUi.linkTextOpacity ?? 0.95);
  const [unselectedOpacity, setUnselectedOpacity] = useState<number>(() => savedUi.unselectedOpacity ?? 0.15);

  // 4. 力度设置
  const [centerStrength, setCenterStrength] = useState<number>(() => savedUi.centerStrength ?? 0.35);
  const [repelStrength, setRepelStrength] = useState<number>(() => savedUi.repelStrength ?? 320);
  const [linkAttractStrength, setLinkAttractStrength] = useState<number>(() => savedUi.linkAttractStrength ?? 0.5);
  const [linkDistance, setLinkDistance] = useState<number>(() => savedUi.linkDistance ?? 145);

  // 5. 焦点状态
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const activeNodeId = draggingNodeId || hoveredNodeId || selectedNodeId;

  // 6. 时间轴与范围设置（支持持久化）
  const [currentYear, setCurrentYear] = useState<number>(() => savedUi.currentYear ?? getTodayDecimalYear());
  const [viewSpan, setViewSpan] = useState<number>(() => savedUi.viewSpan ?? 12);
  const [startYMD, setStartYMD] = useState<YMDState>(
    () => savedUi.startYMD ?? { year: 3000, month: 1, day: 1, isBC: true }
  );
  const [endYMD, setEndYMD] = useState<YMDState>(
    () => savedUi.endYMD ?? { year: 3000, month: 12, day: 31, isBC: false }
  );
  const [jumpYMD, setJumpYMD] = useState<YMDState>(() => {
    if (savedUi.jumpYMD) return savedUi.jumpYMD;
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), isBC: false };
  });
  const [timelineWidth, setTimelineWidth] = useState(800);

  const minRangeDecimal = useMemo(() => ymdToDecimal(startYMD), [startYMD]);
  const maxRangeDecimal = useMemo(() => Math.max(minRangeDecimal + 0.01, ymdToDecimal(endYMD)), [endYMD, minRangeDecimal]);

  // 自动持久化保存所有图谱 UI 设置到 Obsidian 的 data.json，下次打开 100% 还原
  useEffect(() => {
    if (!plugin || !plugin.settings) return;
    const nextUiState = {
      isPanelOpen,
      searchQuery,
      showIsolated,
      enableInferred,
      inferDisplayMode,
      colorGroups,
      showArrow,
      nodeSize,
      nodeFontSize,
      linkThickness,
      nodeOpacity,
      nodeTextOpacity,
      linkOpacity,
      linkTextOpacity,
      unselectedOpacity,
      centerStrength,
      repelStrength,
      linkAttractStrength,
      linkDistance,
      currentYear,
      viewSpan,
      startYMD,
      endYMD,
      jumpYMD,
    };
    plugin.settings.uiState = nextUiState;
    const saveTimer = setTimeout(() => {
      if (typeof plugin.saveSettings === 'function') {
        plugin.saveSettings();
      }
    }, 400);
    return () => clearTimeout(saveTimer);
  }, [
    plugin,
    isPanelOpen,
    searchQuery,
    showIsolated,
    enableInferred,
    inferDisplayMode,
    colorGroups,
    showArrow,
    nodeSize,
    nodeFontSize,
    linkThickness,
    nodeOpacity,
    nodeTextOpacity,
    linkOpacity,
    linkTextOpacity,
    unselectedOpacity,
    centerStrength,
    repelStrength,
    linkAttractStrength,
    linkDistance,
    currentYear,
    viewSpan,
    startYMD,
    endYMD,
    jumpYMD,
  ]);

  // 隐藏 Obsidian 右下角状态栏
  useEffect(() => {
    const statusBar = document.querySelector('.status-bar') as HTMLElement | null;
    const prevDisplay = statusBar ? statusBar.style.display : '';
    if (statusBar) {
      statusBar.style.display = 'none';
    }
    return () => {
      if (statusBar) {
        statusBar.style.display = prevDisplay;
      }
    };
  }, []);

  const styleParamsRef = useRef({
    nodeSize,
    nodeFontSize,
    showArrow,
    linkThickness,
    nodeOpacity,
    nodeTextOpacity,
    linkOpacity,
    linkTextOpacity,
    unselectedOpacity,
    colorGroups,
    activeNodeId,
  });

  useEffect(() => {
    styleParamsRef.current = {
      nodeSize,
      nodeFontSize,
      showArrow,
      linkThickness,
      nodeOpacity,
      nodeTextOpacity,
      linkOpacity,
      linkTextOpacity,
      unselectedOpacity,
      colorGroups,
      activeNodeId,
    };
  }, [
    nodeSize,
    nodeFontSize,
    showArrow,
    linkThickness,
    nodeOpacity,
    nodeTextOpacity,
    linkOpacity,
    linkTextOpacity,
    unselectedOpacity,
    colorGroups,
    activeNodeId,
  ]);

  useEffect(() => {
    if (!timelineWrapRef.current) return;
    const updateWidth = () => {
      if (timelineWrapRef.current) {
        setTimelineWidth(timelineWrapRef.current.clientWidth || 800);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(timelineWrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!plugin || !plugin.app) return;
    const fetchFiles = () => {
      try {
        const folder = plugin.settings?.targetFolder || 'Scrivener联动/便笺';
        const attrKey = plugin.settings?.attrKey || 'type';
        const attrValue = plugin.settings?.attrValue || '人物';

        const allFiles = plugin.app.vault.getMarkdownFiles() || [];
        const matched = allFiles
          .filter((f: any) => f && f.path && f.path.includes(folder))
          .map((file: any) => {
            const cache = plugin.app.metadataCache.getFileCache(file);
            return {
              file,
              path: file.path,
              basename: file.basename,
              frontmatter: cache?.frontmatter || {},
            };
          })
          .filter((item: any) => item.frontmatter && item.frontmatter[attrKey] === attrValue);

        setRawFiles(matched);
      } catch (e) {
        console.error('读取人物文件失败:', e);
      }
    };

    const timer = setTimeout(fetchFiles, 80);
    const eventRef = plugin.app.metadataCache.on('changed', fetchFiles);
    const createRef = plugin.app.vault.on('create', fetchFiles);
    const deleteRef = plugin.app.vault.on('delete', fetchFiles);
    const renameRef = plugin.app.vault.on('rename', fetchFiles);

    return () => {
      clearTimeout(timer);
      plugin.app.metadataCache.offref(eventRef);
      plugin.app.vault.offref(createRef);
      plugin.app.vault.offref(deleteRef);
      plugin.app.vault.offref(renameRef);
    };
  }, [plugin]);

  const rawFilesRef = useRef<any[]>([]);
  rawFilesRef.current = rawFiles;
  const isAnalyzingRef = useRef(false);
  const activeNoticeRef = useRef<Notice | null>(null);

  const currentFingerprint = useMemo(() => {
    if (rawFiles.length === 0) return '';
    return rawFiles
      .map((f) => {
        const fm = f.frontmatter || {};
        const name = fm['character-name'] || fm['title'] || fm['name'] || '';
        const gender = String(fm['性别'] ?? fm['gender'] ?? '');
        const rel = JSON.stringify(fm['关系'] ?? '');
        return `${f.basename}|${name}|${gender}|${rel}`;
      })
      .sort()
      .join(';;');
  }, [rawFiles]);

  // 大模型全局知识图谱补全与冲突核验
  const runLlmAnalysis = useCallback(
    async (fingerprintToSave: string, isManual = false) => {
      const llmUrl = plugin?.settings?.llmUrl?.trim();
      const llmApiKey = plugin?.settings?.llmApiKey?.trim();
      const llmModel = plugin?.settings?.llmModel?.trim();
      const customPrompt = plugin?.settings?.llmPrompt?.trim();

      if (!llmUrl || !llmModel) {
        if (isManual) {
          new Notice('⚠️ 请先在插件系统设置中填写 API URL 和模型名称');
        }
        return;
      }

      if (isAnalyzingRef.current) return;
      const files = rawFilesRef.current;
      if (files.length === 0) return;

      const aliasToId: Record<string, string> = {};
      const idToName: Record<string, string> = {};
      const idToGender: Record<string, '男' | '女' | '未知'> = {};
      const charactersList: { id: string; name: string; gender: string }[] = [];

      files.forEach((f) => {
        const id = f.basename;
        const fm = f.frontmatter || {};
        const display = String(fm['character-name'] || fm['title'] || fm['name'] || cleanName(id)).trim() || cleanName(id);
        const g = normalizeGender(fm['性别'] ?? fm['gender']);
        idToName[id] = display;
        idToGender[id] = g;
        charactersList.push({ id, name: display, gender: g });

        aliasToId[id] = id;
        aliasToId[cleanName(id)] = id;
        aliasToId[display] = id;

        const aliases = fm['aliases'] ?? fm['alias'];
        if (aliases) {
          const arr = Array.isArray(aliases) ? aliases : String(aliases).split(/[,，]/);
          arr.forEach((a: any) => {
            if (a) aliasToId[String(a).trim()] = id;
          });
        }
      });

      const explicitRelationsForLlm: any[] = [];
      files.forEach((file) => {
        const relationsRaw = file.frontmatter?.['关系'];
        if (!relationsRaw) return;
        const relArray = Array.isArray(relationsRaw)
          ? relationsRaw.map((r: any) => String(r))
          : String(relationsRaw).split(/[,，](?![^(（]*[)）])/);
        const ownerId = file.basename;

        relArray.forEach((relStr: string) => {
          const trimmed = String(relStr || '').trim();
          const openParens = (trimmed.match(/[（(]/g) || []).length;
          const closeParens = (trimmed.match(/[)）]/g) || []).length;
          if (!trimmed || openParens !== closeParens) return;

          const nameTypePart = trimmed.replace(/[（(].*?[)）]/g, '').trim();
          const dashIdx = nameTypePart.indexOf('-');
          if (dashIdx === -1) return;

          const targetRawName = nameTypePart.slice(0, dashIdx).trim();
          const relType = nameTypePart.slice(dashIdx + 1).trim();
          if (!targetRawName || !relType) return;

          const dateMatch = trimmed.match(/[（(](.*?)[)）]/);
          // 添加 ! 非空断言，因为如果 dateMatch 存在，[1] 也一定存在
          const timeStr = dateMatch ? dateMatch[1]!.trim() : '固定';

          const srcId = aliasToId[targetRawName] || aliasToId[cleanName(targetRawName)];
          if (srcId && idToName[srcId] && srcId !== ownerId) {
            const key = `${srcId}->${ownerId}:${relType}`;
            explicitRelationsForLlm.push({
              key,
              sourceId: srcId,
              sourceName: idToName[srcId],
              sourceGender: idToGender[srcId],
              targetId: ownerId,
              targetName: idToName[ownerId],
              targetGender: idToGender[ownerId],
              label: relType,
              timeStr,
            });
          }
        });
      });

      if (explicitRelationsForLlm.length === 0) return;

      isAnalyzingRef.current = true;
      setLlmLoading(true);
      setLlmStepText(`正在调用 ${llmModel} 进行全人物知识图谱补全 (${charactersList.length} 人)...`);

      if (activeNoticeRef.current) activeNoticeRef.current.hide();
      activeNoticeRef.current = new Notice(`🤖 正在调用大模型 (${llmModel}) 进行全局关系推演...`, 0);

      const systemInstruction = `${customPrompt || ''}\n
请同时输出 "items"（显式关系核验）与 "globalInferredRelations"（全人物跨节点传递推算）两个数组！
1. 朋友、好友、仇人、死敌等非传递性关系绝对禁止跨节点传递！
2. globalInferredRelations 中每条记录格式为：{"sourceId": "人物A的id", "targetId": "人物B的id", "label": "A是B的什么称谓(不含推算二字)", "category": "语义分类", "scope": "partial 或 all", "timeStr": "固定"}。`;

      try {
        let endpoint = llmUrl;
        if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/completions')) {
          endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (llmApiKey) headers['Authorization'] = `Bearer ${llmApiKey}`;

        const response = await requestUrl({
          url: endpoint,
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: llmModel,
            temperature: 0,
            messages: [
              { role: 'system', content: systemInstruction },
              {
                role: 'user',
                content: `请对以下全量人物与显式关系进行全局知识图谱补全与冲突核验，只输出 JSON：\n${JSON.stringify(
                  { characters: charactersList, explicitRelations: explicitRelationsForLlm },
                  null,
                  2
                )}`,
              },
            ],
          }),
        });

        const contentStr: string = response.json?.choices?.[0]?.message?.content || '';
        const jsonMatch = contentStr.match(/\{[\s\S]*\}/);
        const cleanedJson = jsonMatch ? jsonMatch[0] : contentStr;
        const parsedObj = JSON.parse(cleanedJson);

        const itemsList: any[] = Array.isArray(parsedObj?.items) ? parsedObj.items : [];
        const nextSemanticMap: Record<string, SemanticCacheEntry> = {};
        itemsList.forEach((item) => {
          if (!item || !item.key) return;
          const revLbl = String(item.reverseLabel || '')
            .replace(/[(（]?推算[)）]?/g, '')
            .trim();
          nextSemanticMap[String(item.key)] = {
            category: canonicalizeCategory(revLbl, item.category),
            reverseLabel: revLbl,
            conflictReason: String(item.conflictReason || '').trim(),
          };
        });

        const rawGlobalList: any[] = Array.isArray(parsedObj?.globalInferredRelations)
          ? parsedObj.globalInferredRelations
          : [];
        const validNodeIds = new Set(files.map((f) => f.basename));
        const forbiddenTransitiveWords = ['朋友', '好友', '挚友', '闺蜜', '死党', '知己', '仇人', '死敌', '宿敌', '敌人', '情敌', '对手', '暗恋'];

        const nextGlobalInferred: GlobalInferredRecord[] = [];
        rawGlobalList.forEach((rel) => {
          if (!rel) return;
          const srcId = aliasToId[rel.sourceId] || aliasToId[cleanName(rel.sourceId)] || String(rel.sourceId || '');
          const tgtId = aliasToId[rel.targetId] || aliasToId[cleanName(rel.targetId)] || String(rel.targetId || '');
          if (!validNodeIds.has(srcId) || !validNodeIds.has(tgtId) || srcId === tgtId) return;

          const cleanLabel = String(rel.label || '')
            .replace(/[(（]?推算[)）]?/g, '')
            .trim();
          if (!cleanLabel) return;
          if (forbiddenTransitiveWords.some((w) => cleanLabel.includes(w))) return;

          // 强制通过 canonicalizeCategory 统一语义类别名，杜绝与本地类别名不一致导致的重复连线！
          const cat = canonicalizeCategory(cleanLabel, rel.category);
          if (cat === 'friend' || cat === 'enemy') return;

          const scopeVal: 'partial' | 'all' = rel.scope === 'partial' ? 'partial' : 'all';
          nextGlobalInferred.push({
            sourceId: srcId,
            targetId: tgtId,
            label: cleanLabel,
            category: cat,
            scope: scopeVal,
            timeStr: String(rel.timeStr || '固定'),
          });
        });

        const nowTime = Date.now();
        setLlmSemanticMap(nextSemanticMap);
        setLlmGlobalInferred(nextGlobalInferred);

        if (plugin?.settings) {
          plugin.settings.llmCache = {
            fingerprint: fingerprintToSave,
            semanticMap: nextSemanticMap,
            globalInferred: nextGlobalInferred,
            updatedAt: nowTime,
          };
          if (typeof plugin.saveSettings === 'function') {
            await plugin.saveSettings();
          }
        }

        if (activeNoticeRef.current) activeNoticeRef.current.hide();
        activeNoticeRef.current = new Notice(`✅ AI 全局图谱补全完成`, 2800);
      } catch (err: any) {
        console.warn('LLM 全局补全未通过，已使用本地全图传递引擎:', err);
        if (activeNoticeRef.current) activeNoticeRef.current.hide();
        if (isManual) {
          activeNoticeRef.current = new Notice(`⚠️ 大模型请求异常，已使用本地全图引擎完成推算`, 3500);
        }
      } finally {
        isAnalyzingRef.current = false;
        setLlmLoading(false);
        setLlmStepText('');
      }
    },
    [plugin]
  );

  useEffect(() => {
    if (!currentFingerprint) return;
    const cachedFp = plugin?.settings?.llmCache?.fingerprint || '';
    if (cachedFp === currentFingerprint) return;

    const llmUrl = plugin?.settings?.llmUrl?.trim();
    const llmModel = plugin?.settings?.llmModel?.trim();
    if (!llmUrl || !llmModel) return;

    const timer = setTimeout(() => {
      runLlmAnalysis(currentFingerprint, false);
    }, 3500);

    return () => clearTimeout(timer);
  }, [currentFingerprint, plugin, runLlmAnalysis]);

  // ---------------- 第一阶段：解析显式关系与一对一直接反向推算 ----------------
  const baseResolvedEdges = useMemo((): RawRelationEdge[] => {
    const aliasToId: Record<string, string> = {};
    const idToName: Record<string, string> = {};
    const idToGender: Record<string, '男' | '女' | '未知'> = {};

    rawFiles.forEach((f) => {
      const id = f.basename;
      const fm = f.frontmatter || {};
      const display = String(fm['character-name'] || fm['title'] || fm['name'] || cleanName(id)).trim() || cleanName(id);
      idToName[id] = display;
      idToGender[id] = normalizeGender(fm['性别'] ?? fm['gender']);

      aliasToId[id] = id;
      aliasToId[cleanName(id)] = id;
      aliasToId[display] = id;

      const aliases = fm['aliases'] ?? fm['alias'];
      if (aliases !== undefined && aliases !== null) {
        const arr = Array.isArray(aliases) ? aliases : String(aliases).split(/[,，]/);
        arr.forEach((a: any) => {
          if (a) {
            aliasToId[String(a).trim()] = id;
            aliasToId[cleanName(a)] = id;
          }
        });
      }
    });

    const nodeIdSet = new Set(rawFiles.map((f) => f.basename));
    const rawExplicitList: (RawRelationEdge & { reverseLabel: string; category: string })[] = [];

    rawFiles.forEach((file) => {
      const relationsRaw = file.frontmatter?.['关系'];
      if (!relationsRaw) return;

      const relArray = Array.isArray(relationsRaw)
        ? relationsRaw.map((r: any) => String(r))
        : String(relationsRaw).split(/[,，](?![^(（]*[)）])/);

      const ownerId = file.basename;
      const ownerName = idToName[ownerId] || ownerId;
      const ownerGender = idToGender[ownerId] || '未知';

      relArray.forEach((relStr: string) => {
        if (!relStr || typeof relStr !== 'string') return;
        const trimmed = relStr.trim();
        if (!trimmed) return;

        const nameTypePart = trimmed.replace(/[（(].*?[)）]/g, '').trim();
        const dashIdx = nameTypePart.indexOf('-');
        if (dashIdx === -1) return;

        const targetRawName = nameTypePart.slice(0, dashIdx).trim();
        const relType = nameTypePart.slice(dashIdx + 1).trim();
        if (!targetRawName || !relType) return;

        const dateMatch = trimmed.match(/[（(](.*?)[)）]/);
        // 添加 ! 非空断言，因为如果 dateMatch 存在，[1] 也一定存在
        const timeStr = dateMatch ? dateMatch[1]!.trim() : '固定';

        const mappedSrcId = aliasToId[targetRawName] || aliasToId[cleanName(targetRawName)];
        if (mappedSrcId && nodeIdSet.has(mappedSrcId) && mappedSrcId !== ownerId) {
          const srcId = mappedSrcId;
          const tgtId = ownerId;
          const srcName = idToName[srcId] || srcId;
          const srcGender = idToGender[srcId] || '未知';

          const localAnalysis = analyzeRelationLocally(relType, srcName, srcGender, ownerName, ownerGender);
          const edgeKey = `${srcId}->${tgtId}:${relType}`;
          const llmEntry = llmSemanticMap[edgeKey];

          // 强制通过 canonicalizeCategory 锁定唯一标准语义组，彻底杜绝因大模型分类名差异导致的重复线！
          const finalCategory = canonicalizeCategory(relType, llmEntry?.category || localAnalysis.category);
          const finalReverse = localAnalysis.reverseLabel || llmEntry?.reverseLabel || '';
          const finalConflict = localAnalysis.conflictReason || llmEntry?.conflictReason || '';

          const sortedPair = [srcId, tgtId].sort().join('__');
          const pairGroupId = `${sortedPair}__${finalCategory}`;

          rawExplicitList.push({
            key: edgeKey,
            sourceId: srcId,
            targetId: tgtId,
            label: relType,
            isInferred: false,
            inferScope: 'explicit',
            timeStr,
            category: finalCategory,
            reverseLabel: finalReverse,
            pairGroupId,
            conflictReason: finalConflict,
          });
        }
      });
    });

    const mergedExplicitMap: Record<string, RawRelationEdge & { reverseLabel: string; category: string }> = {};
    rawExplicitList.forEach((item) => {
      const dirTimeKey = `${item.sourceId}->${item.targetId}__${item.pairGroupId}__${item.timeStr}`;
      if (!mergedExplicitMap[dirTimeKey]) {
        mergedExplicitMap[dirTimeKey] = { ...item };
      } else {
        const existingLabels = mergedExplicitMap[dirTimeKey].label.split(' / ');
        if (!existingLabels.includes(item.label)) {
          mergedExplicitMap[dirTimeKey].label = [...existingLabels, item.label].join(' / ');
        }
        if (item.conflictReason && !mergedExplicitMap[dirTimeKey].conflictReason) {
          mergedExplicitMap[dirTimeKey].conflictReason = item.conflictReason;
        }
      }
    });

    const explicitEdges = Object.values(mergedExplicitMap);

    // 跨节点互指辈分冲突检测
    explicitEdges.forEach((e1) => {
      const opposite = explicitEdges.find(
        (e2) => e2.sourceId === e1.targetId && e2.targetId === e1.sourceId && e2.pairGroupId === e1.pairGroupId
      );
      if (opposite && !e1.conflictReason) {
        const seniorTerms = ['大哥', '哥哥', '姐姐', '师兄', '师姐', '父亲', '爸爸', '母亲', '妈妈', '师父', '师傅'];
        const juniorTerms = ['弟弟', '妹妹', '师弟', '师妹', '儿子', '女儿', '徒弟', '弟子'];
        const e1Senior = seniorTerms.some((w) => e1.label.includes(w));
        const opSenior = seniorTerms.some((w) => opposite.label.includes(w));
        const e1Junior = juniorTerms.some((w) => e1.label.includes(w));
        const opJunior = juniorTerms.some((w) => opposite.label.includes(w));

        if ((e1Senior && opSenior) || (e1Junior && opJunior)) {
          const sName = idToName[e1.sourceId] || e1.sourceId;
          const tName = idToName[e1.targetId] || e1.targetId;
          e1.conflictReason = `辈分/长幼关系冲突：【${sName}】与【${tName}】互指对方为「${e1.label}」与「${opposite.label}」，长幼方向矛盾。`;
        }
      }
    });

    const finalEdges: RawRelationEdge[] = explicitEdges.map(({ reverseLabel, category, ...rest }) => rest);

// 一对一直接反向推算（严格继承本体关系的 timeStr，确保推算关系与本体关系在任何时间点 100% 同步生灭！）
    explicitEdges.forEach((rec) => {
      if (!rec.reverseLabel) return;
      const hasReverseExactTime = finalEdges.some(
        (r) =>
          r.sourceId === rec.targetId &&
          r.targetId === rec.sourceId &&
          r.pairGroupId === rec.pairGroupId &&
          r.timeStr === rec.timeStr
      );
      if (!hasReverseExactTime) {
        finalEdges.push({
          key: `${rec.targetId}->${rec.sourceId}:${rec.reverseLabel}:${rec.timeStr}(inferred)`,
          sourceId: rec.targetId,
          targetId: rec.sourceId,
          label: rec.reverseLabel,
          isInferred: true,
          inferScope: 'partial',
          timeStr: rec.timeStr, // 100% 绑定本体时间
          pairGroupId: rec.pairGroupId,
          conflictReason: rec.conflictReason,
        });
      }
    });

    return finalEdges;
  }, [rawFiles, llmSemanticMap]);

  // ---------------- 第二阶段：全网络传递推算 + 终极去重 + 均匀槽位几何排版 ----------------
  const { nodes, links } = useMemo(() => {
    const idToDisplay: Record<string, string> = {};
    const idToGender: Record<string, '男' | '女' | '未知'> = {};

    rawFiles.forEach((f) => {
      const fm = f.frontmatter || {};
      const rawTitle = fm['character-name'] || fm['title'] || fm['name'] || cleanName(f.basename);
      idToDisplay[f.basename] = String(rawTitle).trim() || cleanName(f.basename);
      idToGender[f.basename] = normalizeGender(fm['性别'] ?? fm['gender']);
    });

    let activeNodes: NodeData[] = rawFiles.map((f) => ({
      id: f.basename,
      label: idToDisplay[f.basename] || f.basename,
      realName: f.basename,
      gender: idToGender[f.basename] || '未知',
      isIsolated: true,
    }));

    const nodeIdSet = new Set(activeNodes.map((n) => n.id));

    const timeFiltered = baseResolvedEdges.filter((rec) => {
      if (!enableInferred && rec.isInferred) return false;
      if (!nodeIdSet.has(rec.sourceId) || !nodeIdSet.has(rec.targetId)) return false;
      return isTimeStrActive(rec.timeStr, currentYear);
    });

    const dirGroupMap: Record<string, RawRelationEdge> = {};
    // 关键去重规则：同一方向 (sourceId -> targetId) + 同一归一化语义组 (pairGroupId)，只保留唯一一条边！
    // 若已有显式边或已有推算边，绝不重复叠加同义词（如有了“大哥”绝不再拼“/ 兄弟”，有了“丈夫”绝不画第二条“丈夫”）
    const addOrMergeEdge = (edge: RawRelationEdge) => {
      const normCat = canonicalizeCategory(edge.label);
      const normPairGroupId = `${[edge.sourceId, edge.targetId].sort().join('__')}__${normCat}`;
      const normalizedEdge: RawRelationEdge = { ...edge, pairGroupId: normPairGroupId };

      const k = `${normalizedEdge.sourceId}->${normalizedEdge.targetId}__${normPairGroupId}`;
      if (!dirGroupMap[k]) {
        dirGroupMap[k] = normalizedEdge;
      } else {
        const existing = dirGroupMap[k];
        // 如果新来的是显式手写关系，而原本是推算关系，则用显式关系覆盖推算关系！
        if (!normalizedEdge.isInferred && existing.isInferred) {
          dirGroupMap[k] = {
            ...normalizedEdge,
            conflictReason: normalizedEdge.conflictReason || existing.conflictReason,
          };
        } else if (!normalizedEdge.isInferred && !existing.isInferred) {
          // 两条都是手写显式关系且在同一语义组（极少见）：仅在文字不同时合并
          const parts = existing.label.split(' / ');
          if (!parts.includes(normalizedEdge.label)) {
            existing.label = [...parts, normalizedEdge.label].join(' / ');
          }
          if (normalizedEdge.conflictReason && !existing.conflictReason) {
            existing.conflictReason = normalizedEdge.conflictReason;
          }
        }
        // 如果新来的是推算关系，而该方向该语义组已经有关系了，直接忽略，防止产生重复线！
      }
    };

    timeFiltered.forEach(addOrMergeEdge);

    // 全人物传递推算
    if (enableInferred) {
      const parentRoleWords = ['父亲', '爸爸', '爹', '母亲', '妈妈', '娘', '父母'];
      const masterRoleWords = ['师父', '师傅', '老师', '师尊'];
      const spouseRoleWords = ['妻子', '老婆', '夫人', '丈夫', '老公', '夫妻', '配偶'];

      let changed = true;
      let passCount = 0;
      const maxPasses = Math.max(4, activeNodes.length);

      while (changed && passCount < maxPasses) {
        changed = false;
        passCount++;
        const currentEdges = Object.values(dirGroupMap);
        const newlyInferred: RawRelationEdge[] = [];

        const siblingEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__sibling') && !e.label.includes('表') && !e.label.includes('义')
        );
        const parentEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__parent_child') && parentRoleWords.some((w) => e.label.includes(w))
        );
        const spouseEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__spouse') && spouseRoleWords.some((w) => e.label.includes(w))
        );
        const masterEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__master_disciple') && masterRoleWords.some((w) => e.label.includes(w))
        );

        const siblingAdj: Record<string, Set<string>> = {};
        siblingEdges.forEach((e) => {
          if (!siblingAdj[e.sourceId]) siblingAdj[e.sourceId] = new Set();
          if (!siblingAdj[e.targetId]) siblingAdj[e.targetId] = new Set();
          siblingAdj[e.sourceId]!.add(e.targetId); // 加上感叹号
          siblingAdj[e.targetId]!.add(e.sourceId); // 加上感叹号
        });

        const getAllConnectedSiblings = (startId: string): string[] => {
          const visited = new Set<string>([startId]);
          const queue = [startId];
          while (queue.length > 0) {
            const curr = queue.shift()!;
            const neighbors = siblingAdj[curr];
            if (neighbors) {
              neighbors.forEach((nb) => {
                if (!visited.has(nb)) {
                  visited.add(nb);
                  queue.push(nb);
                }
              });
            }
          }
          visited.delete(startId);
          return Array.from(visited);
        };

        if (inferDisplayMode === 'all') {
          Object.keys(siblingAdj).forEach((u) => {
            const allSibs = getAllConnectedSiblings(u);
            allSibs.forEach((v) => {
              const sibGroup = `${[u, v].sort().join('__')}__sibling`;
              if (!dirGroupMap[`${u}->${v}__${sibGroup}`]) {
                const uGender = idToGender[u] || '未知';
                const lbl = uGender === '男' ? '兄弟' : uGender === '女' ? '姐妹' : '手足';
                newlyInferred.push({
                  key: `trans_sib:${u}->${v}`,
                  sourceId: u,
                  targetId: v,
                  label: lbl,
                  isInferred: true,
                  inferScope: 'all',
                  timeStr: '固定',
                  pairGroupId: sibGroup,
                  conflictReason: '',
                });
              }
            });
          });
        }

        // 兄弟姐妹共享父母
        parentEdges.forEach((pEdge) => {
          const parentId = pEdge.sourceId;
          const childA = pEdge.targetId;
          const parentLabel = pEdge.label;
          const allSiblingsOfA = getAllConnectedSiblings(childA);

          allSiblingsOfA.forEach((childB) => {
            if (childB === parentId) return;
            const pbPairGroup = `${[parentId, childB].sort().join('__')}__parent_child`;
            if (!dirGroupMap[`${parentId}->${childB}__${pbPairGroup}`]) {
              newlyInferred.push({
                key: `trans:${parentId}->${childB}:${parentLabel}`,
                sourceId: parentId,
                targetId: childB,
                label: parentLabel,
                isInferred: true,
                inferScope: 'partial',
                timeStr: '固定',
                pairGroupId: pbPairGroup,
                conflictReason: '',
              });
            }
            if (!dirGroupMap[`${childB}->${parentId}__${pbPairGroup}`]) {
              const bGender = idToGender[childB] || '未知';
              const childLabel = bGender === '男' ? '儿子' : bGender === '女' ? '女儿' : '子女';
              newlyInferred.push({
                key: `trans:${childB}->${parentId}:${childLabel}`,
                sourceId: childB,
                targetId: parentId,
                label: childLabel,
                isInferred: true,
                inferScope: 'partial',
                timeStr: '固定',
                pairGroupId: pbPairGroup,
                conflictReason: '',
              });
            }
          });
        });

        // 夫妻共享无冲突亲生子女
        parentEdges.forEach((pEdge) => {
          const p1 = pEdge.sourceId;
          const childId = pEdge.targetId;
          spouseEdges.forEach((sEdge) => {
            if (sEdge.conflictReason) return;
            const p2 = sEdge.sourceId === p1 ? sEdge.targetId : sEdge.targetId === p1 ? sEdge.sourceId : null;
            if (!p2 || p2 === childId) return;

            const p2ChildGroup = `${[p2, childId].sort().join('__')}__parent_child`;
            if (!dirGroupMap[`${p2}->${childId}__${p2ChildGroup}`]) {
              const p2Gender = idToGender[p2] || '未知';
              const p2Label = p2Gender === '男' ? '父亲' : p2Gender === '女' ? '母亲' : '父母';
              newlyInferred.push({
                key: `trans_sp_parent:${p2}->${childId}`,
                sourceId: p2,
                targetId: childId,
                label: p2Label,
                isInferred: true,
                inferScope: 'partial',
                timeStr: '固定',
                pairGroupId: p2ChildGroup,
                conflictReason: '',
              });
            }
            if (!dirGroupMap[`${childId}->${p2}__${p2ChildGroup}`]) {
              const cGender = idToGender[childId] || '未知';
              const cLabel = cGender === '男' ? '儿子' : cGender === '女' ? '女儿' : '子女';
              newlyInferred.push({
                key: `trans_sp_child:${childId}->${p2}`,
                sourceId: childId,
                targetId: p2,
                label: cLabel,
                isInferred: true,
                inferScope: 'partial',
                timeStr: '固定',
                pairGroupId: p2ChildGroup,
                conflictReason: '',
              });
            }
          });
        });

        // 同父母名下子女互为手足
        for (let i = 0; i < parentEdges.length; i++) {
          for (let j = i + 1; j < parentEdges.length; j++) {
            const p1 = parentEdges[i]!;
            const p2 = parentEdges[j]!;
            if (p1.sourceId === p2.sourceId) {
              const c1 = p1.targetId;
              const c2 = p2.targetId;
              if (c1 === c2) continue;
              const sibGroup = `${[c1, c2].sort().join('__')}__sibling`;
              if (!dirGroupMap[`${c1}->${c2}__${sibGroup}`] && !dirGroupMap[`${c2}->${c1}__${sibGroup}`]) {
                const g1 = idToGender[c1] || '未知';
                const g2 = idToGender[c2] || '未知';
                newlyInferred.push({
                  key: `trans_p_sib:${c1}->${c2}`,
                  sourceId: c1,
                  targetId: c2,
                  label: g1 === '男' ? '兄弟' : g1 === '女' ? '姐妹' : '手足',
                  isInferred: true,
                  inferScope: 'partial',
                  timeStr: '固定',
                  pairGroupId: sibGroup,
                  conflictReason: '',
                });
                newlyInferred.push({
                  key: `trans_p_sib:${c2}->${c1}`,
                  sourceId: c2,
                  targetId: c1,
                  label: g2 === '男' ? '兄弟' : g2 === '女' ? '姐妹' : '手足',
                  isInferred: true,
                  inferScope: 'partial',
                  timeStr: '固定',
                  pairGroupId: sibGroup,
                  conflictReason: '',
                });
              }
            }
          }
        }

        // 同师父门下互为同门
        for (let i = 0; i < masterEdges.length; i++) {
          for (let j = i + 1; j < masterEdges.length; j++) {
            const m1 = masterEdges[i]!;
            const m2 = masterEdges[j]!;
            if (m1.sourceId === m2.sourceId) {
              const d1 = m1.targetId;
              const d2 = m2.targetId;
              if (d1 === d2) continue;
              const peerGroup = `${[d1, d2].sort().join('__')}__sect_peer`;
              if (!dirGroupMap[`${d1}->${d2}__${peerGroup}`]) {
                newlyInferred.push({
                  key: `trans_peer:${d1}->${d2}`,
                  sourceId: d1,
                  targetId: d2,
                  label: '同门',
                  isInferred: true,
                  inferScope: 'partial',
                  timeStr: '固定',
                  pairGroupId: peerGroup,
                  conflictReason: '',
                });
              }
              if (!dirGroupMap[`${d2}->${d1}__${peerGroup}`]) {
                newlyInferred.push({
                  key: `trans_peer:${d2}->${d1}`,
                  sourceId: d2,
                  targetId: d1,
                  label: '同门',
                  isInferred: true,
                  inferScope: 'partial',
                  timeStr: '固定',
                  pairGroupId: peerGroup,
                  conflictReason: '',
                });
              }
            }
          }
        }

        const prevCount = Object.keys(dirGroupMap).length;
        newlyInferred.forEach(addOrMergeEdge);
        if (Object.keys(dirGroupMap).length > prevCount) {
          changed = true;
        }
      }

      // 'all' 模式下解锁跨代（祖孙/师祖）、旁系（叔伯/姑舅）与姻亲（岳父母/大舅哥/嫂子）推算
      if (inferDisplayMode === 'all') {
        const currentEdges = Object.values(dirGroupMap);
        const parentEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__parent_child') && parentRoleWords.some((w) => e.label.includes(w))
        );
        const siblingEdges = currentEdges.filter((e) => e.pairGroupId.endsWith('__sibling'));
        const spouseEdges = currentEdges.filter((e) => e.pairGroupId.endsWith('__spouse'));
        const masterEdges = currentEdges.filter(
          (e) => e.pairGroupId.endsWith('__master_disciple') && masterRoleWords.some((w) => e.label.includes(w))
        );

        const extendedInferred: RawRelationEdge[] = [];

        parentEdges.forEach((gpEdge) => {
          const grandParentId = gpEdge.sourceId;
          const parentId = gpEdge.targetId;
          parentEdges.forEach((pEdge) => {
            if (pEdge.sourceId !== parentId) return;
            const grandChildId = pEdge.targetId;
            if (grandChildId === grandParentId) return;

            const gpGroup = `${[grandParentId, grandChildId].sort().join('__')}__grandparent`;
            const isMaternal = idToGender[parentId] === '女';
            const gpGender = idToGender[grandParentId] || '未知';
            const gcGender = idToGender[grandChildId] || '未知';

            const gpLabel =
              gpGender === '男' ? (isMaternal ? '外公' : '祖父') : gpGender === '女' ? (isMaternal ? '外婆' : '祖母') : '祖父母';
            const gcLabel =
              gcGender === '男' ? (isMaternal ? '外孙' : '孙子') : gcGender === '女' ? (isMaternal ? '外孙女' : '孙女') : '孙辈';

            extendedInferred.push({
              key: `ext_gp:${grandParentId}->${grandChildId}`,
              sourceId: grandParentId,
              targetId: grandChildId,
              label: gpLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: gpGroup,
              conflictReason: '',
            });
            extendedInferred.push({
              key: `ext_gc:${grandChildId}->${grandParentId}`,
              sourceId: grandChildId,
              targetId: grandParentId,
              label: gcLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: gpGroup,
              conflictReason: '',
            });
          });
        });

        parentEdges.forEach((pEdge) => {
          const parentId = pEdge.sourceId;
          const childId = pEdge.targetId;
          const isMaternal = idToGender[parentId] === '女';

          siblingEdges.forEach((sEdge) => {
            if (sEdge.targetId !== parentId) return;
            const uncleId = sEdge.sourceId;
            if (uncleId === childId) return;
            const existingPC = `${[uncleId, childId].sort().join('__')}__parent_child`;
            if (dirGroupMap[`${uncleId}->${childId}__${existingPC}`]) return;

            const uaGroup = `${[uncleId, childId].sort().join('__')}__uncle_aunt`;
            const uGender = idToGender[uncleId] || '未知';
            const cGender = idToGender[childId] || '未知';

            let uLabel = '长辈';
            if (isMaternal) {
              uLabel = uGender === '男' ? '舅舅' : uGender === '女' ? '姨母' : '舅姨';
            } else {
              if (uGender === '女') uLabel = '姑姑';
              else if (sEdge.label.includes('哥') || sEdge.label.includes('兄')) uLabel = '伯父';
              else if (sEdge.label.includes('弟')) uLabel = '叔父';
              else uLabel = '伯叔';
            }
            const nephewLabel = isMaternal
              ? cGender === '男'
                ? '外甥'
                : cGender === '女'
                ? '外甥女'
                : '外甥'
              : cGender === '男'
              ? '侄子'
              : cGender === '女'
              ? '侄女'
              : '侄辈';

            extendedInferred.push({
              key: `ext_ua:${uncleId}->${childId}`,
              sourceId: uncleId,
              targetId: childId,
              label: uLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: uaGroup,
              conflictReason: '',
            });
            extendedInferred.push({
              key: `ext_nephew:${childId}->${uncleId}`,
              sourceId: childId,
              targetId: uncleId,
              label: nephewLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: uaGroup,
              conflictReason: '',
            });
          });
        });

        spouseEdges.forEach((spEdge) => {
          const personA = spEdge.sourceId;
          const personB = spEdge.targetId;

          parentEdges.forEach((pEdge) => {
            if (pEdge.targetId !== personA) return;
            const inLawParent = pEdge.sourceId;
            if (inLawParent === personB) return;
            // 若已经是亲生父母则绝不覆盖为岳父母！
            const existingPC = `${[inLawParent, personB].sort().join('__')}__parent_child`;
            if (dirGroupMap[`${inLawParent}->${personB}__${existingPC}`]) return;

            const inLawGroup = `${[inLawParent, personB].sort().join('__')}__in_law`;
            const pGender = idToGender[inLawParent] || '未知';
            const bGender = idToGender[personB] || '未知';

            const pLabel = bGender === '男' ? (pGender === '男' ? '岳父' : '岳母') : pGender === '男' ? '公公' : '婆婆';
            const bLabel = bGender === '男' ? '女婿' : bGender === '女' ? '儿媳' : '婿媳';

            extendedInferred.push({
              key: `ext_inlaw_p:${inLawParent}->${personB}`,
              sourceId: inLawParent,
              targetId: personB,
              label: pLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: inLawGroup,
              conflictReason: '',
            });
            extendedInferred.push({
              key: `ext_inlaw_c:${personB}->${inLawParent}`,
              sourceId: personB,
              targetId: inLawParent,
              label: bLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: inLawGroup,
              conflictReason: '',
            });
          });

          siblingEdges.forEach((sEdge) => {
            if (sEdge.targetId !== personA) return;
            const sibOfSpouse = sEdge.sourceId;
            if (sibOfSpouse === personB) return;
            // 若已经是亲兄弟姐妹则绝不覆盖为大舅哥！
            const existingSib = `${[sibOfSpouse, personB].sort().join('__')}__sibling`;
            if (dirGroupMap[`${sibOfSpouse}->${personB}__${existingSib}`]) return;

            const inLawGroup = `${[sibOfSpouse, personB].sort().join('__')}__in_law`;
            const sGender = idToGender[sibOfSpouse] || '未知';
            const bGender = idToGender[personB] || '未知';
            const isOlder = sEdge.label.includes('哥') || sEdge.label.includes('兄') || sEdge.label.includes('姐');

            let sToBLabel = '姻亲';
            let bToSLabel = '姻亲';
            if (spEdge.label.includes('妻') || spEdge.label.includes('老婆')) {
              sToBLabel = sGender === '男' ? (isOlder ? '大舅哥' : '小舅子') : isOlder ? '大姨子' : '小姨子';
              bToSLabel = isOlder ? '妹夫' : '姐夫';
            } else {
              bToSLabel = bGender === '女' ? (isOlder ? '弟妹' : '嫂子') : isOlder ? '妹夫' : '姐夫';
              sToBLabel = sGender === '男' ? (isOlder ? '大伯哥' : '小叔子') : isOlder ? '大姑姐' : '小姑子';
            }

            extendedInferred.push({
              key: `ext_inlaw_s1:${sibOfSpouse}->${personB}`,
              sourceId: sibOfSpouse,
              targetId: personB,
              label: sToBLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: inLawGroup,
              conflictReason: '',
            });
            extendedInferred.push({
              key: `ext_inlaw_s2:${personB}->${sibOfSpouse}`,
              sourceId: personB,
              targetId: sibOfSpouse,
              label: bToSLabel,
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: inLawGroup,
              conflictReason: '',
            });
          });
        });

        masterEdges.forEach((gmEdge) => {
          const grandMaster = gmEdge.sourceId;
          const master = gmEdge.targetId;
          masterEdges.forEach((mEdge) => {
            if (mEdge.sourceId !== master) return;
            const disciple = mEdge.targetId;
            if (disciple === grandMaster) return;
            const gmGroup = `${[grandMaster, disciple].sort().join('__')}__grandmaster`;
            extendedInferred.push({
              key: `ext_gm:${grandMaster}->${disciple}`,
              sourceId: grandMaster,
              targetId: disciple,
              label: '师祖',
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: gmGroup,
              conflictReason: '',
            });
            extendedInferred.push({
              key: `ext_gd:${disciple}->${grandMaster}`,
              sourceId: disciple,
              targetId: grandMaster,
              label: '徒孙',
              isInferred: true,
              inferScope: 'all',
              timeStr: '固定',
              pairGroupId: gmGroup,
              conflictReason: '',
            });
          });
        });

        extendedInferred.forEach(addOrMergeEdge);
      }

      // 融合大模型全局知识图谱缓存（强制通过 addOrMergeEdge 归一化去重，绝不产生重复的同门/丈夫/弟弟！）
      llmGlobalInferred.forEach((gRec) => {
        if (!nodeIdSet.has(gRec.sourceId) || !nodeIdSet.has(gRec.targetId)) return;
        if (inferDisplayMode === 'partial' && gRec.scope === 'all') return;
        if (!isTimeStrActive(gRec.timeStr, currentYear)) return;

        const normCat = canonicalizeCategory(gRec.label, gRec.category);
        const pairGroupId = `${[gRec.sourceId, gRec.targetId].sort().join('__')}__${normCat}`;
        addOrMergeEdge({
          key: `llm_global:${gRec.sourceId}->${gRec.targetId}:${gRec.label}`,
          sourceId: gRec.sourceId,
          targetId: gRec.targetId,
          label: gRec.label,
          isInferred: true,
          inferScope: gRec.scope,
          timeStr: gRec.timeStr,
          pairGroupId,
          conflictReason: '',
        });
      });
    }

    // 3. 终极去重锁 + 同名对称关系合并（如 朋友<->朋友、同门<->同门 合并为单根双向箭头）
    const dedupedLinks: LinkData[] = [];
    const consumedKeys = new Set<string>();
    const exactDirLabelSeen = new Set<string>();
    const dirEntries = Object.entries(dirGroupMap);

    dirEntries.forEach(([key, edge], idx) => {
      if (consumedKeys.has(key)) return;
      const revKey = `${edge.targetId}->${edge.sourceId}__${edge.pairGroupId}`;
      const revEdge = dirGroupMap[revKey];

      if (revEdge && !consumedKeys.has(revKey) && edge.label.trim() === revEdge.label.trim()) {
        consumedKeys.add(key);
        consumedKeys.add(revKey);
        const sortedArr = [edge.sourceId, edge.targetId].sort();
        const canonSrc = sortedArr[0]!;
        const canonTgt = sortedArr[1]!;
        const symSig = `${canonSrc}<->${canonTgt}::${edge.label.trim()}`;
        if (exactDirLabelSeen.has(symSig)) return;
        exactDirLabelSeen.add(symSig);

        const bothInferred = edge.isInferred && revEdge.isInferred;
        dedupedLinks.push({
          id: `link:${canonSrc}<->${canonTgt}__${edge.pairGroupId}`,
          source: canonSrc,
          target: canonTgt,
          sourceId: canonSrc,
          targetId: canonTgt,
          label: edge.label.trim(),
          isInferred: bothInferred,
          isSymmetricSingleLine: true,
          pairGroupId: edge.pairGroupId,
          conflictReason: edge.conflictReason || revEdge.conflictReason || '',
          totalBetweenNodes: 1,
          isExactlyTwoOpposite: false,
          canonOffsetPx: 0,
          canonLabelOffsetPx: 11,
          canonAlongOffsetPx: 0,
        });
      } else {
        consumedKeys.add(key);
        const dirSig = `${edge.sourceId}->${edge.targetId}::${edge.label.trim()}`;
        if (exactDirLabelSeen.has(dirSig)) return;
        exactDirLabelSeen.add(dirSig);

        dedupedLinks.push({
          id: `link:${edge.sourceId}->${edge.targetId}__${edge.pairGroupId}__${idx}`,
          source: edge.sourceId,
          target: edge.targetId,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          label: edge.label,
          isInferred: edge.isInferred,
          isSymmetricSingleLine: false,
          pairGroupId: edge.pairGroupId,
          conflictReason: edge.conflictReason || '',
          totalBetweenNodes: 1,
          isExactlyTwoOpposite: false,
          canonOffsetPx: 0,
          canonLabelOffsetPx: 11,
          canonAlongOffsetPx: 0,
        });
      }
    });

    let activeLinks = dedupedLinks;

// 4. 搜索过滤（同时支持搜索“人物名称”与“关系名称”）
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      // (a) 匹配人物节点
      const matchedNodeIds = new Set(activeNodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
      // (b) 匹配关系连线文字，并收集命中连线所属的语义组 pairGroupId（确保成组的配对关系如“父亲+儿子”、“妻子+丈夫”一并保留！）
      const matchedPairGroupIds = new Set(
        activeLinks.filter((l) => l.label.toLowerCase().includes(q)).map((l) => l.pairGroupId)
      );

      activeLinks = activeLinks.filter((l) => {
        // 若连线本身或其成组的配对关系命中搜索词，保留该组连线
        if (matchedPairGroupIds.has(l.pairGroupId)) return true;
        // 若连线两端有节点命中了人物搜索，保留该人物的关联连线
        if (matchedNodeIds.has(l.sourceId) || matchedNodeIds.has(l.targetId)) return true;
        return false;
      });

      // 仅展示命中人物节点以及上述保留连线两端的相关节点
      const visibleNodeIds = new Set<string>(matchedNodeIds);
      activeLinks.forEach((l) => {
        visibleNodeIds.add(l.sourceId);
        visibleNodeIds.add(l.targetId);
      });

      activeNodes = activeNodes.filter((n) => visibleNodeIds.has(n.id));
    }

    // 5. 孤立节点过滤
    const connectedIds = new Set<string>();
    activeLinks.forEach((l) => {
      connectedIds.add(l.sourceId);
      connectedIds.add(l.targetId);
    });
    activeNodes.forEach((n) => {
      n.isIsolated = !connectedIds.has(n.id);
    });
    if (!showIsolated) {
      activeNodes = activeNodes.filter((n) => !n.isIsolated);
      const allowed = new Set(activeNodes.map((n) => n.id));
      activeLinks = activeLinks.filter((l) => allowed.has(l.sourceId) && allowed.has(l.targetId));
    }

    // ---------------- 6. 均匀流式槽位（Uniform Slot）平行线与文字排版算法 ----------------
    // 彻底解决“间距有的超级大、有的超级小”以及多线文字重叠问题：
    //   - 同一语义对内部（如 妻子+丈夫）两条线间距为 INTRA_GAP (10px)，紧凑成对；
    //   - 相邻不同语义组之间的【边缘间距】固定为均匀的 INTER_GAP (16px)，绝不再按中心跳 24px 导致间距忽大忽小！
    const nodePairBuckets: Record<string, LinkData[]> = {};
    activeLinks.forEach((l) => {
      const pairKey = [l.sourceId, l.targetId].sort().join('<->');
      if (!nodePairBuckets[pairKey]) nodePairBuckets[pairKey] = [];
      nodePairBuckets[pairKey].push(l);
    });

    const INTRA_GAP = 10; // 同组配对双线之间的间距
    const INTER_GAP = 16; // 不同关系组之间的边缘间距

    Object.values(nodePairBuckets).forEach((bucket) => {
      if (bucket.length === 0) return; // 提前防御空数组
      const firstBucket = bucket[0]!;  // 强制断言一定存在
      const totalEdges = bucket.length;
      const [minId] = [firstBucket.sourceId, firstBucket.targetId].sort();

      const groupMap: Record<string, LinkData[]> = {};
      bucket.forEach((l) => {
        if (!groupMap[l.pairGroupId]) groupMap[l.pairGroupId] = [];
        groupMap[l.pairGroupId]!.push(l); // 强制断言
      });

      const semanticGroups = Object.keys(groupMap)
        .sort()
        .map((gid) => {
          const edges = groupMap[gid]!;
          edges.sort((a, b) => (a.sourceId === minId ? -1 : 1) - (b.sourceId === minId ? -1 : 1));
          return edges;
        });

      const groupCount = semanticGroups.length;
      const firstGroup = semanticGroups[0];
      if (!firstGroup) return;

      if (groupCount === 1 && firstGroup.length === 1) {
        const l = firstGroup[0]!; // 强制断言
        l.totalBetweenNodes = 1;
        l.isExactlyTwoOpposite = false;
        l.canonOffsetPx = 0;
        l.canonLabelOffsetPx = 11;
        l.canonAlongOffsetPx = 0;
        return;
      }

      if (groupCount === 1 && firstGroup.length === 2) {
        const line1 = firstGroup[0]!; // 强制断言第一条线存在
        const line2 = firstGroup[1]!; // 强制断言第二条线存在
        if (line1.sourceId !== line2.sourceId) {
          firstGroup.forEach((l) => {
            l.totalBetweenNodes = 2;
            l.isExactlyTwoOpposite = true;
            const isForward = l.sourceId === minId;
            l.canonOffsetPx = isForward ? INTRA_GAP / 2 : -INTRA_GAP / 2;
            l.canonLabelOffsetPx = isForward ? INTRA_GAP / 2 + 11 : -(INTRA_GAP / 2 + 11);
            l.canonAlongOffsetPx = isForward ? -14 : 14;
          });
          return;
        }
      }

      // 计算所有线在统一基准法向轴上的相对位置，保证组内间距 INTRA_GAP，组间边缘间距 INTER_GAP
      const rawOffsets: number[] = [];
      let cursor = 0;
      semanticGroups.forEach((grp, gIdx) => {
        if (gIdx > 0) cursor += INTER_GAP;
        grp.forEach((_l, innerIdx) => {
          if (innerIdx > 0) cursor += INTRA_GAP;
          rawOffsets.push(cursor);
        });
      });

      // 整体居中对称化
      const midSpan = cursor / 2;
      const centeredOffsets = rawOffsets.map((pos) => pos - midSpan);

      let flatIdx = 0;
      semanticGroups.forEach((grp) => {
        grp.forEach((l, innerIdx) => {
          const lineOffset = centeredOffsets[flatIdx] || 0; // 给一个默认值 0
          l.totalBetweenNodes = totalEdges;
          l.isExactlyTwoOpposite = false;
          l.canonOffsetPx = lineOffset;

          // 文字偏移：若在同组配对内部，第一条线文字偏左外侧 (-10px)，第二条线文字偏右外侧 (+10px)；单条线偏外侧
          let labelShift = 10;
          if (grp.length >= 2) {
            labelShift = innerIdx === 0 ? -10 : 10;
          } else {
            labelShift = lineOffset >= 0 ? 10 : -10;
          }
          l.canonLabelOffsetPx = lineOffset + labelShift;

          // 沿线方向阶梯错开，彻底避免多条平行线的文字挤在同一垂直切面上
          l.canonAlongOffsetPx = (flatIdx - (totalEdges - 1) / 2) * 22;
          flatIdx++;
        });
      });
    });

    return { nodes: activeNodes, links: activeLinks };
  }, [
    rawFiles,
    baseResolvedEdges,
    llmGlobalInferred,
    currentYear,
    searchQuery,
    showIsolated,
    enableInferred,
    inferDisplayMode,
  ]);

  // ---------------- 独立几何坐标更新函数（修复箭头顶部刺出线条 & 解决对角线交叉文字碰撞） ----------------
  const updateGraphPositions = useCallback(() => {
    if (!containerRef.current) return;
    const container = d3.select(containerRef.current);
    const { nodeSize: r, showArrow: arrowOn, linkThickness: thickness } = styleParamsRef.current;

    // 箭头总长度随粗细动态计算（与 applyVisualStyles 中的 markerWidth 完全一致）
    const fullArrowLen = Math.max(7, 5 + thickness * 2.8);
    const halfArrowLen = Math.max(8, 6 + thickness * 3.0);

    const geomMap: Record<string, { x1: number; y1: number; x2: number; y2: number; mx: number; my: number; cUx: number; cUy: number; len: number; label: string }> = {};

    simLinksRef.current.forEach((d) => {
      const src = d.source as NodeData;
      const tgt = d.target as NodeData;
      if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) return;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < r * 2 + 6) return;
      const ux = dx / len;
      const uy = dy / len;

      const isCanonForward = d.sourceId < d.targetId;
      const cUx = isCanonForward ? ux : -ux;
      const cUy = isCanonForward ? uy : -uy;
      const cNx = cUy;
      const cNy = -cUx;

      const sx = src.x + cNx * d.canonOffsetPx;
      const sy = src.y + cNy * d.canonOffsetPx;
      const tx = tgt.x + cNx * d.canonOffsetPx;
      const ty = tgt.y + cNy * d.canonOffsetPx;

      const absOffset = Math.min(Math.abs(d.canonOffsetPx), r - 1);
      const radialEdge = Math.sqrt(Math.max(4, r * r - absOffset * absOffset));

      // 关键修复：线条终点停在【节点圆周 + 箭头完整长度】处（而 marker 的 refX 设为底座 0），
      // 这样粗线条恰好连接到箭头底座，100% 绝不会从箭头尖端刺出！
      const isHalf = d.isExactlyTwoOpposite && d.totalBetweenNodes === 2;
      const curArrowLen = isHalf ? halfArrowLen : fullArrowLen;

      const startPad = arrowOn && d.isSymmetricSingleLine ? curArrowLen + 1.5 : 2;
      const endPad = arrowOn ? curArrowLen + 1.5 : 2;
      if (len <= radialEdge * 2 + startPad + endPad) return;

      const startInset = radialEdge + startPad;
      const endInset = radialEdge + endPad;

      const x1 = sx + ux * startInset;
      const y1 = sy + uy * startInset;
      const x2 = tx - ux * endInset;
      const y2 = ty - uy * endInset;

      let labelOff = d.canonLabelOffsetPx;
      if (d.totalBetweenNodes === 1) {
        labelOff = cNy < 0 ? Math.abs(labelOff) : -Math.abs(labelOff);
      }
      const alongShift = Math.max(-len * 0.34, Math.min(len * 0.34, d.canonAlongOffsetPx));
      const mx = (src.x + tgt.x) / 2 + cUx * alongShift + cNx * labelOff;
      const my = (src.y + tgt.y) / 2 + cUy * alongShift + cNy * labelOff;

      geomMap[d.id] = { x1, y1, x2, y2, mx, my, cUx, cUy, len, label: d.label };
    });

    // 全局连线文字防碰撞检测
    const geomEntries = Object.values(geomMap);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < geomEntries.length; i++) {
        for (let j = i + 1; j < geomEntries.length; j++) {
          const g1 = geomEntries[i]!;
          const g2 = geomEntries[j]!;
          const w1 = Math.max(26, g1.label.length * 12);
          const w2 = Math.max(26, g2.label.length * 12); // 补上缺失的 w2 定义
          const minDx = (w1 + w2) / 2 + 4;
          const minDy = 15;

          const distX = Math.abs(g1.mx - g2.mx);
          const distY = Math.abs(g1.my - g2.my);

          if (distX < minDx && distY < minDy) {
            // 发生碰撞：将两条线的文字分别沿着各自连线方向一前一后推开 18px
            const push = 18;
            g1.mx -= g1.cUx * push;
            g1.my -= g1.cUy * push;
            g2.mx += g2.cUx * push;
            g2.my += g2.cUy * push;
          }
        }
      }
    }

    container
      .select('.links-layer')
      .selectAll<SVGPathElement, LinkData>('.link-path')
      .attr('d', (d) => {
        const g = geomMap[d.id];
        return g ? `M${g.x1},${g.y1}L${g.x2},${g.y2}` : '';
      });

    container
      .select('.links-layer')
      .selectAll<SVGPathElement, LinkData>('.link-hit-area')
      .attr('d', (d) => {
        const g = geomMap[d.id];
        return g ? `M${g.x1},${g.y1}L${g.x2},${g.y2}` : '';
      });

    container
      .select('.links-layer')
      .selectAll<SVGTextElement, LinkData>('.link-text')
      .text((d) => d.label)
      .attr('transform', (d) => {
        const g = geomMap[d.id];
        return g ? `translate(${g.mx},${g.my})` : '';
      });

    container
      .select('.nodes-layer')
      .selectAll<SVGGElement, NodeData>('.node-group')
      .attr('transform', (d) => {
        const x = d.x ?? 0;
        const y = d.y ?? 0;
        GLOBAL_NODE_CACHE[d.id] = { x, y, vx: d.vx ?? 0, vy: d.vy ?? 0 };
        return `translate(${x},${y})`;
      });
  }, []);

  // 独立视觉样式渲染函数（显著放大粗线条下的箭头翼展与长度，彻底解决“变粗后箭头不明显”）
  const applyVisualStyles = useCallback(() => {
    if (!containerRef.current || !svgRef.current) return;
    const container = d3.select(containerRef.current);
    const svg = d3.select(svgRef.current);
    const {
      nodeSize: r,
      nodeFontSize: fontSize,
      showArrow: arrowOn,
      linkThickness: thickness,
      nodeOpacity: nOp,
      nodeTextOpacity: ntOp,
      linkOpacity: lOp,
      linkTextOpacity: ltOp,
      unselectedOpacity: unOp,
      colorGroups: groups,
      activeNodeId: focusId,
    } = styleParamsRef.current;

    const currentLinks = simLinksRef.current;
    const conflictColor = '#e03131';

    // 关键升级：大幅提升箭头随连线粗细 (thickness) 的缩放系数，保证粗线下的箭头棱角分明、极其明显！
    const fullArrowLen = Math.max(7, 5 + thickness * 2.8);
    const fullArrowWing = Math.max(6.5, 4.8 + thickness * 2.6);
    const halfArrowLen = Math.max(8, 6 + thickness * 3.0);
    const halfArrowWing = Math.max(6, 4.5 + thickness * 2.4);

    ['#full-arrow', '#full-arrow-active', '#full-arrow-conflict', '#full-arrow-start', '#full-arrow-start-active', '#full-arrow-start-conflict'].forEach((sel) => {
      svg.select(sel).attr('markerWidth', fullArrowLen).attr('markerHeight', fullArrowWing);
    });
    ['#half-arrow', '#half-arrow-active', '#half-arrow-conflict'].forEach((sel) => {
      svg.select(sel).attr('markerWidth', halfArrowLen).attr('markerHeight', halfArrowWing);
    });

    const neighborIds = new Set<string>();
    if (focusId) {
      neighborIds.add(focusId);
      currentLinks.forEach((l) => {
        if (l.sourceId === focusId) neighborIds.add(l.targetId);
        if (l.targetId === focusId) neighborIds.add(l.sourceId);
      });
    }

    const getNodeFill = (label: string) => {
      const matched = groups.find((g) => g.keyword.trim() !== '' && label.includes(g.keyword.trim()));
      return matched ? matched.color : 'var(--text-muted)';
    };

    container
      .select('.nodes-layer')
      .selectAll<SVGCircleElement, NodeData>('.node-circle')
      .attr('r', (d) => (d.id === focusId ? r + 2 : r))
      .attr('fill', (d) => getNodeFill(d.label))
      .attr('stroke', (d) => (d.id === focusId ? 'var(--interactive-accent)' : 'none'))
      .attr('stroke-width', (d) => (d.id === focusId ? 2.5 : 0))
      .style('opacity', (d) => {
        if (!focusId) return nOp;
        return neighborIds.has(d.id) ? nOp : unOp;
      });

    container
      .select('.nodes-layer')
      .selectAll<SVGTextElement, NodeData>('.node-text')
      .text((d) => d.label)
      .attr('font-size', `${fontSize}px`)
      .attr('x', (d) => (d.id === focusId ? r + 7 : r + 5))
      .attr('y', Math.round(fontSize * 0.35))
      .attr('font-weight', (d) => (d.id === focusId ? 'bold' : 'normal'))
      .attr('fill', (d) => (d.id === focusId ? 'var(--interactive-accent)' : 'var(--text-normal)'))
      .style('opacity', (d) => {
        if (!focusId) return ntOp;
        return neighborIds.has(d.id) ? ntOp : unOp;
      });

    container
      .select('.links-layer')
      .selectAll<SVGPathElement, LinkData>('.link-path')
      .attr('stroke', (d) => {
        if (d.conflictReason) return conflictColor;
        if (!focusId) return 'var(--text-faint)';
        if (d.targetId === focusId || d.sourceId === focusId) return 'var(--interactive-accent)';
        return 'var(--background-modifier-border)';
      })
      .attr('stroke-width', (d) => {
        const baseW = d.conflictReason ? Math.max(thickness, 2) : thickness;
        if (!focusId) return baseW;
        return d.targetId === focusId || d.sourceId === focusId ? baseW * 1.35 : baseW;
      })
      .attr('stroke-dasharray', (d) => (d.isInferred && !d.isSymmetricSingleLine ? '4,4' : 'none'))
      .attr('marker-end', (d) => {
        if (!arrowOn) return 'none';
        const isConflict = Boolean(d.conflictReason);
        const isHighlighted = Boolean(focusId && (d.targetId === focusId || d.sourceId === focusId));
        if (d.isExactlyTwoOpposite && d.totalBetweenNodes === 2) {
          if (isConflict) return 'url(#half-arrow-conflict)';
          return isHighlighted ? 'url(#half-arrow-active)' : 'url(#half-arrow)';
        }
        if (isConflict) return 'url(#full-arrow-conflict)';
        return isHighlighted ? 'url(#full-arrow-active)' : 'url(#full-arrow)';
      })
      .attr('marker-start', (d) => {
        if (!arrowOn || !d.isSymmetricSingleLine) return 'none';
        const isConflict = Boolean(d.conflictReason);
        const isHighlighted = Boolean(focusId && (d.targetId === focusId || d.sourceId === focusId));
        if (isConflict) return 'url(#full-arrow-start-conflict)';
        return isHighlighted ? 'url(#full-arrow-start-active)' : 'url(#full-arrow-start)';
      })
      .style('opacity', (d) => {
        if (d.conflictReason && !focusId) return 1;
        if (!focusId) return lOp;
        return d.sourceId === focusId || d.targetId === focusId ? Math.max(lOp, 0.95) : unOp;
      });

    container
      .select('.links-layer')
      .selectAll<SVGTextElement, LinkData>('.link-text')
      .attr('fill', (d) => {
        if (d.conflictReason) return conflictColor;
        if (focusId && (d.targetId === focusId || d.sourceId === focusId)) {
          return 'var(--interactive-accent)';
        }
        return 'var(--text-muted)';
      })
      .attr('font-weight', (d) => {
        if (d.conflictReason) return '700';
        return focusId && (d.targetId === focusId || d.sourceId === focusId) ? '600' : 'normal';
      })
      .style('cursor', (d) => (d.conflictReason ? 'help' : 'default'))
      .style('opacity', (d) => {
        if (d.conflictReason && !focusId) return 1;
        if (!focusId) return ltOp;
        return d.sourceId === focusId || d.targetId === focusId ? Math.max(ltOp, 0.95) : unOp;
      });

    svg.select('#full-arrow path').attr('fill', 'var(--text-faint)');
    svg.select('#full-arrow-start path').attr('fill', 'var(--text-faint)');
    svg.select('#half-arrow path').attr('fill', 'var(--text-faint)');
    svg.select('#full-arrow-active path').attr('fill', 'var(--interactive-accent)');
    svg.select('#full-arrow-start-active path').attr('fill', 'var(--interactive-accent)');
    svg.select('#half-arrow-active path').attr('fill', 'var(--interactive-accent)');
    svg.select('#full-arrow-conflict path').attr('fill', conflictColor);
    svg.select('#full-arrow-start-conflict path').attr('fill', conflictColor);
    svg.select('#half-arrow-conflict path').attr('fill', conflictColor);
  }, []);

  // 初始化 D3 Simulation（将所有箭头的 refX 定在底座，彻底根治“箭头顶部有线超出”）
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const container = d3.select(containerRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    svg.selectAll('defs').remove();
    const defs = svg.append('defs');

    // 1. 终点完整三角形箭头：refX="0.5" 定在箭头左端底座！线条只画到箭头底座即停止，绝不可能刺穿箭头尖端 (x=10)！
    ['full-arrow', 'full-arrow-active', 'full-arrow-conflict'].forEach((id) => {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 0.5)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 10)
        .attr('markerHeight', 9)
        .attr('markerUnits', 'userSpaceOnUse')
        .append('path')
        .attr('d', 'M0,-4.5 L10,0 L0,4.5 Z');
    });

    // 2. 起点反向完整三角形箭头：refX="9.5" 定在右侧底座，尖端朝左指向 x=0，同样绝不刺穿！
    ['full-arrow-start', 'full-arrow-start-active', 'full-arrow-start-conflict'].forEach((id) => {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9.5)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 10)
        .attr('markerHeight', 9)
        .attr('markerUnits', 'userSpaceOnUse')
        .append('path')
        .attr('d', 'M10,-4.5 L0,0 L10,4.5 Z');
    });

    // 3. 外侧半边三角形箭头（专用于 2 根不同称谓的平行双线 ⇌）：refX="0.5" 定在底座，尖角在 x=10，外翼展 y=-5
    ['half-arrow', 'half-arrow-active', 'half-arrow-conflict'].forEach((id) => {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -6 10 8')
        .attr('refX', 0.5)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 10)
        .attr('markerHeight', 8)
        .attr('markerUnits', 'userSpaceOnUse')
        .append('path')
        .attr('d', 'M0,0.5 L10,0.5 L0,-5 Z');
    });

    container.selectAll('*').remove();
    container.append('g').attr('class', 'links-layer');
    container.append('g').attr('class', 'nodes-layer');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });
    svg.call(zoom);

    const sim = d3
      .forceSimulation<NodeData, LinkData>()
      .force(
        'link',
        d3
          .forceLink<NodeData, LinkData>()
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(linkAttractStrength)
      )
      .force('charge', d3.forceManyBody<NodeData>().strength(-repelStrength))
      .force('x', d3.forceX<NodeData>(width / 2).strength(centerStrength * 0.25))
      .force('y', d3.forceY<NodeData>(height / 2).strength(centerStrength * 0.25))
      .force('collide', d3.forceCollide<NodeData>().radius(nodeSize + 18).iterations(2))
      .alphaDecay(0.035)
      .on('tick', () => {
        updateGraphPositions();
      });

    simulationRef.current = sim;

    return () => {
      sim.stop();
      simulationRef.current = null;
    };
  }, []);

  // 数据同步至 D3
  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim || !containerRef.current || !svgRef.current) return;

    const container = d3.select(containerRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const existingMap: Record<string, NodeData> = {};
    simNodesRef.current.forEach((n) => {
      existingMap[n.id] = n;
    });

    const nextNodes: NodeData[] = nodes.map((n, idx) => {
      const prev = existingMap[n.id];
      if (prev && prev.x !== undefined && prev.y !== undefined) {
        prev.label = n.label;
        prev.realName = n.realName;
        prev.gender = n.gender;
        prev.isIsolated = n.isIsolated;
        return prev;
      }
      const cached = GLOBAL_NODE_CACHE[n.id];
      if (cached && cached.x !== undefined && cached.y !== undefined) {
        return { ...n, x: cached.x, y: cached.y, vx: 0, vy: 0 };
      }
      const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        ...n,
        x: width / 2 + Math.cos(angle) * 120,
        y: height / 2 + Math.sin(angle) * 120,
        vx: 0,
        vy: 0,
      };
    });

    const nodeLookup: Record<string, NodeData> = {};
    nextNodes.forEach((n) => {
      nodeLookup[n.id] = n;
    });

    const nextLinks: LinkData[] = links
      .filter((l) => nodeLookup[l.sourceId] && nodeLookup[l.targetId])
      .map((l) => ({
        ...l,
        source: nodeLookup[l.sourceId] as string | NodeData, // 强制断言
        target: nodeLookup[l.targetId] as string | NodeData, // 强制断言
      }));

    simNodesRef.current = nextNodes;
    simLinksRef.current = nextLinks;

    const linkGroups = container
      .select('.links-layer')
      .selectAll<SVGGElement, LinkData>('.link-group')
      .data(nextLinks, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'link-group');
          g.append('path')
            .attr('class', 'link-hit-area')
            .attr('fill', 'none')
            .attr('stroke', 'transparent')
            .attr('stroke-width', 14);
          g.append('path').attr('class', 'link-path').attr('fill', 'none').style('pointer-events', 'none');
          g.append('text')
            .attr('class', 'link-text')
            .attr('font-size', '11px')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .style('user-select', 'none');
          return g;
        },
        (update) => {
          update.select('.link-hit-area').datum((d) => d);
          update.select('.link-path').datum((d) => d);
          update.select('.link-text').datum((d) => d);
          return update;
        },
        (exit) => exit.remove()
      );

    linkGroups
      .style('cursor', (d) => (d.conflictReason ? 'help' : 'default'))
      .on('mouseenter', (event: MouseEvent, d) => {
        if (!d.conflictReason) return;
        const srcLabel = (d.source as NodeData).label || d.sourceId;
        const tgtLabel = (d.target as NodeData).label || d.targetId;
        setConflictTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          title: `⚠️ 关系冲突：${srcLabel} → ${tgtLabel} (${d.label})`,
          reason: d.conflictReason,
        });
      })
      .on('mousemove', (event: MouseEvent, d) => {
        if (!d.conflictReason) return;
        setConflictTooltip((prev) => (prev.visible ? { ...prev, x: event.clientX, y: event.clientY } : prev));
      })
      .on('mouseleave', () => {
        setConflictTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      });

    const nodeGroups = container
      .select('.nodes-layer')
      .selectAll<SVGGElement, NodeData>('.node-group')
      .data(nextNodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', 'node-group')
            .style('cursor', 'grab')
            .call(
              d3
                .drag<SVGGElement, NodeData>()
                .on('start', (event, d) => {
                  if (!event.active && simulationRef.current) {
                    simulationRef.current.alphaTarget(0.25).restart();
                  }
                  d.fx = d.x;
                  d.fy = d.y;
                  setDraggingNodeId(d.id);
                })
                .on('drag', (event, d) => {
                  d.fx = event.x;
                  d.fy = event.y;
                })
                .on('end', (event, d) => {
                  if (!event.active && simulationRef.current) {
                    simulationRef.current.alphaTarget(0);
                  }
                  d.fx = null;
                  d.fy = null;
                  setDraggingNodeId(null);
                })
            );
          g.append('circle').attr('class', 'node-circle');
          g.append('text')
            .attr('class', 'node-text')
            .style('pointer-events', 'none')
            .style('user-select', 'none');
          return g;
        },
        (update) => {
          update.select('.node-circle').datum((d) => d);
          update.select('.node-text').datum((d) => d);
          return update;
        },
        (exit) => exit.remove()
      );

    nodeGroups
      .on('mouseenter', (_event, d) => setHoveredNodeId(d.id))
      .on('mouseleave', () => setHoveredNodeId(null))
      .on('click', (event, d) => {
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) {
          plugin?.app?.workspace?.openLinkText(d.realName, '', true);
        } else {
          setSelectedNodeId((prev) => (prev === d.id ? null : d.id));
        }
      });

    d3.select(svgRef.current).on('click', () => setSelectedNodeId(null));

    sim.nodes(nextNodes);
    const linkForce = sim.force('link') as d3.ForceLink<NodeData, LinkData>;
    if (linkForce) linkForce.links(nextLinks);

    updateGraphPositions();
    applyVisualStyles();

    sim.alpha(0.08).restart();
  }, [nodes, links, plugin, updateGraphPositions, applyVisualStyles]);

  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim || !svgRef.current) return;
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const linkForce = sim.force('link') as d3.ForceLink<NodeData, LinkData>;
    if (linkForce) {
      linkForce.distance(linkDistance);
      linkForce.strength(linkAttractStrength);
    }

    const chargeForce = sim.force('charge') as d3.ForceManyBody<NodeData>;
    if (chargeForce) {
      chargeForce.strength(-repelStrength);
    }

    const forceX = sim.force('x') as d3.ForceX<NodeData>;
    if (forceX) {
      forceX.x(width / 2).strength(centerStrength * 0.28);
    }

    const forceY = sim.force('y') as d3.ForceY<NodeData>;
    if (forceY) {
      forceY.y(height / 2).strength(centerStrength * 0.28);
    }

    const collideForce = sim.force('collide') as d3.ForceCollide<NodeData>;
    if (collideForce) {
      collideForce.radius(nodeSize + 16);
    }

    updateGraphPositions();
    applyVisualStyles();
    sim.alpha(0.35).restart();
  }, [centerStrength, repelStrength, linkAttractStrength, linkDistance, nodeSize, updateGraphPositions, applyVisualStyles]);

  useEffect(() => {
    updateGraphPositions();
    applyVisualStyles();
  }, [
    nodeFontSize,
    showArrow,
    linkThickness,
    nodeOpacity,
    nodeTextOpacity,
    linkOpacity,
    linkTextOpacity,
    unselectedOpacity,
    colorGroups,
    activeNodeId,
    updateGraphPositions,
    applyVisualStyles,
  ]);

  // 全汉化双层时间轴刻度计算
  const timelineTicks = useMemo(() => {
    const halfSpan = viewSpan / 2;
    const startVal = currentYear - halfSpan;
    const endVal = currentYear + halfSpan;

    const primaryTicks: { pos: number; label: string }[] = [];
    const secondaryTicks: { pos: number; label: string; isMajor?: boolean }[] = [];

    const toPx = (val: number) => ((val - startVal) / viewSpan) * timelineWidth;

    const formatYearZh = (y: number, withSuffix = true) => {
      if (y <= 0) {
        const bc = Math.abs(y) + (y === 0 ? 1 : 0);
        return withSuffix ? `${bc} BC` : `${bc}`;
      }
      return withSuffix ? `${y}年` : `${y}`;
    };

    if (viewSpan >= 6) {
      let secStep = 1;
      if (viewSpan > 800) secStep = 100;
      else if (viewSpan > 350) secStep = 50;
      else if (viewSpan > 160) secStep = 20;
      else if (viewSpan > 80) secStep = 10;
      else if (viewSpan > 35) secStep = 5;
      else if (viewSpan > 16) secStep = 2;
      else secStep = 1;

      const priStep = secStep * 2;
      const firstSec = Math.floor(startVal / secStep) * secStep;

      for (let y = firstSec; y <= endVal + secStep; y += secStep) {
        const px = toPx(y);
        if (px >= -40 && px <= timelineWidth + 40) {
          secondaryTicks.push({ pos: px, label: formatYearZh(y, false), isMajor: y % priStep === 0 });
          if (y % priStep === 0) {
            primaryTicks.push({ pos: px, label: formatYearZh(y, true) });
          }
        }
      }
    } else if (viewSpan >= 0.45) {
      const startY = Math.floor(startVal);
      const endY = Math.ceil(endVal);
      const monthStep = viewSpan > 2.2 ? 3 : 1;

      for (let y = startY; y <= endY; y++) {
        const yPx = toPx(y);
        if (yPx >= -60 && yPx <= timelineWidth + 60) {
          primaryTicks.push({ pos: yPx, label: formatYearZh(y, true) });
        }
        for (let m = 0; m < 12; m += monthStep) {
          const mVal = y + m / 12;
          const mPx = toPx(mVal);
          if (mPx >= -30 && mPx <= timelineWidth + 30) {
            secondaryTicks.push({ pos: mPx, label: MONTH_NAMES_ZH[m] || '', isMajor: m === 0 });
          }
        }
      }
    } else if (viewSpan >= 0.03) {
      const startY = Math.floor(startVal);
      const endY = Math.ceil(endVal);
      const dayStep = viewSpan > 0.12 ? 7 : 2;

      for (let y = startY; y <= endY; y++) {
        let accDays = 0;
        for (let m = 0; m < 12; m++) {
          const mStartVal = y + accDays / 365;
          const mPx = toPx(mStartVal);
          if (mPx >= -80 && mPx <= timelineWidth + 80) {
            primaryTicks.push({ pos: mPx, label: `${formatYearZh(y, true)} ${MONTH_NAMES_ZH[m]}` });
          }
          const daysInM = MONTH_DAYS[m] || 30; // 这里的非空断言
          for (let d = 1; d <= daysInM; d += dayStep) {
            if (dayStep === 7 && d > 25) continue;
            const dVal = y + (accDays + d - 1) / 365;
            const dPx = toPx(dVal);
            if (dPx >= -20 && dPx <= timelineWidth + 20) {
              secondaryTicks.push({ pos: dPx, label: `${d}日`, isMajor: d === 1 });
            }
          }
          accDays += daysInM;
        }
      }
    } else {
      const dayUnit = 1 / 365;
      const firstDayIdx = Math.floor(startVal / dayUnit);
      const lastDayIdx = Math.ceil(endVal / dayUnit);
      const hourStep = viewSpan > 0.01 ? 6 : 3;

      for (let dIdx = firstDayIdx; dIdx <= lastDayIdx; dIdx++) {
        const dVal = dIdx * dayUnit;
        const dPx = toPx(dVal);
        if (dPx >= -140 && dPx <= timelineWidth + 140) {
          const info = decomposeDecimalYear(dVal + 0.00001);
          const yStr = info.isBC ? `${info.displayYear} BC` : `${info.displayYear}年`;
          primaryTicks.push({
            pos: dPx,
            label: `${yStr} ${info.monthNameZh} ${info.day}日 ${info.weekNameZh}`,
          });
        }
        for (let hr = 0; hr < 24; hr += hourStep) {
          const hVal = dVal + (hr / 24) * dayUnit;
          const hPx = toPx(hVal);
          if (hPx >= -30 && hPx <= timelineWidth + 30) {
            secondaryTicks.push({ pos: hPx, label: `${String(hr).padStart(2, '0')}:00`, isMajor: hr === 0 });
          }
        }
      }
    }
    return { primaryTicks, secondaryTicks };
  }, [currentYear, viewSpan, timelineWidth]);

  const isDraggingTimeline = useRef(false);
  const dragStartX = useRef(0);
  const dragStartYear = useRef(0);

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    isDraggingTimeline.current = true;
    dragStartX.current = e.clientX;
    dragStartYear.current = currentYear;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingTimeline.current) return;
      const dx = e.clientX - dragStartX.current;
      const yearDelta = (dx / Math.max(1, timelineWidth)) * viewSpan;
      const nextY = Math.max(minRangeDecimal, Math.min(maxRangeDecimal, dragStartYear.current - yearDelta));
      setCurrentYear(nextY);
    };
    const handleMouseUp = () => {
      isDraggingTimeline.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [viewSpan, timelineWidth, minRangeDecimal, maxRangeDecimal]);

  const handleTimelineWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const zoomFactor = e.deltaY > 0 ? 1.22 : 0.82;
    setViewSpan((prev) => Math.max(0.005, Math.min(3000, prev * zoomFactor)));
  };

  const handleJumpDate = () => {
    setCurrentYear(ymdToDecimal(jumpYMD));
  };

  const formatRangeLabel = (ymd: YMDState) => {
    const yStr = ymd.isBC ? `${ymd.year} BC` : `${ymd.year}年`;
    return `${yStr}${ymd.month}月${ymd.day}日`;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'transparent', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, width: '100%', overflow: 'hidden' }}>
        {nodes.length === 0 && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-muted)', textAlign: 'center', pointerEvents: 'none' }}>
            当前时间或筛选条件下暂无人物节点。<br />
            请检查文件夹路径配置或调整底部时间轴。
          </div>
        )}

        {/* 红色冲突连线悬浮 Tooltip 层 */}
        {conflictTooltip.visible && (
          <div
            style={{
              position: 'fixed',
              left: conflictTooltip.x + 14,
              top: conflictTooltip.y + 14,
              maxWidth: '300px',
              padding: '10px 12px',
              background: 'var(--background-primary)',
              border: '1.5px solid #e03131',
              borderRadius: '8px',
              boxShadow: '0 6px 20px rgba(224, 49, 49, 0.25)',
              zIndex: 9999,
              pointerEvents: 'none',
              fontSize: '12px',
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e03131', fontWeight: 700, marginBottom: '4px' }}>
              <AlertTriangle size={14} color="#e03131" />
              <span>{conflictTooltip.title}</span>
            </div>
            <div style={{ color: 'var(--text-normal)' }}>{conflictTooltip.reason}</div>
          </div>
        )}

        {/* 顶部居中：大模型异步分析进程浮窗 */}
        {llmLoading && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '7px 16px',
              background: 'var(--background-secondary)',
              border: '1px solid var(--interactive-accent)',
              borderRadius: '20px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: 'var(--text-normal)',
              zIndex: 25,
            }}
          >
            <RefreshCw size={14} color="var(--interactive-accent)" />
            <span>{llmStepText || '大模型正在补全全局关系...'}</span>
          </div>
        )}

        {/* 左上角：AI 重新推演按钮 & 仅在点击锁定时展示的“当前焦点” */}
        <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10 }}>
          <button
            onClick={() => runLlmAnalysis(currentFingerprint, true)}
            disabled={llmLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              background: 'var(--background-primary)',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '6px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              cursor: llmLoading ? 'wait' : 'pointer',
            }}
            title="将全量人物交给大模型做全局知识图谱补全与冲突检测"
          >
            <Sparkles color="var(--interactive-accent)" size={13} />
            <span>{llmLoading ? '推演中...' : 'AI 重新推演关系'}</span>
          </button>

          {selectedNodeId && (
            <div
              style={{
                padding: '5px 12px',
                background: 'var(--background-secondary)',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-normal)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>
                当前焦点: <strong style={{ color: 'var(--interactive-accent)' }}>{nodes.find((n) => n.id === selectedNodeId)?.label || selectedNodeId}</strong>
              </span>
              <span style={{ color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setSelectedNodeId(null)}>
                (点击取消锁定)
              </span>
            </div>
          )}
        </div>

        <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}>
          <g ref={containerRef}></g>
        </svg>

        {!isPanelOpen && (
          <button
            onClick={() => setIsPanelOpen(true)}
            style={{ position: 'absolute', top: 16, right: 16, padding: '8px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: '6px', cursor: 'pointer', zIndex: 10 }}
            title="打开图谱设置"
          >
            <Settings color="var(--text-muted)" size={18} />
          </button>
        )}

        {/* 图谱设置面板 */}
        {isPanelOpen && (
          <div style={{ position: 'absolute', top: 16, right: 16, width: '320px', maxHeight: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: '13px', zIndex: 20, overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--background-secondary)', borderBottom: '1px solid var(--background-modifier-border)' }}>
              <strong style={{ fontSize: '14px', color: 'var(--text-normal)' }}>图谱设置</strong>
              <button onClick={() => setIsPanelOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }} title="关闭设置">
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
              <Accordion defaultOpen={true} title="筛选">
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--background-secondary)', borderRadius: '4px', padding: '4px 8px', marginBottom: '10px', border: '1px solid var(--background-modifier-border)' }}>
                  <Search color="var(--text-muted)" size={14} />
                  <input
                    type="text"
                    placeholder="搜索人物或关系"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ border: 'none', background: 'transparent', outline: 'none', marginLeft: '6px', flex: 1, color: 'var(--text-normal)', fontSize: '12px' }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      title="清空搜索内容"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', marginBottom: '8px' }}>
                  <input type="checkbox" checked={showIsolated} onChange={(e) => setShowIsolated(e.target.checked)} />
                  显示孤立节点
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)' }}>
                  <input type="checkbox" checked={enableInferred} onChange={(e) => setEnableInferred(e.target.checked)} />
                  开启推算关系
                </label>

                {enableInferred && (
                  <div
                    style={{
                      marginTop: '8px',
                      marginLeft: '18px',
                      padding: '8px 10px',
                      background: 'var(--background-secondary)',
                      borderRadius: '6px',
                      borderLeft: '2px solid var(--interactive-accent)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontSize: '12px' }}
                      title="仅展示直接反向关系与核心直系血亲/同门闭环（如兄弟共享父母、夫妻共享儿女）"
                    >
                      <input
                        type="radio"
                        name="inferDisplayMode"
                        checked={inferDisplayMode === 'partial'}
                        onChange={() => setInferDisplayMode('partial')}
                      />
                      展示部分推算关系
                    </label>
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontSize: '12px' }}
                      title="展示包含跨代（祖孙/师祖）、旁系（叔伯/姑舅）与姻亲（嫂子/岳父母/大舅哥）在内的全部全局推算关系"
                    >
                      <input
                        type="radio"
                        name="inferDisplayMode"
                        checked={inferDisplayMode === 'all'}
                        onChange={() => setInferDisplayMode('all')}
                      />
                      展示全部推算关系
                    </label>
                  </div>
                )}
              </Accordion>

              <Accordion defaultOpen={false} title="颜色组">
                {colorGroups.map((cg, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <input type="color" value={cg.color} onChange={(e) => { const next = [...colorGroups]; if(next[i]){ next[i].color = e.target.value; setColorGroups(next); } }} style={{ width: '24px', height: '24px', padding: 0, border: 'none', cursor: 'pointer' }} />
                    <input type="text" value={cg.keyword} onChange={(e) => { const next = [...colorGroups]; if(next[i]){ next[i].keyword = e.target.value; setColorGroups(next); } }} style={{ flex: 1, padding: '4px 6px', border: '1px solid var(--background-modifier-border)', borderRadius: '4px', background: 'var(--background-primary)', color: 'var(--text-normal)' }} placeholder="包含关键词..." />
                    <X color="#ef4444" cursor="pointer" size={14} onClick={() => setColorGroups(colorGroups.filter((_, idx) => idx !== i))} />
                  </div>
                ))}
                <button onClick={() => setColorGroups([...colorGroups, { keyword: '', color: '#3b82f6' }])} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '5px', background: 'var(--background-secondary)', border: '1px dashed var(--background-modifier-border)', borderRadius: '4px', cursor: 'pointer', marginTop: '8px', color: 'var(--text-normal)' }}>
                  <Plus size={14} style={{ marginRight: '4px' }} /> 添加颜色组
                </button>
              </Accordion>

              <Accordion defaultOpen={true} title="外观">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  <input type="checkbox" checked={showArrow} onChange={(e) => setShowArrow(e.target.checked)} />
                  显示连线箭头
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  节点大小: {nodeSize}
                  <input type="range" min="3" max="22" step="1" value={nodeSize} onChange={(e) => setNodeSize(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  节点文字大小: {nodeFontSize}px
                  <input type="range" min="9" max="24" step="1" value={nodeFontSize} onChange={(e) => setNodeFontSize(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  连线粗细 (含箭头大小): {linkThickness}
                  <input type="range" min="0.5" max="5" step="0.5" value={linkThickness} onChange={(e) => setLinkThickness(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  节点不透明度: {nodeOpacity}
                  <input type="range" min="0.1" max="1" step="0.05" value={nodeOpacity} onChange={(e) => setNodeOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  节点文本不透明度: {nodeTextOpacity}
                  <input type="range" min="0" max="1" step="0.05" value={nodeTextOpacity} onChange={(e) => setNodeTextOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  连线不透明度: {linkOpacity}
                  <input type="range" min="0.1" max="1" step="0.05" value={linkOpacity} onChange={(e) => setLinkOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  连线文本不透明度: {linkTextOpacity}
                  <input type="range" min="0" max="1" step="0.05" value={linkTextOpacity} onChange={(e) => setLinkTextOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', color: 'var(--text-normal)' }}>
                  非焦点不透明度: {unselectedOpacity}
                  <input type="range" min="0.05" max="1" step="0.05" value={unselectedOpacity} onChange={(e) => setUnselectedOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
              </Accordion>

              <Accordion defaultOpen={true} title="力度">
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  图谱向心力: {centerStrength.toFixed(2)}
                  <input type="range" min="0" max="1" step="0.05" value={centerStrength} onChange={(e) => setCenterStrength(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  节点间的排斥力: {repelStrength}
                  <input type="range" min="0" max="1000" step="20" value={repelStrength} onChange={(e) => setRepelStrength(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', marginBottom: '10px', color: 'var(--text-normal)' }}>
                  相连节点间的吸引力: {linkAttractStrength.toFixed(2)}
                  <input type="range" min="0.05" max="1" step="0.05" value={linkAttractStrength} onChange={(e) => setLinkAttractStrength(parseFloat(e.target.value))} style={{ width: '100%' }} />
                </label>
                <label style={{ display: 'block', color: 'var(--text-normal)' }}>
                  连线长度: {linkDistance}
                  <input type="range" min="30" max="350" step="10" value={linkDistance} onChange={(e) => setLinkDistance(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
                </label>
              </Accordion>

              <Accordion defaultOpen={true} title="时间轴范围与跳转">
                <div style={{ marginBottom: '8px', padding: '8px', background: 'var(--background-secondary)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>起始时间 (年 / 月 / 日)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="1"
                      value={startYMD.year}
                      onChange={(e) => setStartYMD({ ...startYMD, year: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{ width: '64px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>年</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={startYMD.month}
                      onChange={(e) => setStartYMD({ ...startYMD, month: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '42px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>月</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={startYMD.day}
                      onChange={(e) => setStartYMD({ ...startYMD, day: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '42px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>日</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--text-normal)', marginLeft: '2px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={startYMD.isBC} onChange={(e) => setStartYMD({ ...startYMD, isBC: e.target.checked })} />
                      BC
                    </label>
                  </div>
                </div>

                <div style={{ marginBottom: '8px', padding: '8px', background: 'var(--background-secondary)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>结束时间 (年 / 月 / 日)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="1"
                      value={endYMD.year}
                      onChange={(e) => setEndYMD({ ...endYMD, year: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{ width: '64px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>年</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={endYMD.month}
                      onChange={(e) => setEndYMD({ ...endYMD, month: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '42px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>月</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={endYMD.day}
                      onChange={(e) => setEndYMD({ ...endYMD, day: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '42px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>日</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--text-normal)', marginLeft: '2px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={endYMD.isBC} onChange={(e) => setEndYMD({ ...endYMD, isBC: e.target.checked })} />
                      BC
                    </label>
                  </div>
                </div>

                <div style={{ marginBottom: '10px', padding: '8px', background: 'var(--background-secondary)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>精准跳转到指定日期</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      min="1"
                      value={jumpYMD.year}
                      onChange={(e) => setJumpYMD({ ...jumpYMD, year: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{ width: '58px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>年</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={jumpYMD.month}
                      onChange={(e) => setJumpYMD({ ...jumpYMD, month: Math.min(12, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '38px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>月</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={jumpYMD.day}
                      onChange={(e) => setJumpYMD({ ...jumpYMD, day: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                      style={{ width: '38px', padding: '3px 4px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-normal)', borderRadius: '4px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>日</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--text-normal)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={jumpYMD.isBC} onChange={(e) => setJumpYMD({ ...jumpYMD, isBC: e.target.checked })} />
                      BC
                    </label>
                    <button
                      onClick={handleJumpDate}
                      style={{ marginLeft: 'auto', padding: '3px 8px', background: 'var(--interactive-accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      跳转
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setCurrentYear(getTodayDecimalYear())}
                  style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '6px', background: 'var(--background-modifier-border)', color: 'var(--text-normal)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  <Calendar size={14} style={{ marginRight: '5px' }} /> 回到今天 ({new Date().toLocaleDateString('zh-CN')})
                </button>
              </Accordion>
            </div>
          </div>
        )}
      </div>

      {/* 底部全汉化 Aeon 风格可缩放双层刻度时间轴 */}
      <div
        ref={timelineWrapRef}
        onWheel={handleTimelineWheel}
        style={{
          height: '82px',
          width: '100%',
          background: 'var(--background-secondary)',
          borderTop: '1px solid var(--background-modifier-border)',
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
          position: 'relative',
          zIndex: 12,
        }}
      >
        <div
          onMouseDown={handleTimelineMouseDown}
          style={{
            position: 'relative',
            height: '52px',
            width: '100%',
            overflow: 'hidden',
            cursor: 'ew-resize',
            borderBottom: '1px solid var(--background-modifier-border)',
          }}
          title="左右拖拽平移时间，滚动鼠标滚轮放大/缩小时间刻度精度"
        >
          {timelineTicks.primaryTicks.map((t, idx) => (
            <div
              key={`pri-${idx}`}
              style={{
                position: 'absolute',
                left: `${t.pos}px`,
                top: '4px',
                height: '20px',
                paddingLeft: '6px',
                borderLeft: '1px solid var(--background-modifier-border)',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--text-normal)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {t.label}
            </div>
          ))}

          {timelineTicks.secondaryTicks.map((t, idx) => (
            <div
              key={`sec-${idx}`}
              style={{
                position: 'absolute',
                left: `${t.pos}px`,
                bottom: '0px',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px', whiteSpace: 'nowrap' }}>{t.label}</span>
              <div
                style={{
                  width: '1px',
                  height: t.isMajor ? '6px' : '4px',
                  background: t.isMajor ? 'var(--text-muted)' : 'var(--background-modifier-border)',
                }}
              />
            </div>
          ))}

          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '2px',
              background: 'var(--interactive-accent)',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '2px',
              transform: 'translateX(-50%)',
              padding: '1px 8px',
              background: 'var(--interactive-accent)',
              color: 'var(--text-on-accent)',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '10px',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            }}
          >
            {formatCurrentTimeBadge(currentYear, viewSpan)}
          </div>
        </div>

        <div
          style={{
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            gap: '12px',
            background: 'var(--background-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => setViewSpan((prev) => Math.min(3000, prev * 1.6))}
              style={{ padding: '2px 4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              title="缩小时间轴视图 (跨度变大)"
            >
              <ZoomOut size={14} />
            </button>
            <select
              value={
                viewSpan >= 80
                  ? '100'
                  : viewSpan >= 10
                  ? '12'
                  : viewSpan >= 1
                  ? '2'
                  : viewSpan >= 0.05
                  ? '0.16'
                  : '0.015'
              }
              onChange={(e) => setViewSpan(parseFloat(e.target.value))}
              style={{
                padding: '1px 6px',
                fontSize: '11px',
                background: 'var(--background-secondary)',
                color: 'var(--text-normal)',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '4px',
              }}
              title="切换时间轴视图精度"
            >
              <option value="100">年代视图 (100年)</option>
              <option value="12">年视图 (12年)</option>
              <option value="2">月/季视图 (2年)</option>
              <option value="0.16">日视图 (2个月)</option>
              <option value="0.015">小时视图 (5天)</option>
            </select>
            <button
              onClick={() => setViewSpan((prev) => Math.max(0.005, prev * 0.6))}
              style={{ padding: '2px 4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              title="放大时间轴视图 (精度变高)"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatRangeLabel(startYMD)}
            </span>
            <input
              type="range"
              min={minRangeDecimal}
              max={maxRangeDecimal}
              step={Math.max(0.0005, viewSpan / 200)}
              value={Math.max(minRangeDecimal, Math.min(maxRangeDecimal, currentYear))}
              onChange={(e) => setCurrentYear(parseFloat(e.target.value))}
              style={{ flex: 1, cursor: 'pointer', height: '4px' }}
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatRangeLabel(endYMD)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => setCurrentYear((y) => Math.max(minRangeDecimal, y - viewSpan * 0.1))}
              style={{ padding: '1px 6px', fontSize: '11px', background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: '3px', cursor: 'pointer', color: 'var(--text-normal)' }}
              title="向过去步进"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentYear((y) => Math.min(maxRangeDecimal, y + viewSpan * 0.1))}
              style={{ padding: '1px 6px', fontSize: '11px', background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: '3px', cursor: 'pointer', color: 'var(--text-normal)' }}
              title="向未来步进"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}