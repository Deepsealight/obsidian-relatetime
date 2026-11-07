import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Settings,
  Search,
  X,
  Plus,
  ChevronDown,
  ChevronRight,
  Calendar,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  GripVertical,
  Clock,
  HelpCircle,
  Trash2,
} from 'lucide-react';
import { Notice, requestUrl } from 'obsidian';
import * as d3 from 'd3';

// ---------------- 接口定义 ----------------
interface NodeData extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  realName: string;
  path: string;
  gender: '男' | '女' | '未知';
  aliases: string[];
  ctime: number;
  mtime: number;
  isIsolated?: boolean;
}

type ListSortMode =
  | 'explorer'
  | 'manual'
  | 'name-asc'
  | 'name-desc'
  | 'mtime-desc'
  | 'mtime-asc'
  | 'ctime-desc'
  | 'ctime-asc';

type CustomEraMappingScope = 'entire' | 'valid_only';
type GraphYearDisplayMode = 'standard' | 'custom';
type ListYearDisplayMode = 'standard' | 'custom_first' | 'custom_first_with_standard' | 'custom_all';

interface CustomEraItem {
  id: string;
  isStandard?: boolean;
  enabled: boolean;
  name: string;
  startYear: number | '';
  startMonth: number | '';
  startDay: number | '';
  startIsBC: boolean;
  hasEnd: boolean;
  endYear: number | '';
  endMonth: number | '';
  endDay: number | '';
  endIsBC: boolean;
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
  source: any;
  target: any;
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

interface ParsedDateInfo {
  year: number;
  month: number;
  day: number;
  isBC: boolean;
  timeSuffix: string;
  decimalYear: number;
}

// 模块级持久化节点坐标缓存
const GLOBAL_NODE_CACHE: Record<string, { x: number; y: number; vx: number; vy: number }> = {};

const DEFAULT_ERA_ITEMS: CustomEraItem[] = [
  {
    id: 'standard',
    isStandard: true,
    enabled: true,
    name: '标准时间',
    startYear: 1,
    startMonth: 1,
    startDay: 1,
    startIsBC: false,
    hasEnd: false,
    endYear: '',
    endMonth: '',
    endDay: '',
    endIsBC: false,
  },
];

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

// ---------------- 折叠面板与问号提示组件 ----------------
const Accordion = ({ title, defaultOpen = true, helpText, children }: { title: string; defaultOpen?: boolean; helpText?: string; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '12px', borderBottom: '1px solid var(--background-modifier-border)', paddingBottom: '12px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text-normal)', userSelect: 'none' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span style={{ marginLeft: '4px' }}>{title}</span>
        {helpText && (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '5px', color: 'var(--text-muted)', cursor: 'help' }}
            title={helpText}
          >
            <HelpCircle size={13} />
          </span>
        )}
      </div>
      {isOpen && <div style={{ marginTop: '10px', paddingLeft: '4px' }}>{children}</div>}
    </div>
  );
};

const HelpIcon = ({ text }: { text: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      marginLeft: '5px',
      color: 'var(--text-muted)',
      cursor: 'help',
      verticalAlign: 'middle',
    }}
    title={text}
    onClick={(e) => e.stopPropagation()}
  >
    <HelpCircle size={13} />
  </span>
);

// ---------------- 日期、自定义纪年与强制语义归一化工具函数 ----------------
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

const extractAliases = (fm: any, displayName: string): string[] => {
  const raw = fm?.['aliases'] ?? fm?.['alias'] ?? fm?.['别名'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,，、]/);
  return arr
    .map((a: any) => String(a || '').trim())
    .filter((a: string) => a.length > 0 && a !== displayName);
};

const extractOrderStringsFromObject = (obj: any, bucket: string[] = [], visited = new Set<any>()): string[] => {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) return bucket;
  visited.add(obj);

  if (Array.isArray(obj)) {
    obj.forEach((item) => {
      if (typeof item === 'string' && item.trim()) {
        bucket.push(item.trim());
      } else if (item && typeof item === 'object') {
        const candidate = item.path || item.name || item.basename || item.id || item.file || item.title;
        if (typeof candidate === 'string' && candidate.trim()) {
          bucket.push(candidate.trim());
        }
        extractOrderStringsFromObject(item, bucket, visited);
      }
    });
  } else {
    Object.entries(obj).forEach(([k, val]) => {
      if (typeof val === 'number' && (k.endsWith('.md') || k.includes('/'))) {
        bucket.push(k);
      } else if (val && typeof val === 'object') {
        extractOrderStringsFromObject(val, bucket, visited);
      }
    });
  }
  return bucket;
};

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

// 天文年份转换：公元前 1 年 (1 BC) 记为 0，公元前 2 年记为 -1，消除公元 0 年断层以保证跨 BC/AD 纪年差值准确
const toAstroYear = (year: number, isBC: boolean): number => {
  const y = Math.max(1, Math.abs(Math.floor(year || 1)));
  return isBC ? -(y - 1) : y;
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

// 解析单端日期文本（提取年月日、BC 与时分秒后缀）
const parseSingleDateDetail = (rawPart: string): ParsedDateInfo | null => {
  if (!rawPart) return null;
  const str = String(rawPart).trim();
  if (!str) return null;

  const isBC = /(BC|BCE|公元前)/i.test(str) || str.startsWith('-');
  const timeMatch = str.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  const timeSuffix = timeMatch ? timeMatch[1]! : '';

  const withoutTime = timeSuffix ? str.replace(timeSuffix, '').trim() : str;
  const cleanStr = withoutTime.replace(/(BC|BCE|AD|CE|公元前|公元)/gi, '').trim();
  const nums = cleanStr.match(/\d+/g) || [];
  if (nums.length === 0) return null;

  const year = Math.max(1, parseInt(nums[0] || '1', 10) || 1);
  const month = nums.length > 1 ? Math.min(12, Math.max(1, parseInt(nums[1] || '1', 10))) : 1;
  const maxDay = MONTH_DAYS[month - 1] || 31;
  const day = nums.length > 2 ? Math.min(maxDay, Math.max(1, parseInt(nums[2] || '1', 10))) : 1;

  return {
    year,
    month,
    day,
    isBC,
    timeSuffix,
    decimalYear: parseDateToDecimal(str),
  };
};

// 校验自定义纪年项是否具备完整合法的起始年月日及名称
const isCustomEraValid = (item: CustomEraItem): boolean => {
  if (item.isStandard) return true;
  if (!item.name || !item.name.trim()) return false;
  const sy = Number(item.startYear);
  const sm = Number(item.startMonth);
  const sd = Number(item.startDay);
  if (!Number.isFinite(sy) || sy < 1) return false;
  if (!Number.isFinite(sm) || sm < 1 || sm > 12) return false;
  const maxStartD = MONTH_DAYS[sm - 1] || 31;
  if (!Number.isFinite(sd) || sd < 1 || sd > maxStartD) return false;
  return true;
};

// 检查自定义纪年的结束时间是否完整有效
const hasValidEndYMD = (item: CustomEraItem): boolean => {
  if (!item.hasEnd) return false;
  const ey = Number(item.endYear);
  const em = Number(item.endMonth);
  const ed = Number(item.endDay);
  if (!Number.isFinite(ey) || ey < 1) return false;
  if (!Number.isFinite(em) || em < 1 || em > 12) return false;
  const maxEndD = MONTH_DAYS[em - 1] || 31;
  if (!Number.isFinite(ed) || ed < 1 || ed > maxEndD) return false;
  return true;
};

// 判断目标日期在指定纪年项下是否生效，并返回换算后的年份文本（如 "民国32年" 或 "2021年"）
const resolveEraYearLabelForDate = (
  item: CustomEraItem,
  targetDecimal: number,
  targetDisplayYear: number,
  targetIsBC: boolean,
  mappingScope: CustomEraMappingScope
): string | null => {
  if (!item.enabled) return null;
  if (item.isStandard) {
    return targetIsBC ? `${targetDisplayYear} BC` : `${targetDisplayYear}年`;
  }
  if (!isCustomEraValid(item)) return null;

  const startDec = ymdToDecimal({
    year: Number(item.startYear),
    month: Number(item.startMonth),
    day: Number(item.startDay),
    isBC: item.startIsBC,
  });

  // 无论映射模式是“整个时间轴”还是“仅有效范围”，在起始时间之前一律不显示
  if (targetDecimal < startDec - 1e-6) {
    return null;
  }

  // 若选择“自定义时间仅映射有效范围”，且配置了有效的结束时间，则超出结束时间后不显示
  if (mappingScope === 'valid_only' && hasValidEndYMD(item)) {
    const endDec = ymdToDecimal({
      year: Number(item.endYear),
      month: Number(item.endMonth),
      day: Number(item.endDay),
      isBC: item.endIsBC,
    });
    // 结束时间当天全天均视为有效（加上 1 天的十进制余量）
    if (targetDecimal > endDec + 1 / 365 + 1e-6) {
      return null;
    }
  }

  const startAstro = toAstroYear(Number(item.startYear), item.startIsBC);
  const targetAstro = toAstroYear(targetDisplayYear, targetIsBC);
  const eraYearNum = targetAstro - startAstro + 1;
  if (eraYearNum <= 0) return null;

  return `${item.name.trim()}${eraYearNum}年`;
};

const isTimeStrActive = (timeStr: string, currentYear: number): boolean => {
  if (!timeStr) return true;
  const trimmed = timeStr.trim();
  if (!trimmed || trimmed.includes('固定')) return true;
  const rangeParts = trimmed.split(/[～~]/);
  if (rangeParts.length >= 2) {
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

// 根据给定年份称号（如 "57 BC"、"2026年" 或 "民国82年"）和视图跨度生成时间轴胶囊文本
const formatBadgeWithYearPrefix = (yearPrefix: string, info: ReturnType<typeof decomposeDecimalYear>, span: number): string => {
  if (span > 20) return `${yearPrefix} ${info.monthIndex + 1}月`;
  if (span > 0.5) return `${yearPrefix} ${info.monthIndex + 1}月 ${info.day}日`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${yearPrefix} ${info.monthIndex + 1}月 ${info.day}日 ${pad(info.hour)}:${pad(info.minute)}`;
};

// 格式化列表视图与悬浮层中的单端日期
const formatListSingleDate = (
  rawDatePart: string,
  listYearMode: ListYearDisplayMode,
  eraItems: CustomEraItem[],
  mappingScope: CustomEraMappingScope
): string => {
  const info = parseSingleDateDetail(rawDatePart);
  if (!info) return rawDatePart.trim();

  const stdYearStr = info.isBC ? `${info.year} BC` : `${info.year}年`;
  const mdTimeStr = `${info.month}月${info.day}日${info.timeSuffix ? ` ${info.timeSuffix}` : ''}`;

  // 1. 标准年份：2021年8月26日 17:00:00
  if (listYearMode === 'standard') {
    return `${stdYearStr}${mdTimeStr}`;
  }

  // 2. 自定义年份（1个）：按排序仅展示第 1 个生效的自定义年份；若无生效项则回退标准年份
  if (listYearMode === 'custom_first') {
    for (const item of eraItems) {
      if (item.isStandard) continue;
      const lbl = resolveEraYearLabelForDate(item, info.decimalYear, info.year, info.isBC, mappingScope);
      if (lbl) {
        return `${lbl}${mdTimeStr}`;
      }
    }
    return `${stdYearStr}${mdTimeStr}`;
  }

  // 3. 自定义年份（1个）+ 标准年份：如 "民国32年8月26日 17:00:00 (2021年)"；若不在自定义年份生效范围内则显示 "2026年4月12日"
  if (listYearMode === 'custom_first_with_standard') {
    for (const item of eraItems) {
      if (item.isStandard) continue;
      const lbl = resolveEraYearLabelForDate(item, info.decimalYear, info.year, info.isBC, mappingScope);
      if (lbl) {
        return `${lbl}${mdTimeStr} (${stdYearStr})`;
      }
    }
    return `${stdYearStr}${mdTimeStr}`;
  }

  // 4. 自定义年份（全部）：完全按照包含“标准时间”在内的拖拽排序顺序，第 1 个作为主干，其余放进括号并用中文逗号隔开
  const activeYearLabels: string[] = [];
  for (const item of eraItems) {
    const lbl = resolveEraYearLabelForDate(item, info.decimalYear, info.year, info.isBC, mappingScope);
    if (lbl) {
      activeYearLabels.push(lbl);
    }
  }

  if (activeYearLabels.length === 0) {
    return `${stdYearStr}${mdTimeStr}`;
  }
  const primaryYear = activeYearLabels[0]!;
  const extraYears = activeYearLabels.slice(1);
  if (extraYears.length === 0) {
    return `${primaryYear}${mdTimeStr}`;
  }
  return `${primaryYear}${mdTimeStr} (${extraYears.join('，')})`;
};

// 格式化列表视图与悬浮层中的完整时间范围字符串
const formatListTimeRangeStr = (
  timeStr: string,
  listYearMode: ListYearDisplayMode,
  eraItems: CustomEraItem[],
  mappingScope: CustomEraMappingScope
): string => {
  if (!timeStr) return '';
  const trimmed = timeStr.trim();
  if (!trimmed || trimmed === '固定') return trimmed;

  const parts = trimmed.split(/\s*[～~]\s*/);
  if (parts.length >= 2) {
    const leftFormatted = formatListSingleDate(parts[0] || '', listYearMode, eraItems, mappingScope);
    const rightFormatted = formatListSingleDate(parts.slice(1).join(' ~ '), listYearMode, eraItems, mappingScope);
    return `${leftFormatted} ~ ${rightFormatted}`;
  }
  return formatListSingleDate(trimmed, listYearMode, eraItems, mappingScope);
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
  const savedUi = useMemo(() => plugin?.settings?.uiState || {}, [plugin]);

  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<SVGGElement>(null);
  const timelineWrapRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<NodeData, LinkData> | null>(null);
  const simNodesRef = useRef<NodeData[]>([]);
  const simLinksRef = useRef<LinkData[]>([]);

  const [rawFiles, setRawFiles] = useState<any[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(() => savedUi.isPanelOpen ?? false);

  // 视图模式切换：'graph' (图谱) | 'list' (列表)
  const [viewMode, setViewMode] = useState<'graph' | 'list'>(() => savedUi.viewMode ?? 'graph');

  // 列表视图专属状态与排序状态（独立记忆 customManualOrder）
  const [listSearchQuery, setListSearchQuery] = useState<string>(() => savedUi.listSearchQuery ?? '');
  const [listSearchScope, setListSearchScope] = useState<'all' | 'character' | 'relation'>(() => savedUi.listSearchScope ?? 'all');
  const [listShowTime, setListShowTime] = useState<boolean>(() => savedUi.listShowTime ?? false);
  const [listSortMode, setListSortMode] = useState<ListSortMode>(() => savedUi.listSortMode ?? 'explorer');
  const [customManualOrder, setCustomManualOrder] = useState<string[]>(() =>
    Array.isArray(savedUi.customManualOrder) ? savedUi.customManualOrder : []
  );
  const [explorerOrderTokens, setExplorerOrderTokens] = useState<string[]>([]);
  const [nativeSortRule, setNativeSortRule] = useState<string>('alphabetical');
  const [isSortingList, setIsSortingList] = useState<boolean>(false);
  const [hoveredRowIdForDrag, setHoveredRowIdForDrag] = useState<string | null>(null);
  const dragHoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 列表拖拽状态
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  // 自定义时间映射状态
  const [customEraItems, setCustomEraItems] = useState<CustomEraItem[]>(() => {
    const savedList = savedUi.customEraItems;
    if (Array.isArray(savedList) && savedList.length > 0) {
      const hasStandard = savedList.some((it: CustomEraItem) => it.isStandard || it.id === 'standard');
      const normalized = savedList.map((it: CustomEraItem) =>
        it.isStandard || it.id === 'standard'
          ? { ...it, id: 'standard', isStandard: true, enabled: true, name: '标准时间' }
          : it
      );
      return hasStandard ? normalized : [DEFAULT_ERA_ITEMS[0]!, ...normalized];
    }
    return DEFAULT_ERA_ITEMS;
  });
  const [customEraMappingScope, setCustomEraMappingScope] = useState<CustomEraMappingScope>(
    () => savedUi.customEraMappingScope ?? 'entire'
  );
  const [graphYearDisplayMode, setGraphYearDisplayMode] = useState<GraphYearDisplayMode>(
    () => savedUi.graphYearDisplayMode ?? 'custom'
  );
  const [listYearDisplayMode, setListYearDisplayMode] = useState<ListYearDisplayMode>(
    () => savedUi.listYearDisplayMode ?? 'custom_first'
  );

  // 自定义时间映射项拖拽排序状态与删除按钮悬停状态
  const [draggedEraId, setDraggedEraId] = useState<string | null>(null);
  const [dragOverEraId, setDragOverEraId] = useState<string | null>(null);
  const [hoveredDeleteEraId, setHoveredDeleteEraId] = useState<string | null>(null);

  // 列表列宽控制：第一列支持鼠标拖拽缩放，其余列在未开启时间显示时由滑块控制，开启时间显示时固定为 168px
  const [firstColWidth, setFirstColWidth] = useState<number>(() => savedUi.firstColWidth ?? 196);
  const [listColWidth, setListColWidth] = useState<number>(() => savedUi.listColWidth ?? 120);
  const effectiveColWidth = listShowTime ? 168 : listColWidth;

  const [isResizingFirstCol, setIsResizingFirstCol] = useState<boolean>(false);
  const isResizingFirstColRef = useRef<boolean>(false);
  const firstColResizeStartXRef = useRef<number>(0);
  const firstColResizeStartWidthRef = useRef<number>(196);

  const handleFirstColResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingFirstColRef.current = true;
    setIsResizingFirstCol(true);
    firstColResizeStartXRef.current = e.clientX;
    firstColResizeStartWidthRef.current = firstColWidth;
  }, [firstColWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingFirstColRef.current) return;
      const dx = e.clientX - firstColResizeStartXRef.current;
      const nextW = Math.max(110, Math.min(480, firstColResizeStartWidthRef.current + dx));
      setFirstColWidth(nextW);
    };
    const handleMouseUp = () => {
      if (isResizingFirstColRef.current) {
        isResizingFirstColRef.current = false;
        setIsResizingFirstCol(false);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const [selectedListRowId, setSelectedListRowId] = useState<string | null>(null);
  const [selectedListCell, setSelectedListCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [timeTooltip, setTimeTooltip] = useState<{ visible: boolean; x: number; y: number; text: string }>({
    visible: false,
    x: 0,
    y: 0,
    text: '',
  });

  const [llmSemanticMap, setLlmSemanticMap] = useState<Record<string, SemanticCacheEntry>>(() => {
    return plugin?.settings?.llmCache?.semanticMap || {};
  });
  const [llmGlobalInferred, setLlmGlobalInferred] = useState<GlobalInferredRecord[]>(() => {
    return Array.isArray(plugin?.settings?.llmCache?.globalInferred) ? plugin.settings.llmCache?.globalInferred : [];
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

  // 1. 筛选设置
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

  // 6. 时间轴与范围设置
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

  // 计算相对于 workspaceRootRef 的精准鼠标坐标
  const getRelativeMousePos = useCallback((clientX: number, clientY: number) => {
    const rect = workspaceRootRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX + 12, y: clientY + 12 };
    return {
      x: Math.min(rect.width - 240, Math.max(8, clientX - rect.left + 12)),
      y: Math.min(rect.height - 60, Math.max(8, clientY - rect.top + 14)),
    };
  }, []);

  // 自动持久化保存所有图谱与列表 UI 设置（对于自定义时间映射，仅保存填写了合法起始时间的项）
  useEffect(() => {
    if (!plugin || !plugin.settings) return;
    const validCustomErasToSave = customEraItems.filter((item) => item.isStandard || isCustomEraValid(item));
    const nextUiState = {
      viewMode,
      listSearchQuery,
      listSearchScope,
      listShowTime,
      listSortMode,
      customManualOrder,
      firstColWidth,
      listColWidth,
      customEraItems: validCustomErasToSave,
      customEraMappingScope,
      graphYearDisplayMode,
      listYearDisplayMode,
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
    viewMode,
    listSearchQuery,
    listSearchScope,
    listShowTime,
    listSortMode,
    customManualOrder,
    firstColWidth,
    listColWidth,
    customEraItems,
    customEraMappingScope,
    graphYearDisplayMode,
    listYearDisplayMode,
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

  // 自定义时间映射项拖拽排序处理
  const handleEraDrop = useCallback(
    (targetId: string) => {
      if (!draggedEraId || draggedEraId === targetId) {
        setDraggedEraId(null);
        setDragOverEraId(null);
        return;
      }
      setCustomEraItems((prev) => {
        const fromIdx = prev.findIndex((it) => it.id === draggedEraId);
        const toIdx = prev.findIndex((it) => it.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        if (moved) {
          next.splice(toIdx, 0, moved);
        }
        return next;
      });
      setDraggedEraId(null);
      setDragOverEraId(null);
    },
    [draggedEraId]
  );

  // 计算图谱底部时间轴中央胶囊展示内容（第 1 行主胶囊 + 第 2 行副胶囊）
  const timelineCenterBadges = useMemo(() => {
    const info = decomposeDecimalYear(currentYear);
    const stdYearPrefix = info.isBC ? `${info.displayYear} BC` : `${info.displayYear}年`;

    if (graphYearDisplayMode === 'standard') {
      return {
        primaryText: formatBadgeWithYearPrefix(stdYearPrefix, info, viewSpan),
        secondaryText: '',
      };
    }

    const activeYearLabels: string[] = [];
    for (const item of customEraItems) {
      const lbl = resolveEraYearLabelForDate(item, currentYear, info.displayYear, info.isBC, customEraMappingScope);
      if (lbl) {
        activeYearLabels.push(lbl);
      }
    }

    if (activeYearLabels.length === 0) {
      return {
        primaryText: formatBadgeWithYearPrefix(stdYearPrefix, info, viewSpan),
        secondaryText: '',
      };
    }

    const firstYearPrefix = activeYearLabels[0]!;
    const restYears = activeYearLabels.slice(1);
    return {
      primaryText: formatBadgeWithYearPrefix(firstYearPrefix, info, viewSpan),
      secondaryText: restYears.join('，'),
    };
  }, [currentYear, viewSpan, graphYearDisplayMode, customEraItems, customEraMappingScope]);

  // 三级穿透读取“与文件管理器一致（含 Flexplorer 自定义排序）”
  const syncExplorerOrder = useCallback(async () => {
    if (!plugin?.app) return;
    const app = plugin.app;
    const tokens: string[] = [];

    try {
      const customPlugins = ['flexplorer', 'custom-frames', 'sort-and-permute-files', 'custom-sort'];
      const loadedPlugins = (app as any).plugins?.plugins || {};
      for (const pid of customPlugins) {
        const inst = loadedPlugins[pid];
        if (inst) {
          extractOrderStringsFromObject(inst.settings || inst.data || inst, tokens);
        }
      }

      const configDir = app.vault.configDir || '.obsidian';
      const flexDataPath = `${configDir}/plugins/flexplorer/data.json`;
      if (await app.vault.adapter.exists(flexDataPath)) {
        const rawJson = await app.vault.adapter.read(flexDataPath);
        const parsed = JSON.parse(rawJson);
        extractOrderStringsFromObject(parsed, tokens);
      }

      const explorerLeaves = app.workspace.getLeavesOfType('file-explorer');
      if (explorerLeaves.length > 0) {
        const view: any = explorerLeaves[0]?.view;
        if (view?.containerEl) {
          const domNodes = view.containerEl.querySelectorAll('.nav-file-title[data-path]');
          domNodes.forEach((el: Element) => {
            const p = el.getAttribute('data-path');
            if (p) tokens.push(p);
          });
        }
        if (view?.fileItems) {
          Object.keys(view.fileItems).forEach((p) => tokens.push(p));
        }
      }

      const nativeSort = (app.vault as any).getConfig?.('fileSortOrder') || 'alphabetical';
      setNativeSortRule(String(nativeSort));
    } catch (e) {
      console.warn('读取文件管理器排序配置异常:', e);
    }

    setExplorerOrderTokens(Array.from(new Set(tokens)));
  }, [plugin]);

  useEffect(() => {
    syncExplorerOrder();
    if (!plugin || !plugin.app) return;
    const handleChange = () => syncExplorerOrder();
    const eventRef = plugin.app.vault.on('modify', handleChange);
    const layoutRef = plugin.app.workspace.on('layout-change', handleChange);

    return () => {
      plugin.app.vault.offref(eventRef);
      plugin.app.workspace.offref(layoutRef);
    };
  }, [syncExplorerOrder, rawFiles, listSortMode, viewMode, plugin]);

  const triggerSortWithLoading = useCallback((nextMode: ListSortMode) => {
    setIsSortingList(true);
    setListSortMode(nextMode);
    setTimeout(() => {
      setIsSortingList(false);
    }, 180);
  }, []);

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
              stat: file.stat || { ctime: 0, mtime: 0 },
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

  // 仅当插件设置中开启了 autoLlmInfer 时，才在文件变更后自动请求
  useEffect(() => {
    if (!plugin?.settings?.autoLlmInfer) return;
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

    // 一对一直接反向推算
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
          timeStr: rec.timeStr,
          pairGroupId: rec.pairGroupId,
          conflictReason: rec.conflictReason,
        });
      }
    });

    return finalEdges;
  }, [rawFiles, llmSemanticMap]);

  // ---------------- 第二阶段：全网络传递推算 + 图谱与列表数据分发 ----------------
  const { nodes, links, allCharacterNodes, fullTimeMatrixMap } = useMemo(() => {
    const idToDisplay: Record<string, string> = {};
    const idToGender: Record<string, '男' | '女' | '未知'> = {};
    const idToAliases: Record<string, string[]> = {};

    rawFiles.forEach((f) => {
      const fm = f.frontmatter || {};
      const rawTitle = fm['character-name'] || fm['title'] || fm['name'] || cleanName(f.basename);
      const disp = String(rawTitle).trim() || cleanName(f.basename);
      idToDisplay[f.basename] = disp;
      idToGender[f.basename] = normalizeGender(fm['性别'] ?? fm['gender']);
      idToAliases[f.basename] = extractAliases(fm, disp);
    });

    const baseCharacters: NodeData[] = rawFiles.map((f) => ({
      id: f.basename,
      label: idToDisplay[f.basename] || f.basename,
      realName: f.basename,
      path: f.path || f.basename,
      gender: idToGender[f.basename] || '未知',
      aliases: idToAliases[f.basename] || [],
      ctime: f.stat?.ctime || 0,
      mtime: f.stat?.mtime || 0,
      isIsolated: true,
    }));

    const nodeIdSet = new Set(baseCharacters.map((n) => n.id));

    const computeResolvedEdgeMap = (filterByCurrentYear: boolean): Record<string, RawRelationEdge> => {
      const filtered = baseResolvedEdges.filter((rec) => {
        if (!enableInferred && rec.isInferred) return false;
        if (!nodeIdSet.has(rec.sourceId) || !nodeIdSet.has(rec.targetId)) return false;
        return filterByCurrentYear ? isTimeStrActive(rec.timeStr, currentYear) : true;
      });

      const dirGroupMap: Record<string, RawRelationEdge> = {};

      const addOrMergeEdge = (edge: RawRelationEdge) => {
        const normCat = canonicalizeCategory(edge.label);
        const normPairGroupId = `${[edge.sourceId, edge.targetId].sort().join('__')}__${normCat}`;
        const normalizedEdge: RawRelationEdge = { ...edge, pairGroupId: normPairGroupId };

        const k = filterByCurrentYear
          ? `${normalizedEdge.sourceId}->${normalizedEdge.targetId}__${normPairGroupId}`
          : `${normalizedEdge.sourceId}->${normalizedEdge.targetId}__${normPairGroupId}__${normalizedEdge.timeStr}`;

        if (!dirGroupMap[k]) {
          dirGroupMap[k] = normalizedEdge;
        } else {
          const existing = dirGroupMap[k];
          if (!normalizedEdge.isInferred && existing.isInferred) {
            dirGroupMap[k] = {
              ...normalizedEdge,
              conflictReason: normalizedEdge.conflictReason || existing.conflictReason,
            };
          } else if (!normalizedEdge.isInferred && !existing.isInferred) {
            const parts = existing.label.split(' / ');
            if (!parts.includes(normalizedEdge.label)) {
              existing.label = [...parts, normalizedEdge.label].join(' / ');
            }
            if (normalizedEdge.conflictReason && !existing.conflictReason) {
              existing.conflictReason = normalizedEdge.conflictReason;
            }
          }
        }
      };

      filtered.forEach(addOrMergeEdge);

      if (enableInferred) {
        const parentRoleWords = ['父亲', '爸爸', '爹', '母亲', '妈妈', '娘', '父母'];
        const masterRoleWords = ['师父', '师傅', '老师', '师尊'];
        const spouseRoleWords = ['妻子', '老婆', '夫人', '丈夫', '老公', '夫妻', '配偶'];

        const hasPairGroupEdge = (u: string, v: string, pg: string) => {
          if (filterByCurrentYear) return Boolean(dirGroupMap[`${u}->${v}__${pg}`]);
          const prefix = `${u}->${v}__${pg}__`;
          return Object.keys(dirGroupMap).some((key) => key.startsWith(prefix));
        };

        let changed = true;
        let passCount = 0;
        const maxPasses = Math.max(4, baseCharacters.length);

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
            siblingAdj[e.sourceId]!.add(e.targetId);
            siblingAdj[e.targetId]!.add(e.sourceId);
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
                if (!hasPairGroupEdge(u, v, sibGroup)) {
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

          parentEdges.forEach((pEdge) => {
            const parentId = pEdge.sourceId;
            const childA = pEdge.targetId;
            const parentLabel = pEdge.label;
            const allSiblingsOfA = getAllConnectedSiblings(childA);

            allSiblingsOfA.forEach((childB) => {
              if (childB === parentId) return;
              const pbPairGroup = `${[parentId, childB].sort().join('__')}__parent_child`;
              if (!hasPairGroupEdge(parentId, childB, pbPairGroup)) {
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
              if (!hasPairGroupEdge(childB, parentId, pbPairGroup)) {
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

          parentEdges.forEach((pEdge) => {
            const p1 = pEdge.sourceId;
            const childId = pEdge.targetId;
            spouseEdges.forEach((sEdge) => {
              if (sEdge.conflictReason) return;
              const p2 = sEdge.sourceId === p1 ? sEdge.targetId : sEdge.targetId === p1 ? sEdge.sourceId : null;
              if (!p2 || p2 === childId) return;

              const p2ChildGroup = `${[p2, childId].sort().join('__')}__parent_child`;
              if (!hasPairGroupEdge(p2, childId, p2ChildGroup)) {
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
              if (!hasPairGroupEdge(childId, p2, p2ChildGroup)) {
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

          for (let i = 0; i < parentEdges.length; i++) {
            for (let j = i + 1; j < parentEdges.length; j++) {
              const p1 = parentEdges[i]!;
              const p2 = parentEdges[j]!;
              if (p1.sourceId === p2.sourceId) {
                const c1 = p1.targetId;
                const c2 = p2.targetId;
                if (c1 === c2) continue;
                const sibGroup = `${[c1, c2].sort().join('__')}__sibling`;
                if (!hasPairGroupEdge(c1, c2, sibGroup) && !hasPairGroupEdge(c2, c1, sibGroup)) {
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

          for (let i = 0; i < masterEdges.length; i++) {
            for (let j = i + 1; j < masterEdges.length; j++) {
              const m1 = masterEdges[i]!;
              const m2 = masterEdges[j]!;
              if (m1.sourceId === m2.sourceId) {
                const d1 = m1.targetId;
                const d2 = m2.targetId;
                if (d1 === d2) continue;
                const peerGroup = `${[d1, d2].sort().join('__')}__sect_peer`;
                if (!hasPairGroupEdge(d1, d2, peerGroup)) {
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
                if (!hasPairGroupEdge(d2, d1, peerGroup)) {
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
              if (hasPairGroupEdge(uncleId, childId, existingPC)) return;

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
              const existingPC = `${[inLawParent, personB].sort().join('__')}__parent_child`;
              if (hasPairGroupEdge(inLawParent, personB, existingPC)) return;

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
              const existingSib = `${[sibOfSpouse, personB].sort().join('__')}__sibling`;
              if (hasPairGroupEdge(sibOfSpouse, personB, existingSib)) return;

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

        llmGlobalInferred.forEach((gRec) => {
          if (!nodeIdSet.has(gRec.sourceId) || !nodeIdSet.has(gRec.targetId)) return;
          if (inferDisplayMode === 'partial' && gRec.scope === 'all') return;
          if (filterByCurrentYear && !isTimeStrActive(gRec.timeStr, currentYear)) return;

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

      return dirGroupMap;
    };

    const dirGroupMap = computeResolvedEdgeMap(true);

    const fullTimeEdgeMap = computeResolvedEdgeMap(false);
    const matrixMap: Record<string, RawRelationEdge[]> = {};
    Object.values(fullTimeEdgeMap).forEach((edge) => {
      const cellKey = `${edge.targetId}__${edge.sourceId}`;
      if (!matrixMap[cellKey]) matrixMap[cellKey] = [];
      const exists = matrixMap[cellKey]!.some((e) => e.label === edge.label && e.timeStr === edge.timeStr);
      if (!exists) {
        matrixMap[cellKey]!.push(edge);
      }
    });

    let activeNodes: NodeData[] = baseCharacters.map((n) => ({ ...n }));

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

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchedNodeIds = new Set(activeNodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
      const matchedPairGroupIds = new Set(
        activeLinks.filter((l) => l.label.toLowerCase().includes(q)).map((l) => l.pairGroupId)
      );

      activeLinks = activeLinks.filter((l) => {
        if (matchedPairGroupIds.has(l.pairGroupId)) return true;
        if (matchedNodeIds.has(l.sourceId) || matchedNodeIds.has(l.targetId)) return true;
        return false;
      });

      const visibleNodeIds = new Set<string>(matchedNodeIds);
      activeLinks.forEach((l) => {
        visibleNodeIds.add(l.sourceId);
        visibleNodeIds.add(l.targetId);
      });

      activeNodes = activeNodes.filter((n) => visibleNodeIds.has(n.id));
    }

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

    const nodePairBuckets: Record<string, LinkData[]> = {};
    activeLinks.forEach((l) => {
      const pairKey = [l.sourceId, l.targetId].sort().join('<->');
      if (!nodePairBuckets[pairKey]) nodePairBuckets[pairKey] = [];
      nodePairBuckets[pairKey].push(l);
    });

    const INTRA_GAP = 10;
    const INTER_GAP = 16;

    Object.values(nodePairBuckets).forEach((bucket) => {
      if (bucket.length === 0) return;
      const firstBucket = bucket[0]!;
      const totalEdges = bucket.length;
      const [minId] = [firstBucket.sourceId, firstBucket.targetId].sort();

      const groupMap: Record<string, LinkData[]> = {};
      bucket.forEach((l) => {
        if (!groupMap[l.pairGroupId]) groupMap[l.pairGroupId] = [];
        groupMap[l.pairGroupId]!.push(l);
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
        const l = firstGroup[0]!;
        l.totalBetweenNodes = 1;
        l.isExactlyTwoOpposite = false;
        l.canonOffsetPx = 0;
        l.canonLabelOffsetPx = 11;
        l.canonAlongOffsetPx = 0;
        return;
      }

      if (groupCount === 1 && firstGroup.length === 2) {
        const line1 = firstGroup[0]!;
        const line2 = firstGroup[1]!;
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

      const rawOffsets: number[] = [];
      let cursor = 0;
      semanticGroups.forEach((grp, gIdx) => {
        if (gIdx > 0) cursor += INTER_GAP;
        grp.forEach((_l, innerIdx) => {
          if (innerIdx > 0) cursor += INTRA_GAP;
          rawOffsets.push(cursor);
        });
      });

      const midSpan = cursor / 2;
      const centeredOffsets = rawOffsets.map((pos) => pos - midSpan);

      let flatIdx = 0;
      semanticGroups.forEach((grp) => {
        grp.forEach((l, innerIdx) => {
          const lineOffset = centeredOffsets[flatIdx] || 0;
          l.totalBetweenNodes = totalEdges;
          l.isExactlyTwoOpposite = false;
          l.canonOffsetPx = lineOffset;

          let labelShift = 10;
          if (grp.length >= 2) {
            labelShift = innerIdx === 0 ? -10 : 10;
          } else {
            labelShift = lineOffset >= 0 ? 10 : -10;
          }
          l.canonLabelOffsetPx = lineOffset + labelShift;

          l.canonAlongOffsetPx = (flatIdx - (totalEdges - 1) / 2) * 22;
          flatIdx++;
        });
      });
    });

    return {
      nodes: activeNodes,
      links: activeLinks,
      allCharacterNodes: baseCharacters,
      fullTimeMatrixMap: matrixMap,
    };
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

  // ---------------- 独立几何坐标更新函数 ----------------
  const updateGraphPositions = useCallback(() => {
    if (!containerRef.current) return;
    const container = d3.select(containerRef.current);
    const { nodeSize: r, showArrow: arrowOn, linkThickness: thickness } = styleParamsRef.current;

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

    const geomEntries = Object.values(geomMap);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < geomEntries.length; i++) {
        for (let j = i + 1; j < geomEntries.length; j++) {
          const g1 = geomEntries[i]!;
          const g2 = geomEntries[j]!;
          const w1 = Math.max(26, g1.label.length * 12);
          const w2 = Math.max(26, g2.label.length * 12);
          const minDx = (w1 + w2) / 2 + 4;
          const minDy = 15;

          const distX = Math.abs(g1.mx - g2.mx);
          const distY = Math.abs(g1.my - g2.my);

          if (distX < minDx && distY < minDy) {
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

  // 独立视觉样式渲染函数
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

  // 初始化 D3 Simulation
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const container = d3.select(containerRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    svg.selectAll('defs').remove();
    const defs = svg.append('defs');

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

    const effectiveDistance = Math.max(25, linkDistance * (1.35 - linkAttractStrength * 0.85));
    const effectiveLinkStrength = 0.08 + Math.pow(linkAttractStrength, 1.3) * 0.85;
    const effectiveRepel = -(Math.max(15, repelStrength * 1.8));

    const sim = d3
      .forceSimulation<NodeData, LinkData>()
      .velocityDecay(0.32)
      .force(
        'link',
        d3
          .forceLink<NodeData, LinkData>()
          .id((d) => d.id)
          .distance(effectiveDistance)
          .strength(effectiveLinkStrength)
      )
      .force('charge', d3.forceManyBody<NodeData>().strength(effectiveRepel).distanceMax(1200))
      .force('x', d3.forceX<NodeData>(width / 2).strength(Math.pow(centerStrength, 1.2) * 0.45))
      .force('y', d3.forceY<NodeData>(height / 2).strength(Math.pow(centerStrength, 1.2) * 0.45))
      .force('collide', d3.forceCollide<NodeData>().radius(nodeSize + 14).iterations(2))
      .alphaDecay(0.022)
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
        prev.path = n.path;
        prev.gender = n.gender;
        prev.aliases = n.aliases;
        prev.ctime = n.ctime;
        prev.mtime = n.mtime;
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
        source: nodeLookup[l.sourceId] as string | NodeData,
        target: nodeLookup[l.targetId] as string | NodeData,
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
        const pos = getRelativeMousePos(event.clientX, event.clientY);
        setConflictTooltip({
          visible: true,
          x: pos.x,
          y: pos.y,
          title: `⚠️ 关系冲突：${srcLabel} → ${tgtLabel} (${d.label})`,
          reason: d.conflictReason,
        });
      })
      .on('mousemove', (event: MouseEvent, d) => {
        if (!d.conflictReason) return;
        const pos = getRelativeMousePos(event.clientX, event.clientY);
        setConflictTooltip((prev) => (prev.visible ? { ...prev, x: pos.x, y: pos.y } : prev));
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
  }, [nodes, links, plugin, updateGraphPositions, applyVisualStyles, getRelativeMousePos]);

  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim || !svgRef.current) return;
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const effectiveDistance = Math.max(25, linkDistance * (1.35 - linkAttractStrength * 0.85));
    const effectiveLinkStrength = 0.08 + Math.pow(linkAttractStrength, 1.3) * 0.85;

    const linkForce = sim.force('link') as d3.ForceLink<NodeData, LinkData>;
    if (linkForce) {
      linkForce.distance(effectiveDistance).strength(effectiveLinkStrength);
      linkForce.links(simLinksRef.current);
    }

    const effectiveRepel = -(Math.max(15, repelStrength * 1.8));
    const chargeForce = sim.force('charge') as d3.ForceManyBody<NodeData>;
    if (chargeForce) {
      chargeForce.strength(effectiveRepel).distanceMax(1200);
    }

    const effectiveCenter = Math.pow(centerStrength, 1.2) * 0.45;
    const forceX = sim.force('x') as d3.ForceX<NodeData>;
    if (forceX) {
      forceX.x(width / 2).strength(effectiveCenter);
    }

    const forceY = sim.force('y') as d3.ForceY<NodeData>;
    if (forceY) {
      forceY.y(height / 2).strength(effectiveCenter);
    }

    const collideForce = sim.force('collide') as d3.ForceCollide<NodeData>;
    if (collideForce) {
      collideForce.radius(nodeSize + 14);
    }

    updateGraphPositions();
    applyVisualStyles();
    sim.alpha(0.75).restart();
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

  // 全汉化双层时间轴刻度计算（超出设定起止时间范围的刻度自动隐藏）
  const timelineTicks = useMemo(() => {
    const halfSpan = viewSpan / 2;
    const startVal = currentYear - halfSpan;
    const endVal = currentYear + halfSpan;

    const primaryTicks: { pos: number; label: string }[] = [];
    const secondaryTicks: { pos: number; label: string; isMajor?: boolean }[] = [];

    const toPx = (val: number) => ((val - startVal) / viewSpan) * timelineWidth;
    const isInRange = (val: number) => val >= minRangeDecimal - 1e-6 && val <= maxRangeDecimal + 1e-6;

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
        if (!isInRange(y)) continue;
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
        const yEndVal = y + 1 - 1e-6;
        if (y <= maxRangeDecimal + 1e-6 && yEndVal >= minRangeDecimal - 1e-6) {
          const clampY = Math.max(y, minRangeDecimal);
          const yPx = toPx(clampY);
          if (yPx >= -60 && yPx <= timelineWidth + 60) {
            primaryTicks.push({ pos: yPx, label: formatYearZh(y, true) });
          }
        }
        for (let m = 0; m < 12; m += monthStep) {
          const mVal = y + m / 12;
          if (!isInRange(mVal)) continue;
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
          const daysInM = MONTH_DAYS[m] || 30;
          const mStartVal = y + accDays / 365;
          const mEndVal = y + (accDays + daysInM - 0.01) / 365;
          if (mStartVal <= maxRangeDecimal + 1e-6 && mEndVal >= minRangeDecimal - 1e-6) {
            const clampM = Math.max(mStartVal, minRangeDecimal);
            const mPx = toPx(clampM);
            if (mPx >= -80 && mPx <= timelineWidth + 80) {
              primaryTicks.push({ pos: mPx, label: `${formatYearZh(y, true)} ${MONTH_NAMES_ZH[m]}` });
            }
          }
          for (let d = 1; d <= daysInM; d += dayStep) {
            if (dayStep === 7 && d > 25) continue;
            const dVal = y + (accDays + d - 1) / 365;
            if (!isInRange(dVal)) continue;
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
        if (isInRange(dVal)) {
          const dPx = toPx(dVal);
          if (dPx >= -140 && dPx <= timelineWidth + 140) {
            const info = decomposeDecimalYear(dVal + 0.00001);
            const yStr = info.isBC ? `${info.displayYear} BC` : `${info.displayYear}年`;
            primaryTicks.push({
              pos: dPx,
              label: `${yStr} ${info.monthNameZh} ${info.day}日 ${info.weekNameZh}`,
            });
          }
        }
        for (let hr = 0; hr < 24; hr += hourStep) {
          const hVal = dVal + (hr / 24) * dayUnit;
          if (!isInRange(hVal)) continue;
          const hPx = toPx(hVal);
          if (hPx >= -30 && hPx <= timelineWidth + 30) {
            secondaryTicks.push({ pos: hPx, label: `${String(hr).padStart(2, '0')}:00`, isMajor: hr === 0 });
          }
        }
      }
    }
    return { primaryTicks, secondaryTicks };
  }, [currentYear, viewSpan, timelineWidth, minRangeDecimal, maxRangeDecimal]);

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

  const getNodeColor = useCallback(
    (label: string) => {
      const matched = colorGroups.find((g) => g.keyword.trim() !== '' && label.includes(g.keyword.trim()));
      return matched ? matched.color : 'var(--text-muted)';
    },
    [colorGroups]
  );

  const renderHighlightedText = (text: string, query: string) => {
    const q = query.trim();
    if (!q) return text;
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = lowerText.indexOf(lowerQ);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length);
    return (
      <>
        {before}
        <mark
          style={{
            background: 'rgba(255, 208, 0, 0.42)',
            color: 'inherit',
            padding: '0 2px',
            borderRadius: '2px',
            fontWeight: 700,
          }}
        >
          {match}
        </mark>
        {after}
      </>
    );
  };

  // ---------------- 核心排序引擎：统一对全量人物进行排序（最左列与最顶行 100% 同步） ----------------
  const sortedCharacterNodes = useMemo(() => {
    const list = [...allCharacterNodes];
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

    if (listSortMode === 'name-asc') {
      return list.sort((a, b) => collator.compare(a.label, b.label));
    }
    if (listSortMode === 'name-desc') {
      return list.sort((a, b) => collator.compare(b.label, a.label));
    }
    if (listSortMode === 'mtime-desc') {
      return list.sort((a, b) => b.mtime - a.mtime || collator.compare(a.label, b.label));
    }
    if (listSortMode === 'mtime-asc') {
      return list.sort((a, b) => a.mtime - b.mtime || collator.compare(a.label, b.label));
    }
    if (listSortMode === 'ctime-desc') {
      return list.sort((a, b) => b.ctime - a.ctime || collator.compare(a.label, b.label));
    }
    if (listSortMode === 'ctime-asc') {
      return list.sort((a, b) => a.ctime - b.ctime || collator.compare(a.label, b.label));
    }

    if (listSortMode === 'manual') {
      if (customManualOrder.length === 0) {
        return list.sort((a, b) => collator.compare(a.label, b.label));
      }
      const rankMap = new Map<string, number>();
      customManualOrder.forEach((id, idx) => rankMap.set(id, idx));
      return list.sort((a, b) => {
        const ra = rankMap.has(a.id) ? rankMap.get(a.id)! : 999999;
        const rb = rankMap.has(b.id) ? rankMap.get(b.id)! : 999999;
        if (ra !== rb) return ra - rb;
        return collator.compare(a.label, b.label);
      });
    }

    if (explorerOrderTokens.length > 0) {
      const getTokenRank = (node: NodeData): number => {
        const candidates = [node.path, `${node.id}.md`, node.id, node.label];
        let best = 999999;
        for (let i = 0; i < explorerOrderTokens.length; i++) {
          const tk = explorerOrderTokens[i]!;
          if (
            candidates.includes(tk) ||
            tk.endsWith(`/${node.id}.md`) ||
            tk.endsWith(`/${node.id}`)
          ) {
            if (i < best) best = i;
          }
        }
        return best;
      };

      const hasAnyMatch = list.some((n) => getTokenRank(n) < 999999);
      if (hasAnyMatch) {
        return list.sort((a, b) => {
          const ra = getTokenRank(a);
          const rb = getTokenRank(b);
          if (ra !== rb) return ra - rb;
          return collator.compare(a.realName, b.realName);
        });
      }
    }

    if (nativeSortRule === 'alphabeticalReverse') {
      return list.sort((a, b) => collator.compare(b.realName, a.realName));
    }
    if (nativeSortRule === 'byModifiedTime') {
      return list.sort((a, b) => b.mtime - a.mtime);
    }
    if (nativeSortRule === 'byModifiedTimeReverse') {
      return list.sort((a, b) => a.mtime - b.mtime);
    }
    if (nativeSortRule === 'byCreatedTime') {
      return list.sort((a, b) => b.ctime - a.ctime);
    }
    if (nativeSortRule === 'byCreatedTimeReverse') {
      return list.sort((a, b) => a.ctime - b.ctime);
    }
    return list.sort((a, b) => collator.compare(a.realName, b.realName));
  }, [allCharacterNodes, listSortMode, customManualOrder, explorerOrderTokens, nativeSortRule]);

  const filteredListRows = useMemo(() => {
    const q = listSearchQuery.trim().toLowerCase();
    if (!q) return sortedCharacterNodes;

    return sortedCharacterNodes.filter((rowNode) => {
      const matchChar =
        rowNode.label.toLowerCase().includes(q) ||
        rowNode.aliases.some((a) => a.toLowerCase().includes(q));

      let matchRel = false;
      for (const colNode of sortedCharacterNodes) {
        if (colNode.id === rowNode.id) continue;
        const cellEdges = fullTimeMatrixMap[`${rowNode.id}__${colNode.id}`] || [];
        if (cellEdges.some((e) => e.label.toLowerCase().includes(q))) {
          matchRel = true;
          break;
        }
      }

      if (listSearchScope === 'character') return matchChar;
      if (listSearchScope === 'relation') return matchRel;
      return matchChar || matchRel;
    });
  }, [sortedCharacterNodes, fullTimeMatrixMap, listSearchQuery, listSearchScope]);

  const handleRowDrop = useCallback(
    (targetRowId: string) => {
      if (!draggedRowId || draggedRowId === targetRowId) {
        setDraggedRowId(null);
        setDragOverRowId(null);
        return;
      }

      const baseOrder = sortedCharacterNodes.map((n) => n.id);
      const fromIdx = baseOrder.indexOf(draggedRowId);
      const toIdx = baseOrder.indexOf(targetRowId);

      if (fromIdx !== -1 && toIdx !== -1) {
        setIsSortingList(true);

        requestAnimationFrame(() => {
          setTimeout(() => {
            const nextOrder = [...baseOrder];
            const [moved] = nextOrder.splice(fromIdx, 1);
            if (moved) {
              nextOrder.splice(toIdx, 0, moved);
            }

            if (listSortMode !== 'manual') {
              setListSortMode('manual');
            }
            setCustomManualOrder(nextOrder);

            setIsSortingList(false);
          }, 10);
        });
      }

      setDraggedRowId(null);
      setDragOverRowId(null);
    },
    [draggedRowId, sortedCharacterNodes, listSortMode]
  );

  const highlightCharInList = listSearchQuery.trim() !== '' && (listSearchScope === 'all' || listSearchScope === 'character');
  const highlightRelInList = listSearchQuery.trim() !== '' && (listSearchScope === 'all' || listSearchScope === 'relation');

  // 100% 不透明实色背景定义
  const solidHeaderBg = 'var(--background-secondary)';
  const solidHeaderHighlightBg = 'color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary))';
  const solidRowBg = 'var(--background-primary)';
  const solidRowHighlightBg = 'color-mix(in srgb, var(--interactive-accent) 16%, var(--background-primary))';
  const solidCrosshairCellBg = 'color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary))';
  const solidSelectedCellBg = 'color-mix(in srgb, var(--interactive-accent) 20%, var(--background-primary))';

  // 更新单条自定义时间映射项的辅助函数
  const updateCustomEraItem = (id: string, patch: Partial<CustomEraItem>) => {
    setCustomEraItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  return (
    <div
      ref={workspaceRootRef}
      style={{ position: 'relative', width: '100%', height: '100%', background: 'transparent', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ position: 'relative', flex: 1, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 红色冲突连线悬浮 Tooltip 层 */}
        {conflictTooltip.visible && (
          <div
            style={{
              position: 'absolute',
              left: conflictTooltip.x,
              top: conflictTooltip.y,
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

        {/* 列表视图：关闭时间显示时的悬停时间范围 Tooltip */}
        {timeTooltip.visible && (
          <div
            style={{
              position: 'absolute',
              left: timeTooltip.x,
              top: timeTooltip.y,
              padding: '5px 10px',
              background: 'var(--background-primary)',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '6px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              zIndex: 9998,
              pointerEvents: 'none',
              fontSize: '11px',
              color: 'var(--text-normal)',
              whiteSpace: 'nowrap',
            }}
          >
            🕒 时间范围：<span style={{ color: 'var(--interactive-accent)', fontWeight: 600 }}>{timeTooltip.text}</span>
          </div>
        )}

        {/* 顶部居中：视图切换按钮（图谱 / 列表） */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px',
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.7)',
              borderRadius: '20px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
            }}
          >
            <button
              onClick={() => setViewMode('graph')}
              style={{
                padding: '4px 20px',
                fontSize: '12px',
                fontWeight: viewMode === 'graph' ? 600 : 500,
                borderRadius: '16px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'graph' ? 'color-mix(in srgb, var(--interactive-accent) 90%, transparent)' : 'transparent',
                color: viewMode === 'graph' ? 'var(--text-on-accent)' : 'var(--text-muted)',
                boxShadow: viewMode === 'graph' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
                transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            >
              图谱
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '4px 20px',
                fontSize: '12px',
                fontWeight: viewMode === 'list' ? 600 : 500,
                borderRadius: '16px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'list' ? 'color-mix(in srgb, var(--interactive-accent) 90%, transparent)' : 'transparent',
                color: viewMode === 'list' ? 'var(--text-on-accent)' : 'var(--text-muted)',
                boxShadow: viewMode === 'list' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
                transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            >
              列表
            </button>
          </div>

          {llmLoading && (
            <div
              style={{
                padding: '5px 14px',
                background: 'var(--background-secondary)',
                border: '1px solid var(--interactive-accent)',
                borderRadius: '20px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: 'var(--text-normal)',
                whiteSpace: 'nowrap',
              }}
            >
              <RefreshCw size={13} color="var(--interactive-accent)" />
              <span>{llmStepText || '大模型正在补全全局关系...'}</span>
            </div>
          )}
        </div>

        {/* 左上角：仅在图谱模式下显示 AI 重新推演按钮 & 当前焦点 */}
        {viewMode === 'graph' && (
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
        )}

        {/* 图谱主画布 */}
        <div
          style={{
            position: 'relative',
            flex: 1,
            width: '100%',
            height: '100%',
            display: viewMode === 'graph' ? 'block' : 'none',
          }}
        >
          {nodes.length === 0 && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--text-muted)', textAlign: 'center', pointerEvents: 'none' }}>
              当前时间或筛选条件下暂无人物节点。<br />
              请检查文件夹路径配置或调整底部时间轴。
            </div>
          )}
          <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}>
            <g ref={containerRef}></g>
          </svg>
        </div>

        {/* 列表主视图（关系矩阵表） */}
        {viewMode === 'list' && (
          <div
            onClick={() => {
              setSelectedListRowId(null);
              setSelectedListCell(null);
            }}
            style={{
              position: 'relative',
              flex: 1,
              width: '100%',
              height: '100%',
              paddingTop: '56px',
              paddingLeft: '16px',
              paddingRight: '16px',
              paddingBottom: '16px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* 排序切换与拖拽重排 Loading 遮罩提示 */}
            {isSortingList && (
              <div
                style={{
                  position: 'absolute',
                  inset: '56px 16px 16px 16px',
                  background: 'rgba(0, 0, 0, 0.12)',
                  backdropFilter: 'blur(1.5px)',
                  zIndex: 50,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '8px',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    padding: '8px 16px',
                    background: 'var(--background-primary)',
                    border: '1px solid var(--interactive-accent)',
                    borderRadius: '20px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-normal)',
                  }}
                >
                  <RefreshCw size={14} color="var(--interactive-accent)" />
                  <span>正在同步行列排序...</span>
                </div>
              </div>
            )}

            {sortedCharacterNodes.length === 0 ? (
              <div style={{ margin: 'auto', color: 'var(--text-muted)', textAlign: 'center', fontSize: '13px' }}>
                暂无人物数据，请检查插件设置中的目标文件夹与属性配置。
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  width: '100%',
                  height: '100%',
                  overflow: 'auto',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '8px',
                  background: 'var(--background-primary)',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'separate',
                    borderSpacing: 0,
                    width: '100%',
                    height: '100%',
                    tableLayout: 'fixed',
                    fontSize: '12px',
                    userSelect: 'none',
                  }}
                >
                  <colgroup>
                    <col style={{ width: `${firstColWidth}px`, minWidth: `${firstColWidth}px`, maxWidth: `${firstColWidth}px` }} />
                    {sortedCharacterNodes.map((colNode) => (
                      <col
                        key={`col-def-${colNode.id}`}
                        style={{ width: `${effectiveColWidth}px`, minWidth: `${effectiveColWidth}px`, maxWidth: `${effectiveColWidth}px` }}
                      />
                    ))}
                    <col style={{ width: 'auto' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {/* 左上角固定交叉表头 */}
                      <th
                        style={{
                          position: 'sticky',
                          top: 0,
                          left: 0,
                          zIndex: 12,
                          width: `${firstColWidth}px`,
                          minWidth: `${firstColWidth}px`,
                          maxWidth: `${firstColWidth}px`,
                          flexShrink: 0,
                          minHeight: '46px',
                          padding: '8px 12px',
                          boxSizing: 'border-box',
                          background: solidHeaderBg,
                          borderRight: isResizingFirstCol
                            ? '2px solid var(--interactive-accent)'
                            : '1px solid var(--background-modifier-border)',
                          borderBottom: '1px solid var(--background-modifier-border)',
                          boxShadow: '2px 2px 5px rgba(0, 0, 0, 0.04)',
                          textAlign: 'left',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          fontSize: '11px',
                        }}
                      >
                        人物 \ 对象
                        <div
                          onMouseDown={handleFirstColResizeStart}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            top: 0,
                            right: '-4px',
                            bottom: 0,
                            width: '8px',
                            cursor: 'col-resize',
                            zIndex: 20,
                          }}
                          title="左右拖拽调整首列宽度"
                        />
                      </th>

                      {/* 最顶部一行：名字完整展示，别名紧跟其后。溢出截断（最多4行） */}
                      {sortedCharacterNodes.map((colNode) => {
                        const isColHighlighted = selectedListCell?.colId === colNode.id;
                        const firstAlias = colNode.aliases[0] || '';
                        const fullTitle = firstAlias
                          ? `${colNode.label} (${firstAlias})\n按住 Command/Ctrl 单击打开笔记`
                          : `${colNode.label}\n按住 Command/Ctrl 单击打开笔记`;

                        return (
                          <th
                            key={`col-${colNode.id}`}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey) {
                                e.stopPropagation();
                                plugin?.app?.workspace?.openLinkText(colNode.realName, '', true);
                              }
                            }}
                            style={{
                              position: 'sticky',
                              top: 0,
                              zIndex: 8,
                              width: `${effectiveColWidth}px`,
                              minWidth: `${effectiveColWidth}px`,
                              maxWidth: `${effectiveColWidth}px`,
                              minHeight: '46px',
                              padding: '6px 10px',
                              boxSizing: 'border-box',
                              background: isColHighlighted ? solidHeaderHighlightBg : solidHeaderBg,
                              borderRight: '1px solid var(--background-modifier-border)',
                              borderBottom: isColHighlighted
                                ? '2px solid var(--interactive-accent)'
                                : '1px solid var(--background-modifier-border)',
                              textAlign: 'center',
                              verticalAlign: 'middle',
                            }}
                            title={fullTitle}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'center',
                                width: '100%',
                              }}
                            >
                              <div
                                style={{
                                  display: '-webkit-box',
                                  WebkitBoxOrient: 'vertical',
                                  WebkitLineClamp: 4,
                                  overflow: 'hidden',
                                  wordBreak: 'break-all',
                                  whiteSpace: 'normal',
                                  lineHeight: 1.3,
                                  color: 'var(--text-muted)',
                                  textAlign: 'left',
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    color: isColHighlighted ? 'var(--interactive-accent)' : 'var(--text-normal)',
                                  }}
                                >
                                  {colNode.label}
                                </span>
                                {colNode.aliases.length > 0 && (
                                  <span
                                    style={{
                                      marginLeft: '4px',
                                      fontSize: '11px',
                                      fontWeight: 400,
                                      opacity: 0.76,
                                    }}
                                  >
                                    {colNode.aliases.join(' / ')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </th>
                        );
                      })}
                      {/* 顶部表头右侧延伸占位列 */}
                      <th
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 7,
                          background: solidHeaderBg,
                          borderBottom: '1px solid var(--background-modifier-border)',
                          padding: 0,
                        }}
                      />
                    </tr>
                  </thead>

                  <tbody>
                    {filteredListRows.map((rowNode) => {
                      const isRowHighlighted =
                        selectedListRowId === rowNode.id || selectedListCell?.rowId === rowNode.id;
                      const isDragTarget = dragOverRowId === rowNode.id && draggedRowId !== rowNode.id;
                      const dotColor = getNodeColor(rowNode.label);
                      const aliasStr = rowNode.aliases.join(' / ');

                      return (
                        <tr key={`row-${rowNode.id}`}>
                          {/* 最左侧一列 */}
                          <td
                            draggable
                            onMouseEnter={() => {
                              if (dragHoverTimerRef.current) clearTimeout(dragHoverTimerRef.current);
                              dragHoverTimerRef.current = setTimeout(() => {
                                setHoveredRowIdForDrag(rowNode.id);
                              }, 150);
                            }}
                            onMouseLeave={() => {
                              if (dragHoverTimerRef.current) clearTimeout(dragHoverTimerRef.current);
                              if (hoveredRowIdForDrag === rowNode.id) {
                                setHoveredRowIdForDrag(null);
                              }
                            }}
                            onDragStart={(e) => {
                              setDraggedRowId(rowNode.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', rowNode.id);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverRowId !== rowNode.id) {
                                setDragOverRowId(rowNode.id);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverRowId === rowNode.id) {
                                setDragOverRowId(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRowDrop(rowNode.id);
                            }}
                            onDragEnd={() => {
                              setDraggedRowId(null);
                              setDragOverRowId(null);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.metaKey || e.ctrlKey) {
                                plugin?.app?.workspace?.openLinkText(rowNode.realName, '', true);
                                return;
                              }
                              setSelectedListCell(null);
                              setSelectedListRowId((prev) => (prev === rowNode.id ? null : rowNode.id));
                            }}
                            style={{
                              position: 'sticky',
                              left: 0,
                              zIndex: 6,
                              width: `${firstColWidth}px`,
                              minWidth: `${firstColWidth}px`,
                              maxWidth: `${firstColWidth}px`,
                              flexShrink: 0,
                              minHeight: '56px',
                              padding: '8px 10px',
                              boxSizing: 'border-box',
                              background: isRowHighlighted ? solidRowHighlightBg : solidRowBg,
                              borderRight:
                                isRowHighlighted || isResizingFirstCol
                                  ? '2px solid var(--interactive-accent)'
                                  : '1px solid var(--background-modifier-border)',
                              borderBottom: isDragTarget
                                ? '2px dashed var(--interactive-accent)'
                                : '1px solid var(--background-modifier-border)',
                              boxShadow: '2px 0 6px rgba(0, 0, 0, 0.04)',
                              cursor: 'pointer',
                              verticalAlign: 'middle',
                              opacity: draggedRowId === rowNode.id ? 0.45 : 1,
                            }}
                            title="点击高亮整行 | 拖拽可自定义排序 | 按住 Command/Ctrl 单击打开笔记"
                          >
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', width: '100%', overflow: 'hidden' }}>
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: '28px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  background: isRowHighlighted
                                    ? `linear-gradient(to right, ${solidRowHighlightBg} 60%, transparent)`
                                    : `linear-gradient(to right, ${solidRowBg} 60%, transparent)`,
                                  opacity: hoveredRowIdForDrag === rowNode.id || draggedRowId === rowNode.id ? 1 : 0,
                                  transition: 'opacity 0.2s ease',
                                  pointerEvents: hoveredRowIdForDrag === rowNode.id || draggedRowId === rowNode.id ? 'auto' : 'none',
                                  zIndex: 2,
                                }}
                              >
                                <GripVertical
                                  size={13}
                                  color="var(--text-faint)"
                                  style={{
                                    cursor: 'grab',
                                    marginLeft: '-2px',
                                  }}
                                />
                              </div>

                              <span
                                style={{
                                  marginLeft: '4px',
                                  width: '9px',
                                  height: '9px',
                                  borderRadius: '50%',
                                  background: dotColor,
                                  flexShrink: 0,
                                  boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
                                  zIndex: 1,
                                }}
                              />

                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  flex: 1,
                                  minWidth: 0,
                                  lineHeight: 1.35,
                                  zIndex: 1,
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: isRowHighlighted ? 700 : 600,
                                    fontSize: '13px',
                                    color: isRowHighlighted ? 'var(--interactive-accent)' : 'var(--text-normal)',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                  }}
                                >
                                  {highlightCharInList
                                    ? renderHighlightedText(rowNode.label, listSearchQuery)
                                    : rowNode.label}
                                </span>
                                {aliasStr && (
                                  <span
                                    style={{
                                      marginTop: '2px',
                                      fontSize: '11px',
                                      color: 'var(--text-muted)',
                                      opacity: 0.75,
                                      wordBreak: 'break-word',
                                      overflowWrap: 'anywhere',
                                    }}
                                    title={aliasStr}
                                  >
                                    {highlightCharInList
                                      ? renderHighlightedText(aliasStr, listSearchQuery)
                                      : aliasStr}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 首列右边界拖拽调整宽度热区 */}
                            <div
                              draggable={false}
                              onMouseDown={handleFirstColResizeStart}
                              onDragStart={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                top: 0,
                                right: '-4px',
                                bottom: 0,
                                width: '8px',
                                cursor: 'col-resize',
                                zIndex: 20,
                              }}
                              title="左右拖拽调整此列宽度"
                            />
                          </td>

                          {/* 中间关系区域 */}
                          {sortedCharacterNodes.map((colNode) => {
                            const isDiagonal = rowNode.id === colNode.id;
                            const cellEdges = isDiagonal
                              ? []
                              : fullTimeMatrixMap[`${rowNode.id}__${colNode.id}`] || [];

                            const isExactSelectedCell =
                              selectedListCell?.rowId === rowNode.id && selectedListCell?.colId === colNode.id;
                            const isCrosshairCell =
                              selectedListRowId === rowNode.id ||
                              selectedListCell?.rowId === rowNode.id ||
                              selectedListCell?.colId === colNode.id;

                            const shouldDimRelations = Boolean(selectedListCell && !isExactSelectedCell);

                            let cellBg = solidRowBg;
                            if (isDiagonal) {
                              cellBg = solidHeaderBg;
                            } else if (isExactSelectedCell) {
                              cellBg = solidSelectedCellBg;
                            } else if (isCrosshairCell) {
                              cellBg = solidCrosshairCellBg;
                            }

                            return (
                              <td
                                key={`cell-${rowNode.id}-${colNode.id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isDiagonal) return;
                                  setSelectedListRowId(null);
                                  setSelectedListCell((prev) =>
                                    prev && prev.rowId === rowNode.id && prev.colId === colNode.id
                                      ? null
                                      : { rowId: rowNode.id, colId: colNode.id }
                                  );
                                }}
                                style={{
                                  width: `${effectiveColWidth}px`,
                                  minWidth: `${effectiveColWidth}px`,
                                  maxWidth: `${effectiveColWidth}px`,
                                  height: '56px',
                                  padding: '6px 8px',
                                  boxSizing: 'border-box',
                                  background: cellBg,
                                  borderRight: '1px solid var(--background-modifier-border)',
                                  borderBottom: '1px solid var(--background-modifier-border)',
                                  outline: isExactSelectedCell ? '2px solid var(--interactive-accent)' : 'none',
                                  outlineOffset: '-2px',
                                  textAlign: 'center',
                                  verticalAlign: 'middle',
                                  cursor: isDiagonal ? 'default' : 'pointer',
                                }}
                              >
                                {isDiagonal ? (
                                  <span style={{ color: 'var(--background-modifier-border)', fontSize: '11px' }}>—</span>
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexDirection: listShowTime ? 'column' : 'row',
                                      flexWrap: 'wrap',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: listShowTime ? '5px' : '4px',
                                      opacity: shouldDimRelations ? 0.18 : 1,
                                      transition: 'opacity 0.15s ease',
                                    }}
                                  >
                                    {cellEdges.map((edge, eIdx) => {
                                      const isConflict = Boolean(edge.conflictReason);
                                      const hasTimeRange =
                                        Boolean(edge.timeStr) &&
                                        edge.timeStr !== '固定' &&
                                        !edge.timeStr.includes('固定');
                                      const isRelSearchHit =
                                        highlightRelInList &&
                                        edge.label.toLowerCase().includes(listSearchQuery.trim().toLowerCase());

                                      const showTimeBlock = listShowTime && hasTimeRange;
                                      const formattedEdgeTime = hasTimeRange
                                        ? formatListTimeRangeStr(
                                            edge.timeStr,
                                            listYearDisplayMode,
                                            customEraItems,
                                            customEraMappingScope
                                          )
                                        : edge.timeStr;

                                      return (
                                        <div
                                          key={`${edge.key}-${eIdx}`}
                                          onMouseEnter={(ev) => {
                                            const pos = getRelativeMousePos(ev.clientX, ev.clientY);
                                            if (isConflict) {
                                              setConflictTooltip({
                                                visible: true,
                                                x: pos.x,
                                                y: pos.y,
                                                title: `⚠️ 关系冲突：${colNode.label} → ${rowNode.label} (${edge.label})`,
                                                reason: edge.conflictReason,
                                              });
                                            }
                                            if (!listShowTime && hasTimeRange) {
                                              setTimeTooltip({
                                                visible: true,
                                                x: pos.x,
                                                y: pos.y,
                                                text: formattedEdgeTime,
                                              });
                                            }
                                          }}
                                          onMouseMove={(ev) => {
                                            const pos = getRelativeMousePos(ev.clientX, ev.clientY);
                                            if (isConflict) {
                                              setConflictTooltip((prev) =>
                                                prev.visible ? { ...prev, x: pos.x, y: pos.y } : prev
                                              );
                                            }
                                            if (!listShowTime && hasTimeRange) {
                                              setTimeTooltip((prev) =>
                                                prev.visible ? { ...prev, x: pos.x, y: pos.y } : prev
                                              );
                                            }
                                          }}
                                          onMouseLeave={() => {
                                            if (isConflict) {
                                              setConflictTooltip((prev) =>
                                                prev.visible ? { ...prev, visible: false } : prev
                                              );
                                            }
                                            if (!listShowTime && hasTimeRange) {
                                              setTimeTooltip((prev) =>
                                                prev.visible ? { ...prev, visible: false } : prev
                                              );
                                            }
                                          }}
                                          style={{
                                            display: 'inline-flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '2px',
                                            width: showTimeBlock ? '100%' : 'auto',
                                            boxSizing: 'border-box',
                                            padding: '3px 6px',
                                            borderRadius: '5px',
                                            background: isConflict
                                              ? 'rgba(224, 49, 49, 0.12)'
                                              : isRelSearchHit
                                              ? 'rgba(255, 208, 0, 0.22)'
                                              : 'var(--background-secondary)',
                                            border: isConflict
                                              ? '1px solid rgba(224, 49, 49, 0.45)'
                                              : '1px solid var(--background-modifier-border)',
                                            color: isConflict
                                              ? '#e03131'
                                              : edge.isInferred
                                              ? 'var(--text-muted)'
                                              : 'var(--text-normal)',
                                            fontWeight: isConflict ? 700 : edge.isInferred ? 400 : 500,
                                            opacity: edge.isInferred && !isConflict ? 0.65 : 1,
                                            cursor: isConflict || (!listShowTime && hasTimeRange) ? 'help' : 'pointer',
                                          }}
                                        >
                                          <span
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              whiteSpace: 'nowrap',
                                              fontSize: '12px',
                                              lineHeight: 1.3,
                                            }}
                                          >
                                            {hasTimeRange && (
                                              <span
                                                title="此关系带有生效时间范围"
                                                style={{ display: 'inline-flex', alignItems: 'center', marginRight: '4px' }}
                                              >
                                                <Clock size={11} style={{ opacity: 0.65 }} />
                                              </span>
                                            )}

                                            {highlightRelInList
                                              ? renderHighlightedText(edge.label, listSearchQuery)
                                              : edge.label}
                                          </span>

                                          {showTimeBlock && (
                                            <span
                                              style={{
                                                fontSize: '10px',
                                                lineHeight: 1.25,
                                                color: isConflict ? '#e03131' : 'var(--text-muted)',
                                                opacity: 0.78,
                                                fontWeight: 400,
                                                wordBreak: 'break-all',
                                                textAlign: 'center',
                                              }}
                                            >
                                              {formattedEdgeTime}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          {/* 每一行最右侧延伸占位格 */}
                          <td
                            style={{
                              background:
                                selectedListRowId === rowNode.id || selectedListCell?.rowId === rowNode.id
                                  ? solidCrosshairCellBg
                                  : solidRowBg,
                              borderBottom: '1px solid var(--background-modifier-border)',
                              padding: 0,
                            }}
                          />
                        </tr>
                      );
                    })}

                    {/* 底部弹性占位尾行 */}
                    <tr style={{ height: '100%' }}>
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          zIndex: 5,
                          background: solidRowBg,
                          borderRight: isResizingFirstCol
                            ? '2px solid var(--interactive-accent)'
                            : '1px solid var(--background-modifier-border)',
                          boxShadow: '2px 0 6px rgba(0, 0, 0, 0.04)',
                          padding: 0,
                        }}
                      >
                        <div
                          onMouseDown={handleFirstColResizeStart}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            top: 0,
                            right: '-4px',
                            bottom: 0,
                            width: '8px',
                            cursor: 'col-resize',
                            zIndex: 20,
                          }}
                          title="左右拖拽调整此列宽度"
                        />
                      </td>
                      <td
                        colSpan={sortedCharacterNodes.length + 1}
                        style={{
                          background: solidRowBg,
                          padding: 0,
                        }}
                      />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 右上角齿轮按钮 */}
        {!isPanelOpen && (
          <button
            onClick={() => setIsPanelOpen(true)}
            style={{ position: 'absolute', top: 16, right: 16, padding: '8px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: '6px', cursor: 'pointer', zIndex: 30 }}
            title={viewMode === 'graph' ? '打开图谱设置' : '打开列表设置'}
          >
            <Settings color="var(--text-muted)" size={18} />
          </button>
        )}

        {/* 右上角设置面板 */}
        {isPanelOpen && (
          <div style={{ position: 'absolute', top: 16, right: 16, width: '332px', maxHeight: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: '13px', zIndex: 35, overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--background-secondary)', borderBottom: '1px solid var(--background-modifier-border)' }}>
              <strong style={{ fontSize: '14px', color: 'var(--text-normal)' }}>
                {viewMode === 'graph' ? '图谱设置' : '列表设置'}
              </strong>
              <button onClick={() => setIsPanelOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', background: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }} title="关闭设置">
                <X size={18} />
              </button>
            </div>

            {viewMode === 'graph' ? (
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
                      >
                        <input
                          type="radio"
                          name="inferDisplayMode"
                          checked={inferDisplayMode === 'partial'}
                          onChange={() => setInferDisplayMode('partial')}
                        />
                        <span>展示部分推算关系</span>
                        <HelpIcon text="仅展示直接反向关系与核心直系血亲/同门闭环（如兄弟共享父母、夫妻共享儿女）" />
                      </label>
                      <label
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontSize: '12px' }}
                      >
                        <input
                          type="radio"
                          name="inferDisplayMode"
                          checked={inferDisplayMode === 'all'}
                          onChange={() => setInferDisplayMode('all')}
                        />
                        <span>展示全部推算关系</span>
                        <HelpIcon text="展示包含跨代（祖孙/师祖）、旁系（叔伯/姑舅）与姻亲（嫂子/岳父母/大舅哥）在内的全部全局推算关系" />
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

                {/* 新增：自定义时间映射（位于“力度”与“时间轴范围与跳转”之间，默认折叠） */}
                <Accordion
                  defaultOpen={false}
                  title="自定义时间映射"
                  helpText="配置自定义纪年（如民国、年号或架空历法）。勾选启用，上下拖拽可调整在图谱与列表中的显示优先级顺序。"
                >
                  {/* 1. 映射设置列表 */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-normal)' }}>
                        映射设置
                        <HelpIcon text="• 固定项「标准时间」默认启用，仅支持拖拽排序，不可修改或删除。\n• 自定义纪年必须填写名称与完整的起始年月日，否则无法保存生效（结束时间可选）。" />
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {customEraItems.map((eraItem) => {
                        const isValid = isCustomEraValid(eraItem);
                        const isDragTarget = dragOverEraId === eraItem.id && draggedEraId !== eraItem.id;

                        return (
                          <div
                            key={eraItem.id}
                            draggable
                            onDragStart={(e) => {
                              setDraggedEraId(eraItem.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', eraItem.id);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverEraId !== eraItem.id) {
                                setDragOverEraId(eraItem.id);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverEraId === eraItem.id) {
                                setDragOverEraId(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleEraDrop(eraItem.id);
                            }}
                            onDragEnd={() => {
                              setDraggedEraId(null);
                              setDragOverEraId(null);
                            }}
                            style={{
                              padding: '8px',
                              background: 'var(--background-secondary)',
                              borderRadius: '6px',
                              border: !isValid
                                ? '1px solid #e03131'
                                : isDragTarget
                                ? '1.5px dashed var(--interactive-accent)'
                                : '1px solid var(--background-modifier-border)',
                              opacity: draggedEraId === eraItem.id ? 0.45 : 1,
                            }}
                          >
                            {/* 顶部行：拖拽手柄 + 勾选框 + 名称 + 状态提示/删除 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', color: 'var(--text-faint)' }}
                                title="上下拖拽调整显示顺序"
                              >
                                <GripVertical size={14} />
                              </span>

                              <input
                                type="checkbox"
                                checked={eraItem.isStandard ? true : eraItem.enabled}
                                disabled={Boolean(eraItem.isStandard)}
                                onChange={(e) => {
                                  if (eraItem.isStandard) return;
                                  updateCustomEraItem(eraItem.id, { enabled: e.target.checked });
                                }}
                                style={{ cursor: eraItem.isStandard ? 'not-allowed' : 'pointer' }}
                                title={eraItem.isStandard ? '固定项常驻启用，不可取消勾选' : '勾选启用此自定义时间'}
                              />

                              {eraItem.isStandard ? (
                                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-normal)', flex: 1 }}>
                                  标准时间
                                </span>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    placeholder="纪年名称 (如: 民国)"
                                    value={eraItem.name}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) => updateCustomEraItem(eraItem.id, { name: e.target.value })}
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                      padding: '3px 6px',
                                      fontSize: '12px',
                                      background: 'var(--background-primary)',
                                      color: 'var(--text-normal)',
                                      border: !eraItem.name.trim()
                                        ? '1px solid rgba(224, 49, 49, 0.7)'
                                        : '1px solid var(--background-modifier-border)',
                                      borderRadius: '4px',
                                    }}
                                  />
                                  {!isValid && (
                                    <span
                                      title="⚠️ 缺少纪年名称或完整的起始年月日，当前项不会被保存或生效"
                                      style={{ display: 'inline-flex', alignItems: 'center', color: '#e03131', cursor: 'help' }}
                                    >
                                      <AlertTriangle size={14} />
                                    </span>
                                  )}
                                  <span
                                    role="button"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onMouseEnter={() => setHoveredDeleteEraId(eraItem.id)}
                                    onMouseLeave={() => {
                                      if (hoveredDeleteEraId === eraItem.id) setHoveredDeleteEraId(null);
                                    }}
                                    onClick={() => setCustomEraItems((prev) => prev.filter((it) => it.id !== eraItem.id))}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      width: '24px',
                                      height: '24px',
                                      flexShrink: 0,
                                      borderRadius: '4px',
                                      background:
                                        hoveredDeleteEraId === eraItem.id
                                          ? 'rgba(201, 42, 42, 0.15)'
                                          : 'transparent',
                                      color:
                                        hoveredDeleteEraId === eraItem.id
                                          ? '#c92a2a' // 悬停时变成深红色显眼状态
                                          : 'rgba(224, 49, 49, 0.48)', // 默认很弱的红色
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease',
                                    }}
                                    title="删除此项"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      style={{
                                        width: '15px',
                                        height: '15px',
                                        minWidth: '15px',
                                        minHeight: '15px',
                                        display: 'block',
                                        overflow: 'visible',
                                        pointerEvents: 'none',
                                      }}
                                    >
                                      <path d="M3 6h18" />
                                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                      <line x1="10" y1="11" x2="10" y2="17" />
                                      <line x1="14" y1="11" x2="14" y2="17" />
                                    </svg>
                                  </span>
                                </>
                              )}
                            </div>

                            {/* 自定义项的时间范围配置区 */}
                            {!eraItem.isStandard && (
                              <div
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{ marginTop: '8px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}
                              >
                                {/* 起始时间（必填） */}
                                <div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>
                                    起始时间 (必填)
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
                                    <input
                                      type="number"
                                      min="1"
                                      placeholder="年"
                                      value={eraItem.startYear}
                                      onChange={(e) => {
                                        const v = e.target.value.trim();
                                        updateCustomEraItem(eraItem.id, {
                                          startYear: v === '' ? '' : Math.max(1, parseInt(v, 10) || 1),
                                        });
                                      }}
                                      style={{
                                        width: '54px',
                                        padding: '2px 4px',
                                        fontSize: '11px',
                                        background: 'var(--background-primary)',
                                        color: 'var(--text-normal)',
                                        border: eraItem.startYear === '' ? '1px solid #e03131' : '1px solid var(--background-modifier-border)',
                                        borderRadius: '4px',
                                      }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>年</span>
                                    <input
                                      type="number"
                                      min="1"
                                      max="12"
                                      placeholder="月"
                                      value={eraItem.startMonth}
                                      onChange={(e) => {
                                        const v = e.target.value.trim();
                                        updateCustomEraItem(eraItem.id, {
                                          startMonth: v === '' ? '' : Math.min(12, Math.max(1, parseInt(v, 10) || 1)),
                                        });
                                      }}
                                      style={{
                                        width: '36px',
                                        padding: '2px 4px',
                                        fontSize: '11px',
                                        background: 'var(--background-primary)',
                                        color: 'var(--text-normal)',
                                        border: eraItem.startMonth === '' ? '1px solid #e03131' : '1px solid var(--background-modifier-border)',
                                        borderRadius: '4px',
                                      }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>月</span>
                                    <input
                                      type="number"
                                      min="1"
                                      max="31"
                                      placeholder="日"
                                      value={eraItem.startDay}
                                      onChange={(e) => {
                                        const v = e.target.value.trim();
                                        updateCustomEraItem(eraItem.id, {
                                          startDay: v === '' ? '' : Math.min(31, Math.max(1, parseInt(v, 10) || 1)),
                                        });
                                      }}
                                      style={{
                                        width: '36px',
                                        padding: '2px 4px',
                                        fontSize: '11px',
                                        background: 'var(--background-primary)',
                                        color: 'var(--text-normal)',
                                        border: eraItem.startDay === '' ? '1px solid #e03131' : '1px solid var(--background-modifier-border)',
                                        borderRadius: '4px',
                                      }}
                                    />
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>日</span>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--text-normal)', marginLeft: '2px', cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={eraItem.startIsBC}
                                        onChange={(e) => updateCustomEraItem(eraItem.id, { startIsBC: e.target.checked })}
                                      />
                                      BC
                                    </label>
                                  </div>
                                </div>

                                {/* 结束时间（可选） */}
                                <div>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: eraItem.hasEnd ? '3px' : 0 }}>
                                    <input
                                      type="checkbox"
                                      checked={eraItem.hasEnd}
                                      onChange={(e) => {
                                        updateCustomEraItem(eraItem.id, {
                                          hasEnd: e.target.checked,
                                        });
                                      }}
                                    />
                                    <span>设置结束时间 (可选)</span>
                                  </label>

                                  {eraItem.hasEnd && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
                                      <input
                                        type="number"
                                        min="1"
                                        placeholder="年"
                                        value={eraItem.endYear}
                                        onChange={(e) => {
                                          const v = e.target.value.trim();
                                          updateCustomEraItem(eraItem.id, {
                                            endYear: v === '' ? '' : Math.max(1, parseInt(v, 10) || 1),
                                          });
                                        }}
                                        style={{
                                          width: '54px',
                                          padding: '2px 4px',
                                          fontSize: '11px',
                                          background: 'var(--background-primary)',
                                          color: 'var(--text-normal)',
                                          border: '1px solid var(--background-modifier-border)',
                                          borderRadius: '4px',
                                        }}
                                      />
                                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>年</span>
                                      <input
                                        type="number"
                                        min="1"
                                        max="12"
                                        placeholder="月"
                                        value={eraItem.endMonth}
                                        onChange={(e) => {
                                          const v = e.target.value.trim();
                                          updateCustomEraItem(eraItem.id, {
                                            endMonth: v === '' ? '' : Math.min(12, Math.max(1, parseInt(v, 10) || 1)),
                                          });
                                        }}
                                        style={{
                                          width: '36px',
                                          padding: '2px 4px',
                                          fontSize: '11px',
                                          background: 'var(--background-primary)',
                                          color: 'var(--text-normal)',
                                          border: '1px solid var(--background-modifier-border)',
                                          borderRadius: '4px',
                                        }}
                                      />
                                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>月</span>
                                      <input
                                        type="number"
                                        min="1"
                                        max="31"
                                        placeholder="日"
                                        value={eraItem.endDay}
                                        onChange={(e) => {
                                          const v = e.target.value.trim();
                                          updateCustomEraItem(eraItem.id, {
                                            endDay: v === '' ? '' : Math.min(31, Math.max(1, parseInt(v, 10) || 1)),
                                          });
                                        }}
                                        style={{
                                          width: '36px',
                                          padding: '2px 4px',
                                          fontSize: '11px',
                                          background: 'var(--background-primary)',
                                          color: 'var(--text-normal)',
                                          border: '1px solid var(--background-modifier-border)',
                                          borderRadius: '4px',
                                        }}
                                      />
                                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>日</span>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: 'var(--text-normal)', marginLeft: '2px', cursor: 'pointer' }}>
                                        <input
                                          type="checkbox"
                                          checked={eraItem.endIsBC}
                                          onChange={(e) => updateCustomEraItem(eraItem.id, { endIsBC: e.target.checked })}
                                        />
                                        BC
                                      </label>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => {
                        const newId = `era_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                        setCustomEraItems((prev) => [
                          ...prev,
                          {
                            id: newId,
                            enabled: true,
                            name: '',
                            startYear: '',
                            startMonth: '',
                            startDay: '',
                            startIsBC: false,
                            hasEnd: false,
                            endYear: '',
                            endMonth: '',
                            endDay: '',
                            endIsBC: false,
                          },
                        ]);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        padding: '5px',
                        background: 'var(--background-secondary)',
                        border: '1px dashed var(--background-modifier-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginTop: '8px',
                        color: 'var(--text-normal)',
                        fontSize: '12px',
                      }}
                    >
                      <Plus size={14} style={{ marginRight: '4px' }} /> 添加自定义时间
                    </button>
                  </div>

                  {/* 2. 自定义时间的映射范围 */}
                  <div style={{ marginBottom: '12px', paddingTop: '10px', borderTop: '1px solid var(--background-modifier-border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-normal)', marginBottom: '6px' }}>
                      自定义时间的映射范围
                      <HelpIcon text="• 映射至整个时间轴：从设定的起始时间开始向未来无限延续显示（起始时间之前不显示）。\n• 仅映射有效范围：仅在设定的[起始时间 ~ 结束时间]区间内显示。" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-normal)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="customEraMappingScope"
                          checked={customEraMappingScope === 'entire'}
                          onChange={() => setCustomEraMappingScope('entire')}
                        />
                        <span>将选择的自定义时间映射至整个时间轴</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-normal)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="customEraMappingScope"
                          checked={customEraMappingScope === 'valid_only'}
                          onChange={() => setCustomEraMappingScope('valid_only')}
                        />
                        <span>自定义时间仅映射有效范围</span>
                      </label>
                    </div>
                  </div>

                  {/* 3. 图谱年份显示设置 */}
                  <div style={{ paddingTop: '10px', borderTop: '1px solid var(--background-modifier-border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-normal)', marginBottom: '6px' }}>
                      年份显示设置
                      <HelpIcon text="控制底部时间轴中央紫色胶囊的年份显示方式。选择「自定义年份」时，将按上方排序展示双层胶囊。" />
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                      <select
                        value={graphYearDisplayMode}
                        onChange={(e) => setGraphYearDisplayMode(e.target.value as GraphYearDisplayMode)}
                        style={{
                          width: '100%',
                          padding: '5px 28px 5px 8px',
                          fontSize: '12px',
                          background: 'var(--background-secondary)',
                          color: 'var(--text-normal)',
                          border: '1px solid var(--background-modifier-border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          outline: 'none',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                        }}
                      >
                        <option value="standard">标准年份</option>
                        <option value="custom">自定义年份</option>
                      </select>
                      <ChevronDown
                        size={14}
                        color="var(--text-muted)"
                        style={{ position: 'absolute', right: '8px', pointerEvents: 'none' }}
                      />
                    </div>
                  </div>
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
            ) : (
              /* 列表视图专属设置面板：按语义分组留白，隐藏大段说明文字进问号气泡 */
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                {/* 第一组：查找与人物排序（同类紧凑间距） */}
                <div style={{ paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid var(--background-modifier-border)' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--background-secondary)',
                      borderRadius: '6px',
                      padding: '3px 6px',
                      marginBottom: '10px',
                      border: '1px solid var(--background-modifier-border)',
                      gap: '4px',
                    }}
                  >
                    <Search color="var(--text-muted)" size={14} style={{ flexShrink: 0, marginLeft: '2px' }} />
                    <select
                      value={listSearchScope}
                      onChange={(e) => setListSearchScope(e.target.value as 'all' | 'character' | 'relation')}
                      style={{
                        border: 'none',
                        background: 'var(--background-primary)',
                        color: 'var(--text-normal)',
                        fontSize: '11px',
                        padding: '2px 4px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        outline: 'none',
                      }}
                      title="选择搜索范围"
                    >
                      <option value="all">全部</option>
                      <option value="character">人物</option>
                      <option value="relation">关系</option>
                    </select>
                    <input
                      type="text"
                      placeholder={
                        listSearchScope === 'character'
                          ? '筛选左侧人物...'
                          : listSearchScope === 'relation'
                          ? '搜索关系称谓...'
                          : '搜索人物或关系...'
                      }
                      value={listSearchQuery}
                      onChange={(e) => setListSearchQuery(e.target.value)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        flex: 1,
                        minWidth: 0,
                        color: 'var(--text-normal)',
                        fontSize: '12px',
                      }}
                    />
                    {listSearchQuery && (
                      <button
                        onClick={() => setListSearchQuery('')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '2px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                        }}
                        title="清空搜索内容"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-normal)', marginBottom: '6px', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
                      <span>人物排序方式</span>
                      <HelpIcon text="直接上下拖拽表格最左侧人物行即可调整自定义顺序，顶部人物行将自动同步。" />
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                      <select
                        value={listSortMode}
                        onChange={(e) => triggerSortWithLoading(e.target.value as ListSortMode)}
                        style={{
                          width: '100%',
                          padding: '5px 28px 5px 8px',
                          fontSize: '12px',
                          background: 'var(--background-secondary)',
                          color: 'var(--text-normal)',
                          border: '1px solid var(--background-modifier-border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          outline: 'none',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                        }}
                      >
                        <option value="explorer">与文件管理器一致 (含 Flexplorer)</option>
                        <option value="manual">手动拖拽排序 (自定义记忆)</option>
                        <option value="name-asc">名称 (A - Z)</option>
                        <option value="name-desc">名称 (Z - A)</option>
                        <option value="mtime-desc">修改时间 (最新在前)</option>
                        <option value="mtime-asc">修改时间 (最早在前)</option>
                        <option value="ctime-desc">创建时间 (最新在前)</option>
                        <option value="ctime-asc">创建时间 (最早在前)</option>
                      </select>
                      <ChevronDown
                        size={14}
                        color="var(--text-muted)"
                        style={{ position: 'absolute', right: '8px', pointerEvents: 'none' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 第二组：推算关系设置 */}
                <div style={{ paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid var(--background-modifier-border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontWeight: 500, fontSize: '12px' }}>
                    <input type="checkbox" checked={enableInferred} onChange={(e) => setEnableInferred(e.target.checked)} />
                    <span>开启推算关系</span>
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
                      >
                        <input
                          type="radio"
                          name="listInferDisplayMode"
                          checked={inferDisplayMode === 'partial'}
                          onChange={() => setInferDisplayMode('partial')}
                        />
                        <span>展示部分推算关系</span>
                        <HelpIcon text="仅展示直接反向关系与核心直系血亲/同门闭环（如兄弟共享父母、夫妻共享儿女）" />
                      </label>
                      <label
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontSize: '12px' }}
                      >
                        <input
                          type="radio"
                          name="listInferDisplayMode"
                          checked={inferDisplayMode === 'all'}
                          onChange={() => setInferDisplayMode('all')}
                        />
                        <span>展示全部推算关系</span>
                        <HelpIcon text="展示包含跨代（祖孙/师祖）、旁系（叔伯/姑舅）与姻亲（嫂子/岳父母/大舅哥）在内的全部全局推算关系" />
                      </label>
                    </div>
                  )}
                </div>

                {/* 第三组：年份与时间显示设置 */}
                <div style={{ paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid var(--background-modifier-border)' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-normal)', marginBottom: '6px', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
                      <span>年份显示设置</span>
                      <HelpIcon text="控制列表单元格与悬浮提示中的起止日期格式。自定义年份的开启项与先后顺序请在「图谱设置 -> 自定义时间映射」中配置。" />
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
                      <select
                        value={listYearDisplayMode}
                        onChange={(e) => setListYearDisplayMode(e.target.value as ListYearDisplayMode)}
                        style={{
                          width: '100%',
                          padding: '5px 28px 5px 8px',
                          fontSize: '12px',
                          background: 'var(--background-secondary)',
                          color: 'var(--text-normal)',
                          border: '1px solid var(--background-modifier-border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          outline: 'none',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                        }}
                      >
                        <option value="standard">标准年份</option>
                        <option value="custom_first">自定义年份（1个）</option>
                        <option value="custom_first_with_standard">自定义年份（1个）+ 标准年份</option>
                        <option value="custom_all">自定义年份（全部）</option>
                      </select>
                      <ChevronDown
                        size={14}
                        color="var(--text-muted)"
                        style={{ position: 'absolute', right: '8px', pointerEvents: 'none' }}
                      />
                    </div>
                  </div>

                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-normal)', fontSize: '12px', fontWeight: 500 }}
                  >
                    <input type="checkbox" checked={listShowTime} onChange={(e) => setListShowTime(e.target.checked)} />
                    <span>开启时间显示</span>
                    <HelpIcon text="开启后在有时间范围的关系下方直接显示起止时间；关闭时鼠标悬停在带有时钟图标的关系上可查看时间提示。" />
                  </label>
                </div>

                {/* 第四组：列宽控制 */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      color: listShowTime ? 'var(--text-muted)' : 'var(--text-normal)',
                      fontSize: '12px',
                      fontWeight: 500,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        关系列默认宽度
                        <HelpIcon text="开启「时间显示」后，列宽自动加宽锁定为 168px 以完整容纳时间范围；关闭「时间显示」后可通过滑块自由调节。" />
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {listShowTime ? '已自动适配 (168px)' : `${listColWidth}px`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="60"
                      max="260"
                      step="4"
                      disabled={listShowTime}
                      value={listColWidth}
                      onChange={(e) => setListColWidth(parseInt(e.target.value, 10))}
                      style={{
                        width: '100%',
                        cursor: listShowTime ? 'not-allowed' : 'pointer',
                        opacity: listShowTime ? 0.5 : 1,
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部时间轴：仅在图谱模式下渲染 */}
      {viewMode === 'graph' && (
        <div
          ref={timelineWrapRef}
          onWheel={handleTimelineWheel}
          style={{
            height: '86px',
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
              height: '56px',
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

            {/* 中央时间胶囊组：支持单层标准胶囊或双层自定义纪年胶囊 */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '2px',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              <div
                style={{
                  padding: '1px 8px',
                  background: 'var(--interactive-accent)',
                  color: 'var(--text-on-accent)',
                  fontSize: '11px',
                  fontWeight: 600,
                  borderRadius: '10px',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                }}
              >
                {timelineCenterBadges.primaryText}
              </div>

              {timelineCenterBadges.secondaryText && (
                <div
                  style={{
                    padding: '0px 7px',
                    background: 'color-mix(in srgb, var(--interactive-accent) 82%, var(--background-primary))',
                    color: 'var(--text-on-accent)',
                    fontSize: '10px',
                    fontWeight: 500,
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.16)',
                    lineHeight: 1.4,
                  }}
                >
                  {timelineCenterBadges.secondaryText}
                </div>
              )}
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
      )}
    </div>
  );
}